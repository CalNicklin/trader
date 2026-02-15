import Anthropic from "@anthropic-ai/sdk";
import { and, eq, gte, lte } from "drizzle-orm";
import { getConfig } from "../config.ts";
import { getDb } from "../db/client.ts";
import { agentLogs, research, tradeReviews, trades } from "../db/schema.ts";
import { createChildLogger } from "../utils/logger.ts";
import { recordUsage } from "../utils/token-tracker.ts";
import { TRADE_REVIEWER_SYSTEM } from "./prompts.ts";

const log = createChildLogger({ module: "trade-reviewer" });

interface ReviewResult {
	outcome: "win" | "loss" | "breakeven";
	reasoningQuality: "sound" | "partial" | "flawed";
	lessonLearned: string;
	tags: string[];
	shouldRepeat: boolean;
}

export async function runTradeReview(): Promise<void> {
	log.info("Trade review starting");
	const db = getDb();
	const config = getConfig();

	const today = new Date().toISOString().split("T")[0]!;
	const todayStart = `${today}T00:00:00`;
	const todayEnd = `${today}T23:59:59`;

	// Get today's filled trades that have PnL
	const filledTrades = await db
		.select()
		.from(trades)
		.where(
			and(
				eq(trades.status, "FILLED"),
				gte(trades.createdAt, todayStart),
				lte(trades.createdAt, todayEnd),
			),
		);

	const tradesWithPnl = filledTrades.filter((t) => t.pnl !== null);

	if (tradesWithPnl.length === 0) {
		log.info("No trades with PnL to review today");
		return;
	}

	const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

	for (const trade of tradesWithPnl) {
		// Skip if already reviewed
		const existing = await db
			.select()
			.from(tradeReviews)
			.where(eq(tradeReviews.tradeId, trade.id))
			.limit(1);

		if (existing.length > 0) continue;

		// Gather context: research for this symbol
		const symbolResearch = await db
			.select()
			.from(research)
			.where(eq(research.symbol, trade.symbol))
			.orderBy(research.createdAt)
			.limit(3);

		// Gather context: agent decisions around this trade's timestamp
		const tradeTime = new Date(trade.createdAt);
		const windowStart = new Date(tradeTime.getTime() - 30 * 60 * 1000).toISOString();
		const windowEnd = new Date(tradeTime.getTime() + 30 * 60 * 1000).toISOString();

		const decisions = await db
			.select()
			.from(agentLogs)
			.where(
				and(
					eq(agentLogs.level, "DECISION"),
					gte(agentLogs.createdAt, windowStart),
					lte(agentLogs.createdAt, windowEnd),
				),
			);

		const prompt = `Review this trade:

Symbol: ${trade.symbol}
Side: ${trade.side}
Quantity: ${trade.quantity}
Fill Price: £${trade.fillPrice?.toFixed(4) ?? "N/A"}
PnL: £${trade.pnl?.toFixed(2) ?? "N/A"}
Confidence at entry: ${trade.confidence ?? "N/A"}
Reasoning at entry: ${trade.reasoning ?? "N/A"}

Research context:
${JSON.stringify(symbolResearch.map((r) => ({ sentiment: r.sentiment, action: r.suggestedAction, confidence: r.confidence, analysis: r.analysis })))}

Agent decisions around trade time:
${decisions.map((d) => d.message).join("\n---\n")}

Provide your review as JSON.`;

		try {
			const response = await client.messages.create({
				model: config.CLAUDE_MODEL,
				max_tokens: 512,
				system: [
					{ type: "text", text: TRADE_REVIEWER_SYSTEM, cache_control: { type: "ephemeral" } },
				],
				messages: [{ role: "user", content: prompt }],
			});

			await recordUsage(
				"trade_reviewer",
				response.usage.input_tokens,
				response.usage.output_tokens,
				response.usage.cache_creation_input_tokens ?? undefined,
				response.usage.cache_read_input_tokens ?? undefined,
			);

			const text = response.content
				.filter((b): b is Anthropic.TextBlock => b.type === "text")
				.map((b) => b.text)
				.join("");

			const jsonMatch = text.match(/\{[\s\S]*\}/);
			if (!jsonMatch) {
				log.warn({ tradeId: trade.id }, "No JSON in review response");
				continue;
			}

			const result = JSON.parse(jsonMatch[0]) as ReviewResult;

			await db.insert(tradeReviews).values({
				tradeId: trade.id,
				symbol: trade.symbol,
				side: trade.side,
				pnl: trade.pnl,
				confidence: trade.confidence,
				outcome: result.outcome,
				reasoningQuality: result.reasoningQuality,
				lessonLearned: result.lessonLearned,
				tags: JSON.stringify(result.tags),
				shouldRepeat: result.shouldRepeat,
			});

			log.info(
				{ tradeId: trade.id, symbol: trade.symbol, outcome: result.outcome },
				"Trade reviewed",
			);
		} catch (error) {
			log.error({ tradeId: trade.id, error }, "Failed to review trade");
		}
	}

	log.info({ reviewed: tradesWithPnl.length }, "Trade review complete");
}
