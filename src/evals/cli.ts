/**
 * CLI entry point for AI evals. Run via: bun run evals
 * Requires .env with ANTHROPIC_API_KEY. Copy .env.example to .env and fill in keys.
 * For local runs with existing API spend: EVAL_SKIP_BUDGET=true bun run evals
 */
import { runAiEvals } from "./runner.ts";

const suiteFilter = process.argv.slice(2).filter((a) => !a.startsWith("-"));
await runAiEvals(suiteFilter.length > 0 ? suiteFilter : undefined);
