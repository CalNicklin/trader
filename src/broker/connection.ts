import { ConnectionState, IBApiNext, MarketDataType } from "@stoqey/ib";
import { getConfig } from "../config.ts";
import { sendCriticalAlert } from "../utils/alert.ts";
import { createChildLogger } from "../utils/logger.ts";
import { withRetry } from "../utils/retry.ts";

const log = createChildLogger({ module: "broker-connection" });

let _api: IBApiNext | null = null;
let _connected = false;
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

	// Request delayed data as fallback when real-time isn't subscribed.
	// Without this, IBKR returns error 354 for exchanges without a data subscription.
	// DELAYED_FROZEN (4): real-time → delayed (15-20 min) → last frozen value.
	result.setMarketDataType(MarketDataType.DELAYED_FROZEN);
	log.info("Market data type set to DELAYED_FROZEN");

	// Monitor connection state changes
	_connected = true;
	_wasConnected = true;
	_disconnectAlerted = false;
	api.connectionState.subscribe((state) => {
		if (state === ConnectionState.Disconnected) {
			_connected = false;
			if (_wasConnected && !_disconnectAlerted) {
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
			}
		} else if (state === ConnectionState.Connected) {
			const wasDisconnected = !_connected;
			_connected = true;
			_disconnectAlerted = false;
			if (wasDisconnected && _wasConnected) {
				log.info("IBKR connection re-established after disconnect");
				api
					.getCurrentTime()
					.then((time: number) => {
						log.info({ serverTime: time }, "IBKR reconnection health check passed");
					})
					.catch((err: unknown) => {
						log.warn({ error: err }, "IBKR reconnection health check failed");
					});
			}
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
	return _api !== null && _connected;
}

export function waitForConnection(timeoutMs = 60000): Promise<boolean> {
	if (_connected) return Promise.resolve(true);
	return new Promise((resolve) => {
		const start = Date.now();
		const interval = setInterval(() => {
			if (_connected) {
				clearInterval(interval);
				resolve(true);
			} else if (Date.now() - start >= timeoutMs) {
				clearInterval(interval);
				resolve(false);
			}
		}, 1000);
	});
}
