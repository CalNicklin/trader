import { expect, test } from "bun:test";
import { computeCleanupActions } from "../src/broker/order-cleanup.ts";
import type { StatusUpdate, SubmittedTrade } from "../src/broker/order-types.ts";

function makeTrade(id: number, ibOrderId: number): SubmittedTrade {
	return { id, ibOrderId, symbol: "SHEL", status: "SUBMITTED" };
}

test("trade reconciled as FILLED before cleanup — stays FILLED", () => {
	const trades = [makeTrade(1, 19)];
	const reconciled: StatusUpdate[] = [
		{ tradeId: 1, newStatus: "FILLED", fillData: { fillPrice: 150 } },
	];

	const actions = computeCleanupActions(trades, reconciled, true);

	expect(actions).toHaveLength(1);
	expect(actions[0]!.tradeId).toBe(1);
	expect(actions[0]!.action).toBe("FILLED");
	expect(actions[0]!.fillPrice).toBe(150);
});

test("trade genuinely unfilled (still open at IB) — stays SUBMITTED", () => {
	const trades = [makeTrade(1, 19)];
	const reconciled: StatusUpdate[] = [];

	const actions = computeCleanupActions(trades, reconciled, false);

	expect(actions).toHaveLength(0);
});

test("trade ambiguous (vanished, no execution) — stays SUBMITTED", () => {
	const trades = [makeTrade(1, 19)];
	const reconciled: StatusUpdate[] = [];

	const actions = computeCleanupActions(trades, reconciled, false);

	expect(actions).toHaveLength(0);
});

test("trade genuinely expired (post-market final) — marked CANCELLED", () => {
	const trades = [makeTrade(1, 19)];
	const reconciled: StatusUpdate[] = [];

	const actions = computeCleanupActions(trades, reconciled, true);

	expect(actions).toHaveLength(1);
	expect(actions[0]!.tradeId).toBe(1);
	expect(actions[0]!.action).toBe("CANCELLED");
});

test("mixed: one FILLED by reconciliation, one expired at post-market", () => {
	const trades = [makeTrade(1, 19), makeTrade(2, 20)];
	const reconciled: StatusUpdate[] = [
		{ tradeId: 1, newStatus: "FILLED", fillData: { fillPrice: 150 } },
	];

	const actions = computeCleanupActions(trades, reconciled, true);

	expect(actions).toHaveLength(2);

	const filled = actions.find((a) => a.tradeId === 1);
	expect(filled?.action).toBe("FILLED");
	expect(filled?.fillPrice).toBe(150);

	const cancelled = actions.find((a) => a.tradeId === 2);
	expect(cancelled?.action).toBe("CANCELLED");
});
