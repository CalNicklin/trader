import { runSuites } from "./harness.ts";
import { logEvalResults } from "./logging.ts";
import { newsDiscoverySuite } from "./suites/news-discovery.ts";
import { quickScanSuite } from "./suites/quick-scan.ts";
import { researchSuite } from "./suites/research.ts";
import { tradingAnalystSuite } from "./suites/trading-analyst.ts";
import type { Suite } from "./types.ts";

const ALL_SUITES: readonly Suite[] = [
	quickScanSuite,
	tradingAnalystSuite,
	researchSuite,
	newsDiscoverySuite,
];

/**
 * Run all AI eval suites, log results, and respect the daily budget.
 * Triggered via the `ai_evals` job (POST /jobs/ai_evals).
 */
export async function runAiEvals(suiteNames?: readonly string[]): Promise<void> {
	const { createChildLogger } = await import("../utils/logger.ts");
	const log = createChildLogger({ module: "ai-evals" });

	const { canAffordSonnet } = await import("../utils/budget.ts");
	if (!(await canAffordSonnet())) {
		log.warn("Skipping AI evals — daily budget insufficient for Sonnet calls");
		return;
	}

	const suites = suiteNames
		? ALL_SUITES.filter((s) => suiteNames.includes(s.config.name))
		: ALL_SUITES;

	if (suites.length === 0) {
		log.warn("No matching suites to run");
		return;
	}

	log.info({ suites: suites.map((s) => s.config.name) }, "Starting AI eval run");

	const summaries = await runSuites(suites);
	await logEvalResults(summaries);

	const totalPassed = summaries.reduce((sum, s) => sum + (s.regressions.length === 0 ? 1 : 0), 0);
	log.info(
		{
			suitesRun: summaries.length,
			suitesPassed: totalPassed,
			totalTasks: summaries.reduce((sum, s) => sum + s.totalTasks, 0),
			totalTrials: summaries.reduce((sum, s) => sum + s.totalTrials, 0),
		},
		"AI eval run complete",
	);
}
