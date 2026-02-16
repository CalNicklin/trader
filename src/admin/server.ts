import { type JobName, runJobs } from "../scheduler/jobs.ts";
import { createChildLogger } from "../utils/logger.ts";

const log = createChildLogger({ module: "admin" });

const ADMIN_PORT = 3847;

const VALID_JOBS: ReadonlySet<string> = new Set<JobName>([
	"orchestrator_tick",
	"mini_analysis",
	"pre_market",
	"post_market",
	"daily_summary",
	"weekly_summary",
	"research_pipeline",
	"self_improvement",
	"trade_review",
	"mid_week_analysis",
	"end_of_week_analysis",
]);

let server: ReturnType<typeof Bun.serve> | null = null;

export function startAdminServer(): void {
	server = Bun.serve({
		port: ADMIN_PORT,
		hostname: "127.0.0.1",
		fetch(req) {
			const url = new URL(req.url);

			if (url.pathname === "/health") {
				return Response.json({ ok: true, uptime: process.uptime() });
			}

			if (req.method === "POST" && url.pathname.startsWith("/jobs/")) {
				const jobName = url.pathname.slice("/jobs/".length);

				if (!VALID_JOBS.has(jobName)) {
					return Response.json(
						{ ok: false, error: `Unknown job: ${jobName}`, validJobs: [...VALID_JOBS] },
						{ status: 400 },
					);
				}

				log.info({ job: jobName }, "Ad-hoc job triggered");

				runJobs(jobName as JobName).catch((error) => {
					log.error({ job: jobName, error }, "Ad-hoc job failed");
				});

				return Response.json({ ok: true, job: jobName, message: "Job started" });
			}

			return Response.json({ error: "Not found" }, { status: 404 });
		},
	});

	log.info({ port: ADMIN_PORT }, "Admin server started");
}

export function stopAdminServer(): void {
	if (server) {
		server.stop();
		server = null;
		log.info("Admin server stopped");
	}
}
