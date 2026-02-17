import { tick } from "../agent/orchestrator.ts";
import { isConnected } from "../broker/connection.ts";
import { sendEmail } from "../reporting/email.ts";
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
	| "self_improvement"
	| "trade_review"
	| "mid_week_analysis"
	| "end_of_week_analysis"
	| "heartbeat";

const BROKER_JOBS: ReadonlySet<JobName> = new Set([
	"orchestrator_tick",
	"mini_analysis",
	"pre_market",
	"post_market",
	"daily_summary",
]);

let jobRunning = false;

/** Maximum time a job can run before being force-released (30 minutes) */
const JOB_TIMEOUT_MS = 30 * 60 * 1000;

export async function runJobs(name: JobName): Promise<void> {
	if (jobRunning) {
		log.debug({ job: name }, "Skipping - previous job still running");
		return;
	}

	if (BROKER_JOBS.has(name) && !isConnected()) {
		log.warn({ job: name }, "Skipping - IBKR not connected");
		return;
	}

	jobRunning = true;
	const start = Date.now();
	log.info({ job: name }, "Job starting");

	try {
		const jobPromise = executeJob(name);
		const timeoutPromise = new Promise<never>((_, reject) => {
			setTimeout(
				() => reject(new Error(`Job ${name} timed out after ${JOB_TIMEOUT_MS / 60000}min`)),
				JOB_TIMEOUT_MS,
			);
		});

		await Promise.race([jobPromise, timeoutPromise]);

		log.info({ job: name, durationMs: Date.now() - start }, "Job completed");
	} catch (error) {
		log.error({ job: name, error, durationMs: Date.now() - start }, "Job failed");
	} finally {
		jobRunning = false;
	}
}

async function executeJob(name: JobName): Promise<void> {
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

		case "trade_review": {
			const { runTradeReview } = await import("../learning/trade-reviewer.ts");
			await runTradeReview();
			break;
		}

		case "mid_week_analysis": {
			const { runPatternAnalysis } = await import("../learning/pattern-analyzer.ts");
			await runPatternAnalysis("mid_week");
			break;
		}

		case "end_of_week_analysis": {
			const { runPatternAnalysis } = await import("../learning/pattern-analyzer.ts");
			await runPatternAnalysis("end_of_week");
			break;
		}

		case "heartbeat": {
			const uptimeHrs = (process.uptime() / 3600).toFixed(1);
			const hostname = require("node:os").hostname();
			await sendEmail({
				subject: `Heartbeat: Trader Agent alive — uptime ${uptimeHrs}h`,
				html: `<p>Trader Agent is running.</p><p>Hostname: ${hostname}<br>Uptime: ${uptimeHrs} hours<br>Time: ${new Date().toISOString()}</p>`,
			});
			break;
		}
	}
}
