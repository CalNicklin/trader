import { tick } from "../agent/orchestrator.ts";
import { createChildLogger } from "../utils/logger.ts";

const log = createChildLogger({ module: "scheduler-jobs" });

export type JobName =
	| "orchestrator_tick"
	| "mini_analysis"
	| "pre_market"
	| "post_market"
	| "daily_summary"
	| "weekly_summary"
	| "research_pipeline"
	| "self_improvement";

let jobRunning = false;

export async function runJobs(name: JobName): Promise<void> {
	if (jobRunning) {
		log.debug({ job: name }, "Skipping - previous job still running");
		return;
	}

	jobRunning = true;
	const start = Date.now();
	log.info({ job: name }, "Job starting");

	try {
		switch (name) {
			case "orchestrator_tick":
			case "mini_analysis":
			case "pre_market":
			case "post_market":
				await tick();
				break;

			case "daily_summary": {
				const { sendDailySummary } = await import("../reporting/templates/daily-summary.ts");
				await sendDailySummary();
				break;
			}

			case "weekly_summary": {
				const { sendWeeklySummary } = await import("../reporting/templates/weekly-summary.ts");
				await sendWeeklySummary();
				break;
			}

			case "research_pipeline": {
				const { runResearchPipeline } = await import("../research/pipeline.ts");
				await runResearchPipeline();
				break;
			}

			case "self_improvement": {
				const { runSelfImprovement } = await import("../self-improve/monitor.ts");
				await runSelfImprovement();
				break;
			}
		}

		log.info({ job: name, durationMs: Date.now() - start }, "Job completed");
	} catch (error) {
		log.error({ job: name, error, durationMs: Date.now() - start }, "Job failed");
	} finally {
		jobRunning = false;
	}
}
