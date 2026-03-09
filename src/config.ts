import { z } from "zod";

const envSchema = z.object({
	// IBKR
	IBKR_HOST: z.string().default("127.0.0.1"),
	IBKR_PORT: z.coerce.number().default(4002),
	IBKR_CLIENT_ID: z.coerce.number().default(1),

	// Claude
	ANTHROPIC_API_KEY: z.string(),
	CLAUDE_MODEL: z.string().default("claude-sonnet-4-5-20250929"),
	CLAUDE_MODEL_STANDARD: z.string().default("claude-haiku-4-5-20251001"),
	CLAUDE_MODEL_FAST: z.string().default("claude-haiku-4-5-20251001"),

	// Resend
	RESEND_API_KEY: z.string(),
	ALERT_EMAIL_FROM: z.string().default("trader@updates.example.com"),
	ALERT_EMAIL_TO: z.string(),

	// GitHub (for self-improvement PRs)
	GITHUB_TOKEN: z.string().optional(),
	GITHUB_REPO_OWNER: z.string().optional(),
	GITHUB_REPO_NAME: z.string().default("trader"),

	// Database
	DB_PATH: z.string().default("./data/trader.db"),

	// Logging
	LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

	// Environment
	NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

	// Trading mode
	PAPER_TRADING: z
		.string()
		.default("true")
		.transform((v) => v === "true"),

	// FMP (Financial Modeling Prep) API
	FMP_API_KEY: z.string().optional(),

	// Cost control
	ESCALATION_COOLDOWN_MIN: z.coerce.number().default(20),
	MATERIAL_CHANGE_PCT: z.coerce.number().default(2),
	DAILY_API_BUDGET_USD: z.coerce.number().default(0), // 0 = no limit; set e.g. 3 to cap daily spend
	MAX_AGENT_ITERATIONS: z.coerce.number().default(8),
});

export type Config = z.infer<typeof envSchema>;

let _config: Config | null = null;

/** Reset cached config (for tests that need to re-parse with different env) */
export function resetConfigForTesting(): void {
	_config = null;
}

export function getConfig(): Config {
	if (!_config) {
		const result = envSchema.safeParse(process.env);
		if (!result.success) {
			console.error("Invalid environment variables:");
			for (const issue of result.error.issues) {
				console.error(`  ${issue.path.join(".")}: ${issue.message}`);
			}
			process.exit(1);
		}
		_config = result.data;
	}
	return _config;
}
