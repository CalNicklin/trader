import type { DbClient } from "../db/client.ts";
import { agentLogs } from "../db/schema.ts";

interface PipelineEvent {
	phase: string;
	message: string;
	data?: Record<string, unknown>;
	level?: "INFO" | "WARN" | "ERROR";
}

/** Write a structured pipeline event to agent_logs for persistent observability */
export async function logPipelineEvent(db: DbClient, event: PipelineEvent): Promise<void> {
	await db.insert(agentLogs).values({
		level: event.level ?? "INFO",
		phase: event.phase,
		message: event.message,
		data: event.data ? JSON.stringify(event.data) : null,
	});
}
