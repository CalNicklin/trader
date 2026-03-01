import type { EvalTask } from "../types.ts";

/**
 * Load frozen Quick Scan eval tasks from production data.
 * Seeded from agent_logs with haiku_no_escalate/escalation entries.
 */
export async function loadQuickScanTasks(): Promise<readonly EvalTask[]> {
	return [];
}

/**
 * Load frozen Trading Analyst eval tasks from production data.
 * Seeded from agent_logs DECISION entries with data.quotes/gateStates.
 */
export async function loadTradingAnalystTasks(): Promise<readonly EvalTask[]> {
	return [];
}

/**
 * Load frozen Research Analyzer eval tasks from production data.
 * Seeded from research table entries with rawData.
 */
export async function loadResearchTasks(): Promise<readonly EvalTask[]> {
	return [];
}

/**
 * Load frozen News Discovery eval tasks from production data.
 * Seeded from agent_logs with phase='news_discovery'.
 */
export async function loadNewsDiscoveryTasks(): Promise<readonly EvalTask[]> {
	return [];
}
