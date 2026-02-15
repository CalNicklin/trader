import Anthropic from "@anthropic-ai/sdk";
import { getConfig } from "../config.ts";
import { getDb } from "../db/client.ts";
import { agentLogs } from "../db/schema.ts";
import { createChildLogger } from "../utils/logger.ts";
import { recordUsage } from "../utils/token-tracker.ts";
import { RISK_REVIEWER_SYSTEM } from "./prompts/risk-reviewer.ts";
import { TRADING_ANALYST_SYSTEM } from "./prompts/trading-analyst.ts";
import { executeTool, toolDefinitions } from "./tools.ts";

const log = createChildLogger({ module: "agent-planner" });

let _client: Anthropic | null = null;

function getClient(): Anthropic {
	if (!_client) {
		_client = new Anthropic({ apiKey: getConfig().ANTHROPIC_API_KEY });
	}
	return _client;
}

export interface AgentResponse {
	text: string;
	toolCalls: { name: string; input: Record<string, unknown>; result: string }[];
	tokensUsed: { input: number; output: number };
}

/** Run the trading analyst agent with tool use */
export async function runTradingAnalyst(
	userMessage: string,
	maxIterations: number = 10,
): Promise<AgentResponse> {
	return runAgent(TRADING_ANALYST_SYSTEM, userMessage, toolDefinitions, maxIterations);
}

/** Run the risk reviewer (no tools - just analysis) */
export async function runRiskReviewer(tradeProposal: string): Promise<AgentResponse> {
	return runAgent(RISK_REVIEWER_SYSTEM, tradeProposal, [], 1);
}

/** Core agent loop with tool use */
async function runAgent(
	systemPrompt: string,
	userMessage: string,
	tools: Anthropic.Tool[],
	maxIterations: number,
): Promise<AgentResponse> {
	const client = getClient();
	const config = getConfig();
	const allToolCalls: AgentResponse["toolCalls"] = [];
	let totalInputTokens = 0;
	let totalOutputTokens = 0;
	let totalCacheCreationTokens = 0;
	let totalCacheReadTokens = 0;

	// Set up prompt caching: mark system prompt and last tool for caching
	const system: Anthropic.TextBlockParam[] = [
		{
			type: "text",
			text: systemPrompt,
			cache_control: { type: "ephemeral" },
		},
	];

	const cachedTools =
		tools.length > 0
			? tools.map((tool, i) =>
					i === tools.length - 1
						? { ...tool, cache_control: { type: "ephemeral" as const } }
						: tool,
				)
			: undefined;

	const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];

	for (let i = 0; i < maxIterations; i++) {
		const response = await client.messages.create({
			model: config.CLAUDE_MODEL,
			max_tokens: 4096,
			system,
			tools: cachedTools,
			messages,
		});

		totalInputTokens += response.usage.input_tokens;
		totalOutputTokens += response.usage.output_tokens;
		totalCacheCreationTokens += response.usage.cache_creation_input_tokens ?? 0;
		totalCacheReadTokens += response.usage.cache_read_input_tokens ?? 0;

		// Check if we need to process tool calls
		if (response.stop_reason === "tool_use") {
			const assistantContent = response.content;
			messages.push({ role: "assistant", content: assistantContent });

			const toolResults: Anthropic.ToolResultBlockParam[] = [];

			for (const block of assistantContent) {
				if (block.type === "tool_use") {
					log.info({ tool: block.name, input: block.input }, "Agent calling tool");

					// Log to DB
					const db = getDb();
					await db.insert(agentLogs).values({
						level: "ACTION",
						phase: "trading",
						message: `Tool call: ${block.name}`,
						data: JSON.stringify(block.input),
					});

					const result = await executeTool(block.name, block.input as Record<string, unknown>);
					allToolCalls.push({
						name: block.name,
						input: block.input as Record<string, unknown>,
						result,
					});

					toolResults.push({
						type: "tool_result",
						tool_use_id: block.id,
						content: result,
					});
				}
			}

			messages.push({ role: "user", content: toolResults });
		} else {
			// Final response - extract text
			const textBlocks = response.content
				.filter((b): b is Anthropic.TextBlock => b.type === "text")
				.map((b) => b.text);

			const responseText = textBlocks.join("\n");

			// Log the final decision
			const db = getDb();
			await db.insert(agentLogs).values({
				level: "DECISION",
				phase: "trading",
				message: responseText.substring(0, 500),
				data: JSON.stringify({
					tokensUsed: { input: totalInputTokens, output: totalOutputTokens },
				}),
			});

			log.info(
				{
					iterations: i + 1,
					toolCalls: allToolCalls.length,
					tokens: totalInputTokens + totalOutputTokens,
					cacheRead: totalCacheReadTokens,
				},
				"Agent completed",
			);

			await recordUsage(
				"trading_analyst",
				totalInputTokens,
				totalOutputTokens,
				totalCacheCreationTokens,
				totalCacheReadTokens,
			);

			return {
				text: responseText,
				toolCalls: allToolCalls,
				tokensUsed: { input: totalInputTokens, output: totalOutputTokens },
			};
		}
	}

	// Hit max iterations
	log.warn({ maxIterations }, "Agent hit max iterations");
	return {
		text: "Max iterations reached without final response",
		toolCalls: allToolCalls,
		tokensUsed: { input: totalInputTokens, output: totalOutputTokens },
	};
}
