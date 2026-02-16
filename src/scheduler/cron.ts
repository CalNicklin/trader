import cron, { type ScheduledTask } from "node-cron";
import { createChildLogger } from "../utils/logger.ts";
import { runJobs } from "./jobs.ts";

const log = createChildLogger({ module: "scheduler" });

const tasks: ScheduledTask[] = [];

export function startScheduler(): void {
	// Main orchestrator tick - every 10 minutes during potential market hours (7:30-17:00 UK)
	tasks.push(
		cron.schedule("*/10 7-16 * * 1-5", () => runJobs("orchestrator_tick"), {
			timezone: "Europe/London",
		}),
	);

	// Mini-analysis every 15 minutes during market hours (8:00-16:25)
	tasks.push(
		cron.schedule("*/15 8-15 * * 1-5", () => runJobs("mini_analysis"), {
			timezone: "Europe/London",
		}),
	);

	// Pre-market at 7:30
	tasks.push(
		cron.schedule("30 7 * * 1-5", () => runJobs("pre_market"), {
			timezone: "Europe/London",
		}),
	);

	// Post-market at 16:35
	tasks.push(
		cron.schedule("35 16 * * 1-5", () => runJobs("post_market"), {
			timezone: "Europe/London",
		}),
	);

	// Daily summary email at 17:00
	tasks.push(
		cron.schedule("0 17 * * 1-5", () => runJobs("daily_summary"), {
			timezone: "Europe/London",
		}),
	);

	// Research pipeline at 18:00 weekdays
	tasks.push(
		cron.schedule("0 18 * * 1-5", () => runJobs("research_pipeline"), {
			timezone: "Europe/London",
		}),
	);

	// Weekly summary at 17:30 Friday
	tasks.push(
		cron.schedule("30 17 * * 5", () => runJobs("weekly_summary"), {
			timezone: "Europe/London",
		}),
	);

	// Trade review at 17:15 weekdays
	tasks.push(
		cron.schedule("15 17 * * 1-5", () => runJobs("trade_review"), {
			timezone: "Europe/London",
		}),
	);

	// Mid-week pattern analysis at 19:00 Wednesday
	tasks.push(
		cron.schedule("0 19 * * 3", () => runJobs("mid_week_analysis"), {
			timezone: "Europe/London",
		}),
	);

	// End-of-week pattern analysis at 19:00 Friday
	tasks.push(
		cron.schedule("0 19 * * 5", () => runJobs("end_of_week_analysis"), {
			timezone: "Europe/London",
		}),
	);

	// Self-improvement at 20:00 Sunday
	tasks.push(
		cron.schedule("0 20 * * 0", () => runJobs("self_improvement"), {
			timezone: "Europe/London",
		}),
	);

	log.info({ jobCount: tasks.length }, "Scheduler started");
}

export function stopScheduler(): void {
	for (const task of tasks) {
		task.stop();
	}
	tasks.length = 0;
	log.info("Scheduler stopped");
}
