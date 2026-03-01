import { desc } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { escalationState } from "../db/schema.ts";
import { createChildLogger } from "../utils/logger.ts";

export { computeFingerprint } from "./fingerprint.ts";

const log = createChildLogger({ module: "escalation-state" });

export type EscalationConclusion = "hold" | "acted" | "error";

export interface EscalationSnapshot {
	fingerprint: string;
	timestamp: number;
	conclusion: EscalationConclusion;
}

let cached: EscalationSnapshot | null = null;

export function getLastEscalation(): EscalationSnapshot | null {
	return cached;
}

export async function recordEscalation(
	fingerprint: string,
	conclusion: EscalationConclusion,
): Promise<void> {
	const db = getDb();
	const now = Date.now();
	await db.insert(escalationState).values({ fingerprint, conclusion });
	cached = { fingerprint, timestamp: now, conclusion };
	log.info({ conclusion, fingerprint: fingerprint.substring(0, 16) }, "Escalation state recorded");
}

export async function hydrateEscalationState(): Promise<void> {
	const db = getDb();
	const [row] = await db
		.select()
		.from(escalationState)
		.orderBy(desc(escalationState.createdAt))
		.limit(1);

	if (row) {
		cached = {
			fingerprint: row.fingerprint,
			timestamp: new Date(row.createdAt).getTime(),
			conclusion: row.conclusion as EscalationConclusion,
		};
		log.info(
			{
				conclusion: cached.conclusion,
				age: `${Math.round((Date.now() - cached.timestamp) / 60_000)}m`,
			},
			"Escalation state hydrated from DB",
		);
	}
}
