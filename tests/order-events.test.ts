import { expect, test } from "bun:test";
import { processOrderUpdate } from "../src/broker/order-events.ts";
import type { OpenOrderLike } from "../src/broker/order-types.ts";

function makeOpenOrder(orderId: number, status: string, avgFillPrice?: number): OpenOrderLike {
	return {
		orderId,
		orderState: { status },
		orderStatus: avgFillPrice !== undefined ? { avgFillPrice } : undefined,
	};
}

test("emits event for tracked order", () => {
	const tracked = new Map([[19, 5]]);
	const orders = [makeOpenOrder(19, "Filled", 150)];

	const events = processOrderUpdate(tracked, orders);

	expect(events).toHaveLength(1);
	expect(events[0]!.tradeId).toBe(5);
	expect(events[0]!.status).toBe("FILLED");
	expect(events[0]!.fillData?.fillPrice).toBe(150);
});

test("ignores untracked orders", () => {
	const tracked = new Map([[19, 5]]);
	const orders = [makeOpenOrder(99, "Filled", 200)];

	const events = processOrderUpdate(tracked, orders);
	expect(events).toHaveLength(0);
});

test("processes multiple tracked orders in one event", () => {
	const tracked = new Map([
		[19, 5],
		[20, 6],
	]);
	const orders = [makeOpenOrder(19, "Filled", 150), makeOpenOrder(20, "Submitted")];

	const events = processOrderUpdate(tracked, orders);
	expect(events).toHaveLength(2);
});

test("removes from map on terminal status", () => {
	const tracked = new Map([[19, 5]]);
	const orders = [makeOpenOrder(19, "Filled", 150)];

	processOrderUpdate(tracked, orders);

	expect(tracked.size).toBe(0);
});

test("does not remove on non-terminal status", () => {
	const tracked = new Map([[19, 5]]);
	const orders = [makeOpenOrder(19, "Submitted")];

	processOrderUpdate(tracked, orders);

	expect(tracked.has(19)).toBe(true);
});
