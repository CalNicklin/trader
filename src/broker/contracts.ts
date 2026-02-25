import { type Contract, SecType } from "@stoqey/ib";
import { createChildLogger } from "../utils/logger.ts";
import { getApi } from "./connection.ts";

const log = createChildLogger({ module: "broker-contracts" });

export type Exchange = "LSE" | "NASDAQ" | "NYSE";

/** Create a Contract for an LSE-listed stock.
 *  Uses SMART routing — IB paper trading doesn't fill direct LSE-routed orders. */
export function lseStock(symbol: string): Contract {
	return {
		symbol,
		secType: SecType.STK,
		exchange: "SMART",
		primaryExch: "LSE",
		currency: "GBP",
	};
}

/** Create a Contract for a US-listed stock (NASDAQ or NYSE). */
export function usStock(symbol: string, exchange: "NASDAQ" | "NYSE"): Contract {
	return {
		symbol,
		secType: SecType.STK,
		exchange: "SMART",
		primaryExch: exchange,
		currency: "USD",
	};
}

/** Dispatch to the correct contract builder based on exchange. */
export function getContract(symbol: string, exchange: Exchange): Contract {
	if (exchange === "LSE") return lseStock(symbol);
	return usStock(symbol, exchange);
}

/** Look up contract details for a symbol on a given exchange. */
export async function getContractDetails(symbol: string, exchange: Exchange = "LSE") {
	const api = getApi();
	const contract = getContract(symbol, exchange);

	const details = await api.getContractDetails(contract);
	log.debug({ symbol, exchange, count: details.length }, "Contract details fetched");
	return details;
}

/** Search for contracts matching a pattern on a given exchange (or all if not specified). */
export async function searchContracts(pattern: string, exchange?: Exchange) {
	const api = getApi();
	const contract: Contract = exchange
		? getContract(pattern, exchange)
		: { symbol: pattern, secType: SecType.STK, exchange: "SMART", currency: "USD" };

	const details = await api.getContractDetails(contract);
	return details.map((d) => ({
		symbol: d.contract.symbol,
		conId: d.contract.conId,
		localSymbol: d.contract.localSymbol,
		primaryExch: d.contract.primaryExch,
		longName: d.longName,
		industry: d.industry,
		category: d.category,
		subcategory: d.subcategory,
	}));
}

/** Validate that a symbol exists on a given exchange and get its conId. */
export async function validateSymbol(
	symbol: string,
	exchange: Exchange = "LSE",
): Promise<{ valid: boolean; conId?: number; longName?: string }> {
	try {
		const details = await getContractDetails(symbol, exchange);
		if (details.length > 0) {
			const first = details[0]!;
			return {
				valid: true,
				conId: first.contract.conId,
				longName: first.longName,
			};
		}
		return { valid: false };
	} catch (error) {
		log.warn({ symbol, exchange, error }, "Symbol validation failed");
		return { valid: false };
	}
}
