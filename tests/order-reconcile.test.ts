import { expect, test } from "bun:test";
import { computeReconciliation } from "../src/broker/order-reconcile.ts";
import type { ExecutionLike, OpenOrderLike, SubmittedTrade } from "../src/broker/order-types.ts";

function makeTrade(id: number, ibOrderId: number): SubmittedTrade {
	return { id, ibOrderId, symbol: "SHEL", status: "SUBMITTED" };
}

function makeOpenOrder(orderId: number, status: string, avgFillPrice?: number): OpenOrderLike {
	return {
		orderId,
		orderState: { status },
		orderStatus: avgFillPrice !== undefined ? { avgFillPrice } : undefined,
	};
}

function makeExecution(orderId: number, avgPrice: number): ExecutionLike {
	return { orderId, avgPrice, shares: 100, side: "BOT" };
}

test("order still open at IB — no update", () => {
	const trades = [makeTrade(1, 19)];
	const openOrders = [makeOpenOrder(19, "Submitted")];
	const executions: ExecutionLike[] = [];

	const updates = computeReconciliation(trades, openOrders, executions);
	expect(updates).toHaveLength(0);
});

test("order filled at IB (in open orders)", () => {
	const trades = [makeTrade(1, 19)];
	const openOrders = [makeOpenOrder(19, "Filled", 150)];
	const executions: ExecutionLike[] = [];

	const updates = computeReconciliation(trades, openOrders, executions);

	expect(updates).toHaveLength(1);
	expect(updates[0]!.tradeId).toBe(1);
	expect(updates[0]!.newStatus).toBe("FILLED");
	expect(updates[0]!.fillData?.fillPrice).toBe(150);
});

test("order vanished, execution found (fast fill)", () => {
	const trades = [makeTrade(1, 19)];
	const openOrders: OpenOrderLike[] = [];
	const executions = [makeExecution(19, 148.5)];

	const updates = computeReconciliation(trades, openOrders, executions);

	expect(updates).toHaveLength(1);
	expect(updates[0]!.tradeId).toBe(1);
	expect(updates[0]!.newStatus).toBe("FILLED");
	expect(updates[0]!.fillData?.fillPrice).toBe(148.5);
});

test("order vanished, no execution (ambiguous) — no update", () => {
	const trades = [makeTrade(1, 19)];
	const openOrders: OpenOrderLike[] = [];
	const executions: ExecutionLike[] = [];

	const updates = computeReconciliation(trades, openOrders, executions);
	expect(updates).toHaveLength(0);
});

test("order cancelled at IB", () => {
	const trades = [makeTrade(1, 19)];
	const openOrders = [makeOpenOrder(19, "Cancelled")];
	const executions: ExecutionLike[] = [];

	const updates = computeReconciliation(trades, openOrders, executions);

	expect(updates).toHaveLength(1);
	expect(updates[0]!.tradeId).toBe(1);
	expect(updates[0]!.newStatus).toBe("CANCELLED");
});

test("multiple trades, mixed states", () => {
	const trades = [makeTrade(1, 19), makeTrade(2, 20), makeTrade(3, 21)];
	const openOrders = [makeOpenOrder(19, "Filled", 150), makeOpenOrder(20, "Submitted")];
	const executions = [makeExecution(21, 200)];

	const updates = computeReconciliation(trades, openOrders, executions);

	expect(updates).toHaveLength(2);

	const update19 = updates.find((u) => u.tradeId === 1);
	expect(update19?.newStatus).toBe("FILLED");
	expect(update19?.fillData?.fillPrice).toBe(150);

	const update21 = updates.find((u) => u.tradeId === 3);
	expect(update21?.newStatus).toBe("FILLED");
	expect(update21?.fillData?.fillPrice).toBe(200);
});

test("no SUBMITTED trades — empty result", () => {
	const trades: SubmittedTrade[] = [];
	const openOrders = [makeOpenOrder(19, "Filled", 150)];
	const executions = [makeExecution(19, 150)];

	const updates = computeReconciliation(trades, openOrders, executions);
	expect(updates).toHaveLength(0);
});
