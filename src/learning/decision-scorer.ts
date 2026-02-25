import Anthropic from "@anthropic-ai/sdk";
import { and, eq, like } from "drizzle-orm";
import { getHistoricalBars } from "../broker/market-data.ts";
import { getConfig } from "../config.ts";
import { getDb } from "../db/client.ts";
import { agentLogs, decisionScores } from "../db/schema.ts";
import { createChildLogger } from "../utils/logger.ts";
import { recordUsage } from "../utils/token-tracker.ts";

const log = createChildLogger({ module: "decision-scorer" });

type DecisionScoreValue =
	| "good_hold"
	| "good_pass"
	| "good_avoid"
	| "missed_opportunity"
	| "unclear";

interface DecisionExtract {
	symbol: string;
	statedAction: "BUY" | "SELL" | "HOLD" | "WATCH" | "PASS";
	reason: string;
}

interface MissedOppAssessment {
	genuineMiss: boolean;
	lesson: string;
	tags: string[];
}

const EXTRACT_DECISIONS_PROMPT = `Extract stock-level decisions from this trading agent log entry. For each stock mentioned, identify:
- symbol: the stock ticker (e.g. SHEL, AZN, AAPL, MSFT)
- exchange: the exchange (LSE, NASDAQ, or NYSE)
- statedAction: what the agent decided (BUY, SELL, HOLD, WATCH, or PASS if explicitly rejected)
- reason: brief summary of why (max 50 chars)

If the log says "NO TRADES" or similar with no specific stocks mentioned, return an empty array.
Return JSON only: { "symbols": [...] }`;

export function scoreDecision(statedAction: string, changePct: number): DecisionScoreValue {
	if (statedAction === "HOLD") {
		if (changePct < -3) return "good_hold";
		if (changePct > 5) return "missed_opportunity";
		return changePct < 2 ? "good_hold" : "unclear";
	}

	if (statedAction === "WATCH" || statedAction === "PASS") {
		if (changePct > 5) return "missed_opportunity";
		if (changePct < -3) return "good_avoid";
		return Math.abs(changePct) < 2 ? "good_pass" : "unclear";
	}

	return "unclear";
}

async function assessMissedOpportunity(
	client: Anthropic,
	model: string,
	symbol: string,
	statedAction: string,
	reason: string,
	priceAtDecision: number,
	priceNow: number,
	changePct: number,
): Promise<MissedOppAssessment> {
	const prompt = `A trading agent decided to ${statedAction} on ${symbol} at ${priceAtDecision.toFixed(1)}p.
Reason: "${reason}"
The stock has since moved ${changePct > 0 ? "up" : "down"} ${Math.abs(changePct).toFixed(1)}% to ${priceNow.toFixed(1)}p.

Was this a genuine miss, or was the caution warranted given the information available at decision time?
Consider: Was the move predictable from the data? Were there warning signs the agent should have heeded?

Respond with JSON only:
{
  "genuineMiss": true/false,
  "lesson": "one sentence lesson (max 100 chars)",
  "tags": ["tag1", "tag2"]
}`;

	const response = await client.messages.create({
		model,
		max_tokens: 256,
		messages: [{ role: "user", content: prompt }],
	});

	await recordUsage(
		"decision_scorer_assessment",
		response.usage.input_tokens,
		response.usage.output_tokens,
	);

	const text = response.content
		.filter((b): b is Anthropic.TextBlock => b.type === "text")
		.map((b) => b.text)
		.join("");

	const match = text.match(/\{[\s\S]*\}/);
	if (!match) return { genuineMiss: false, lesson: "Unable to assess", tags: [] };

	return JSON.parse(match[0]) as MissedOppAssessment;
}

