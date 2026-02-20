import { extractFillData, mapIbStatus } from "./order-status.ts";
import type { ExecutionLike, OpenOrderLike, StatusUpdate, SubmittedTrade } from "./order-types.ts";

const TERMINAL_STATUSES = new Set(["FILLED", "CANCELLED", "ERROR"]);

export function computeReconciliation(
	submittedTrades: readonly SubmittedTrade[],
	ibOpenOrders: readonly OpenOrderLike[],
	ibExecutions: readonly ExecutionLike[],
): StatusUpdate[] {
	if (submittedTrades.length === 0) return [];

	const orderMap = new Map<number, OpenOrderLike>();
	for (const o of ibOpenOrders) {
		orderMap.set(o.orderId, o);
	}

	const executionMap = new Map<number, ExecutionLike>();
	for (const e of ibExecutions) {
		if (e.orderId !== undefined) {
			executionMap.set(e.orderId, e);
		}
	}

	const updates: StatusUpdate[] = [];

	for (const trade of submittedTrades) {
		const ibOrder = orderMap.get(trade.ibOrderId);

		if (ibOrder) {
			const ibStatus = ibOrder.orderState?.status;
			if (!ibStatus) continue;

			const mapped = mapIbStatus(ibStatus);
			if (!TERMINAL_STATUSES.has(mapped) && mapped === "SUBMITTED") continue;

			const fillData = mapped === "FILLED" ? extractFillData(ibOrder) : undefined;
			updates.push({ tradeId: trade.id, newStatus: mapped, fillData });
			continue;
		}

		const execution = executionMap.get(trade.ibOrderId);
		if (execution?.avgPrice) {
			updates.push({
				tradeId: trade.id,
				newStatus: "FILLED",
				fillData: { fillPrice: execution.avgPrice },
			});
		}
	}

	return updates;
}
