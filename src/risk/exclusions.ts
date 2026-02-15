import { getDb } from "../db/client.ts";
import { exclusions } from "../db/schema.ts";
import { createChildLogger } from "../utils/logger.ts";

const log = createChildLogger({ module: "risk-exclusions" });

interface ExclusionEntry {
	type: "SYMBOL" | "SECTOR" | "SIC_CODE";
	value: string;
	reason: string;
}

let _cache: ExclusionEntry[] | null = null;

/** Load exclusions from DB (cached) */
async function loadExclusions(): Promise<ExclusionEntry[]> {
	if (_cache) return _cache;
	const db = getDb();
	const rows = await db.select().from(exclusions);
	_cache = rows.map((r) => ({ type: r.type, value: r.value, reason: r.reason }));
	return _cache;
}

/** Clear the cache (call after modifying exclusions) */
export function clearExclusionsCache(): void {
	_cache = null;
}

/** Check if a symbol is excluded */
export async function isSymbolExcluded(
	symbol: string,
): Promise<{ excluded: boolean; reason?: string }> {
	const entries = await loadExclusions();
	const match = entries.find(
		(e) => e.type === "SYMBOL" && e.value.toUpperCase() === symbol.toUpperCase(),
	);
	if (match) {
		log.warn({ symbol, reason: match.reason }, "Symbol is excluded");
		return { excluded: true, reason: match.reason };
	}
	return { excluded: false };
}

/** Check if a sector is excluded */
export async function isSectorExcluded(
	sector: string,
): Promise<{ excluded: boolean; reason?: string }> {
	const entries = await loadExclusions();
	const match = entries.find(
		(e) => e.type === "SECTOR" && e.value.toUpperCase() === sector.toUpperCase(),
	);
	if (match) {
		log.warn({ sector, reason: match.reason }, "Sector is excluded");
		return { excluded: true, reason: match.reason };
	}
	return { excluded: false };
}

/** Check if a SIC code is excluded */
export async function isSicCodeExcluded(
	sicCode: string,
): Promise<{ excluded: boolean; reason?: string }> {
	const entries = await loadExclusions();
	const match = entries.find((e) => e.type === "SIC_CODE" && e.value === sicCode);
	if (match) {
		log.warn({ sicCode, reason: match.reason }, "SIC code is excluded");
		return { excluded: true, reason: match.reason };
	}
	return { excluded: false };
}

/** Get all exclusions */
export async function getAllExclusions(): Promise<ExclusionEntry[]> {
	return loadExclusions();
}
