import { type Contract, type Order, OrderAction, type OrderState, OrderType } from "@stoqey/ib";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { trades } from "../db/schema.ts";
import { createChildLogger } from "../utils/logger.ts";
import { getApi } from "./connection.ts";
import { lseStock } from "./contracts.ts";

const log = createChildLogger({ module: "broker-orders" });

export interface TradeRequest {
	symbol: string;
	side: "BUY" | "SELL";
	quantity: number;
	orderType: "LIMIT" | "MARKET";
	limitPrice?: number;
	reasoning?: string;
	confidence?: number;
}

export interface TradeResult {
	tradeId: number;
	ibOrderId: number;
	status: string;
}

/** Place a trade order and log it to the database */
export async function placeTrade(req: TradeRequest): Promise<TradeResult> {
	const db = getDb();
	const api = getApi();
	const contract = lseStock(req.symbol);

	// Insert trade record
	const [tradeRecord] = await db
		.insert(trades)
		.values({
			symbol: req.symbol,
			side: req.side,
			quantity: req.quantity,
			orderType: req.orderType,
			limitPrice: req.limitPrice,
			reasoning: req.reasoning,
			confidence: req.confidence,
			status: "PENDING",
		})
		.returning();

	if (!tradeRecord) {
		throw new Error("Failed to create trade record");
	}

	// Build IBKR order
	const order: Order = {
		action: req.side === "BUY" ? OrderAction.BUY : OrderAction.SELL,
		totalQuantity: req.quantity,
		orderType: req.orderType === "LIMIT" ? OrderType.LMT : OrderType.MKT,
		tif: "DAY",
		transmit: true,
	};

	if (req.orderType === "LIMIT" && req.limitPrice) {
		order.lmtPrice = req.limitPrice;
	}

	try {
		const ibOrderId = await api.placeNewOrder(contract, order);

		await db
			.update(trades)
			.set({ ibOrderId, status: "SUBMITTED", updatedAt: new Date().toISOString() })
			.where(eq(trades.id, tradeRecord.id));

		log.info(
			{ tradeId: tradeRecord.id, ibOrderId, symbol: req.symbol, side: req.side, qty: req.quantity },
			"Order placed",
		);

		// Start monitoring order status
		monitorOrder(tradeRecord.id, ibOrderId, contract);

		return { tradeId: tradeRecord.id, ibOrderId, status: "SUBMITTED" };
	} catch (error) {
		await db
			.update(trades)
			.set({ status: "ERROR", updatedAt: new Date().toISOString() })
			.where(eq(trades.id, tradeRecord.id));

		log.error({ tradeId: tradeRecord.id, error }, "Failed to place order");
		throw error;
	}
}

/** Monitor an order for fills and status updates */
function monitorOrder(tradeId: number, ibOrderId: number, _contract: Contract): void {
	const api = getApi();
	const db = getDb();

	const sub = api.getOpenOrders().subscribe({
		next: (update) => {
			for (const openOrder of update.all) {
				if (openOrder.orderId === ibOrderId) {
					const status = openOrder.orderState?.status;
					if (status) {
						updateTradeStatus(db, tradeId, status, openOrder.orderState);
					}
					if (status === "Filled" || status === "Cancelled" || status === "Inactive") {
						sub.unsubscribe();
					}
				}
			}
		},
	});

	// Auto-unsubscribe after 1 hour
	setTimeout(() => sub.unsubscribe(), 3600000);
}

async function updateTradeStatus(
	db: ReturnType<typeof getDb>,
	tradeId: number,
	ibStatus: string,
	orderState?: OrderState,
): Promise<void> {
	const statusMap: Record<string, string> = {
		Submitted: "SUBMITTED",
		Filled: "FILLED",
		Cancelled: "CANCELLED",
		Inactive: "ERROR",
		PreSubmitted: "SUBMITTED",
	};

	const mappedStatus = statusMap[ibStatus] ?? "SUBMITTED";
	const updateData: Record<string, unknown> = {
		status: mappedStatus,
		updatedAt: new Date().toISOString(),
	};

	if (mappedStatus === "FILLED") {
		updateData.filledAt = new Date().toISOString();
		if (orderState?.commission !== undefined && orderState.commission < 1e9) {
			updateData.commission = orderState.commission;
		}
	}

	await db.update(trades).set(updateData).where(eq(trades.id, tradeId));
	log.info({ tradeId, status: mappedStatus }, "Trade status updated");
}

/** Cancel an order */
export async function cancelOrder(ibOrderId: number): Promise<void> {
	const api = getApi();
	api.cancelOrder(ibOrderId);
	log.info({ ibOrderId }, "Order cancellation requested");
}

/** Get all open orders */
export async function getOpenOrders() {
	const api = getApi();
	return api.getAllOpenOrders();
}
