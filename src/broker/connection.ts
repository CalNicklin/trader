import { ConnectionState, IBApiNext } from "@stoqey/ib";
import { getConfig } from "../config.ts";
import { sendCriticalAlert } from "../utils/alert.ts";
import { createChildLogger } from "../utils/logger.ts";
import { withRetry } from "../utils/retry.ts";

const log = createChildLogger({ module: "broker-connection" });

let _api: IBApiNext | null = null;
let _wasConnected = false;
let _disconnectAlerted = false;
let _lastDisconnectEmailAt = 0;
const DISCONNECT_EMAIL_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

export function getApi(): IBApiNext {
	if (!_api) {
		const config = getConfig();
		_api = new IBApiNext({
			host: config.IBKR_HOST,
			port: config.IBKR_PORT,
			reconnectInterval: 5000,
			connectionWatchdogInterval: 30,
			maxReqPerSec: 40,
		});
	}
	return _api;
}

export async function connect(): Promise<IBApiNext> {
	const api = getApi();
	const config = getConfig();

	const result = await withRetry(
		() =>
			new Promise<IBApiNext>((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error("Connection timeout after 15s"));
				}, 15000);

				const sub = api.connectionState.subscribe((state) => {
					log.info({ state: ConnectionState[state] }, "Connection state changed");
					if (state === ConnectionState.Connected) {
						clearTimeout(timeout);
						sub.unsubscribe();
						resolve(api);
					} else if (state === ConnectionState.Disconnected) {
						// Only reject if we're not waiting for reconnect
					}
				});

				api.connect(config.IBKR_CLIENT_ID);
			}),
		"IBKR connect",
		{ maxAttempts: 5, baseDelayMs: 3000 },
	);

	// Monitor for unexpected disconnects after successful connection
	_wasConnected = true;
	_disconnectAlerted = false;
	api.connectionState.subscribe((state) => {
		if (state === ConnectionState.Disconnected && _wasConnected && !_disconnectAlerted) {
			_disconnectAlerted = true;
			log.error("IBKR connection lost after being connected");
			const now = Date.now();
			if (now - _lastDisconnectEmailAt >= DISCONNECT_EMAIL_COOLDOWN_MS) {
				_lastDisconnectEmailAt = now;
				sendCriticalAlert(
					"IBKR disconnected",
					"Connection to IBKR was lost unexpectedly. The agent will attempt to reconnect automatically.",
				);
			} else {
				log.warn("Suppressing disconnect email (cooldown active)");
			}
		} else if (state === ConnectionState.Connected) {
			_disconnectAlerted = false;
		}
	});

	return result;
}

export async function disconnect(): Promise<void> {
	if (_api) {
		_api.disconnect();
		_api = null;
		log.info("Disconnected from IBKR");
	}
}

export function isConnected(): boolean {
	return _api !== null;
}
