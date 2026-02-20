import { type Contract, SecType } from "@stoqey/ib";
import { createChildLogger } from "../utils/logger.ts";
import { getApi } from "./connection.ts";

const log = createChildLogger({ module: "broker-contracts" });

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

/** Look up contract details for an LSE symbol */
export async function getContractDetails(symbol: string) {
	const api = getApi();
	const contract = lseStock(symbol);

	const details = await api.getContractDetails(contract);
	log.debug({ symbol, count: details.length }, "Contract details fetched");
	return details;
}

/** Search for contracts matching a pattern */
export async function searchContracts(pattern: string) {
	const api = getApi();
	const contract: Contract = {
		symbol: pattern,
		secType: SecType.STK,
		exchange: "LSE",
		currency: "GBP",
	};

	const details = await api.getContractDetails(contract);
	return details.map((d) => ({
		symbol: d.contract.symbol,
		conId: d.contract.conId,
		localSymbol: d.contract.localSymbol,
		longName: d.longName,
		industry: d.industry,
		category: d.category,
		subcategory: d.subcategory,
	}));
}

/** Validate that a symbol exists on LSE and get its conId */
export async function validateSymbol(
	symbol: string,
): Promise<{ valid: boolean; conId?: number; longName?: string }> {
	try {
		const details = await getContractDetails(symbol);
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
		log.warn({ symbol, error }, "Symbol validation failed");
		return { valid: false };
	}
}