export async function runDecisionScorer(): Promise<void> {
	log.info("Decision scorer starting");
	const db = getDb();
	const config = getConfig();

	const today = new Date().toISOString().split("T")[0]!;

	// Get today's DECISION-level logs
	const decisions = await db
		.select()
		.from(agentLogs)
		.where(and(eq(agentLogs.level, "DECISION"), like(agentLogs.createdAt, `${today}%`)));

	if (decisions.length === 0) {
		log.info("No decisions to score today");
		return;
	}

	// Batch all decision texts for extraction
	const batchedText = decisions
		.map((d, i) => `--- Decision ${i + 1} (${d.createdAt}) ---\n${d.message}`)
		.join("\n\n");

	const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

	// Extract symbols + actions via Haiku
	const extractResponse = await client.messages.create({
		model: config.CLAUDE_MODEL_FAST,
		max_tokens: 1024,
		messages: [
			{
				role: "user",
				content: `${EXTRACT_DECISIONS_PROMPT}\n\n${batchedText}`,
			},
		],
	});

	await recordUsage(
		"decision_scorer_extract",
		extractResponse.usage.input_tokens,
		extractResponse.usage.output_tokens,
	);

	const extractText = extractResponse.content
		.filter((b): b is Anthropic.TextBlock => b.type === "text")
		.map((b) => b.text)
		.join("");

	const extractMatch = extractText.match(/\{[\s\S]*\}/);
	if (!extractMatch) {
		log.warn("No JSON in decision extraction response");
		return;
	}

	const extracted = JSON.parse(extractMatch[0]) as { symbols: DecisionExtract[] };
	const scorableActions = new Set(["HOLD", "WATCH", "PASS"]);
	const scorable = extracted.symbols.filter((s) => scorableActions.has(s.statedAction));

	if (scorable.length === 0) {
		log.info("No HOLD/WATCH/PASS decisions to score");
		return;
	}

	// Build quote map from decision logs — use the data field that includes quote snapshots
	const quoteMap = new Map<string, number>();
	for (const d of decisions) {
		if (!d.data) continue;
		try {
			const data = JSON.parse(d.data) as { quotes?: Record<string, number> };
			if (data.quotes) {
				for (const [sym, price] of Object.entries(data.quotes)) {
					quoteMap.set(sym, price);
				}
			}
		} catch {
			// ignore parse errors
		}
	}

	// Build gate state map from decision logs
	const gateStateMap = new Map<string, { passed: boolean; signalState: Record<string, unknown> }>();
	for (const d of decisions) {
		if (!d.data) continue;
		try {
			const data = JSON.parse(d.data) as {
				gateStates?: Record<string, { passed: boolean; signalState: Record<string, unknown> }>;
			};
			if (data.gateStates) {
				for (const [sym, state] of Object.entries(data.gateStates)) {
					gateStateMap.set(sym, state);
				}
			}
		} catch {
			// ignore parse errors
		}
	}

	// Get closing prices — use last bar from historical data
	const closingPrices = new Map<string, number>();
	const uniqueSymbols = [...new Set(scorable.map((s) => s.symbol))];
	for (const symbol of uniqueSymbols) {
		try {
			const bars = await getHistoricalBars(symbol, "1 M");
			if (bars.length > 0) {
				closingPrices.set(symbol, bars[bars.length - 1]!.close);
			}
		} catch (e) {
			log.warn({ symbol, error: e }, "Failed to get closing price for scoring");
		}
	}

	let scored = 0;
	let missed = 0;

	for (const decision of scorable) {
		const priceAtDecision = quoteMap.get(decision.symbol);
		const priceNow = closingPrices.get(decision.symbol);

		if (!priceAtDecision || !priceNow) {
			log.debug({ symbol: decision.symbol }, "Missing price data, skipping");
			continue;
		}

		const changePct = ((priceNow - priceAtDecision) / priceAtDecision) * 100;
		const score = scoreDecision(decision.statedAction, changePct);

		let genuineMiss: boolean | null = null;
		let lesson: string | null = null;
		let tags: string | null = null;

		if (score === "missed_opportunity") {
			missed++;
			const assessment = await assessMissedOpportunity(
				client,
				config.CLAUDE_MODEL_FAST,
				decision.symbol,
				decision.statedAction,
				decision.reason,
				priceAtDecision,
				priceNow,
				changePct,
			);
			genuineMiss = assessment.genuineMiss;
			lesson = assessment.lesson;
			tags = JSON.stringify(assessment.tags);
		}

		// Get gate state for this symbol
		const gateState = gateStateMap.get(decision.symbol);

		await db.insert(decisionScores).values({
			symbol: decision.symbol,
			decisionTime: today,
			statedAction: decision.statedAction,
			reason: decision.reason,
			priceAtDecision,
			priceNow,
			changePct,
			score,
			genuineMiss,
			lesson,
			tags,
			signalState: gateState ? JSON.stringify(gateState.signalState) : null,
			gateResult: gateState ? (gateState.passed ? "passed" : "failed") : null,
			aiOverrideReason:
				gateState?.passed && (decision.statedAction === "WATCH" || decision.statedAction === "PASS")
					? decision.reason
					: null,
		});
		scored++;
	}

	log.info({ scored, missedOpps: missed, total: scorable.length }, "Decision scoring complete");
}
