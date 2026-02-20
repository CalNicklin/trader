import type { StatusUpdate, SubmittedTrade } from "./order-types.ts";

export interface CleanupAction {
	readonly tradeId: number;
	readonly action: "FILLED" | "CANCELLED";
	readonly fillPrice?: number;
	readonly commission?: number;
}

/**
 * Pure decision: given SUBMITTED trades and reconciliation results,
 * determine what cleanup actions to take.
 *
 * @param isFinalCleanup - true at post-market when unreconciled trades
 *   should be marked CANCELLED (legitimate expiry)
 */
export function computeCleanupActions(
	submittedTrades: readonly SubmittedTrade[],
	reconciled: readonly StatusUpdate[],
	isFinalCleanup: boolean,
): CleanupAction[] {
	const reconciledMap = new Map<number, StatusUpdate>();
	for (const update of reconciled) {
		reconciledMap.set(update.tradeId, update);
	}

	const actions: CleanupAction[] = [];

	for (const trade of submittedTrades) {
		const recon = reconciledMap.get(trade.id);

		if (recon) {
			if (recon.newStatus === "FILLED") {
				actions.push({
					tradeId: trade.id,
					action: "FILLED",
					fillPrice: recon.fillData?.fillPrice,
					commission: recon.fillData?.commission,
				});
			} else if (recon.newStatus === "CANCELLED") {
				actions.push({ tradeId: trade.id, action: "CANCELLED" });
			}
			continue;
		}

		if (isFinalCleanup) {
			actions.push({ tradeId: trade.id, action: "CANCELLED" });
		}
	}

	return actions;
}
