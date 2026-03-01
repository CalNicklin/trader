import type { RunSummary } from "./types.ts";

/**
 * Log eval results to agent_logs with phase='eval'.
 * Includes pass rate, score distributions, and regression detection vs previous run.
 */
export async function logEvalResults(summaries: readonly RunSummary[]): Promise<void> {
	const { getDb } = await import("../db/client.ts");
	const { agentLogs } = await import("../db/schema.ts");
	const { createChildLogger } = await import("../utils/logger.ts");
	const log = createChildLogger({ module: "eval-logging" });

	const db = getDb();

	for (const summary of summaries) {
		const passPercent = Math.round(summary.passRate * 100);
		const scoreStr = summary.avgScore !== null ? ` avgScore=${summary.avgScore.toFixed(2)}` : "";
		const status = summary.regressions.length === 0 ? "PASS" : "FAIL";

		await db.insert(agentLogs).values({
			level: summary.regressions.length === 0 ? "INFO" : "WARN",
			phase: "eval",
			message: `[${status}] ${summary.suite}: ${passPercent}% pass (${summary.totalTasks} tasks, ${summary.totalTrials} trials)${scoreStr}`,
			data: JSON.stringify({
				suite: summary.suite,
				totalTasks: summary.totalTasks,
				totalTrials: summary.totalTrials,
				passRate: summary.passRate,
				avgScore: summary.avgScore,
				regressionCount: summary.regressions.length,
				regressionTaskIds: summary.regressions.map((r) => r.taskId),
				durationMs: Math.round(summary.durationMs),
			}),
		});

		for (const regression of summary.regressions) {
			const failedGraders = regression.graderResults
				.filter((g) => g.kind === "fail")
				.map((g) => `${g.grader}: ${g.detail}`)
				.join("; ");

			await db.insert(agentLogs).values({
				level: "WARN",
				phase: "eval",
				message: `[REGRESSION] ${summary.suite}/${regression.taskId}: ${failedGraders}`,
				data: JSON.stringify({
					suite: summary.suite,
					taskId: regression.taskId,
					graderResults: regression.graderResults,
				}),
			});
		}

		log.info(
			{
				suite: summary.suite,
				passRate: passPercent,
				regressions: summary.regressions.length,
				durationMs: Math.round(summary.durationMs),
			},
			"Eval results logged",
		);
	}
}
