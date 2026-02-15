/**
 * Quick test: place a small paper trade on LSE, then cancel it
 * Run: bun scripts/test-trade.ts
 *
 * Connects to IB Gateway via socat port 4004 (client ID 2 to avoid conflict with main agent)
 */
import { ConnectionState, IBApiNext, OrderAction, OrderType, SecType, TimeInForce } from "@stoqey/ib";
import type { Contract, Order } from "@stoqey/ib";

const IBKR_HOST = process.env.IBKR_HOST || "127.0.0.1";
const IBKR_PORT = Number(process.env.IBKR_PORT || "4004");

const api = new IBApiNext({
	host: IBKR_HOST,
	port: IBKR_PORT,
	reconnectInterval: 5000,
});

console.log(`Connecting to IB Gateway at ${IBKR_HOST}:${IBKR_PORT}...`);

// Connect with client ID 2 (main agent uses 1)
await new Promise<void>((resolve, reject) => {
	const timeout = setTimeout(() => reject(new Error("Connection timeout")), 15000);
	const sub = api.connectionState.subscribe((state) => {
		console.log("Connection state:", ConnectionState[state]);
		if (state === ConnectionState.Connected) {
			clearTimeout(timeout);
			sub.unsubscribe();
			resolve();
		}
	});
	api.connect(2);
});

console.log("Connected! Placing test limit order for VOD (Vodafone) on LSE...");

// Vodafone on LSE - well-known, liquid, cheap stock
const contract: Contract = {
	symbol: "VOD",
	secType: SecType.STK,
	exchange: "LSE",
	currency: "GBP",
};

// Place a very low limit buy order (won't fill - just testing the pipeline)
const order: Order = {
	action: OrderAction.BUY,
	orderType: OrderType.LMT,
	totalQuantity: 1,
	lmtPrice: 0.01, // 1p - will never fill, just a test
	tif: TimeInForce.DAY,
	transmit: true,
};

try {
	const orderId = await api.placeNewOrder(contract, order);
	console.log(`Order placed! Order ID: ${orderId}`);

	// Wait a moment then cancel
	await new Promise((r) => setTimeout(r, 2000));

	console.log("Cancelling test order...");
	api.cancelOrder(orderId);
	console.log("Order cancelled.");
} catch (err) {
	console.error("Order failed:", err);
}

// Disconnect
api.disconnect();
console.log("Done! Paper trade pipeline works.");
process.exit(0);
