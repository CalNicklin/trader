import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { computeIndicators } from "../analysis/indicators.ts";
import type { Exchange } from "../broker/contracts.ts";
import { getHistoricalBars } from "../broker/market-data.ts";
import { getConfig } from "../config.ts";
import { getDb } from "../db/client.ts";
import { research, watchlist } from "../db/schema.ts";
import { isSymbolExcluded } from "../risk/exclusions.ts";
import { createChildLogger } from "../utils/logger.ts";
import { recordUsage } from "../utils/token-tracker.ts";
import { analyzeStock } from "./analyzer.ts";
import { logPipelineEvent } from "./pipeline-logger.ts";
import { getFMPProfile } from "./sources/fmp.ts";
import { createFMPScreenerDeps, screenLSEStocks } from "./sources/lse-screener.ts";
import { fetchNews, filterNewsForSymbols, type NewsItem } from "./sources/news-scraper.ts";
import { createUSScreenerDeps, screenUSStocks } from "./sources/us-screener.ts";
import { getYahooFundamentals, getYahooQuote } from "./sources/yahoo-finance.ts";
import {
	addToWatchlist,
	decayScores,
	getActiveWatchlist,
	getStaleSymbols,
	updateScore,
} from "./watchlist.ts";

const log = createChildLogger({ module: "research-pipeline" });

interface DiscoveredStock {
	symbol: string;
	name: string;
	exchange: Exchange;
}

/** Parse LLM JSON output for news-driven stock discovery. Extracts symbol, name, exchange. */
export function parseNewsDiscovery(text: string): DiscoveredStock[] {
	const jsonMatch = text.match(/\[[\s\S]*\]/);
	if (!jsonMatch) return [];

	const raw = JSON.parse(jsonMatch[0]) as Array<{
		symbol?: string;
		name?: string;
		exchange?: string;
	}>;

	return raw
		.filter((r) => r.symbol && r.name)
		.map((r) => ({
			symbol: r.symbol!.toUpperCase().replace(".L", ""),
			name: r.name!,
			exchange: (r.exchange as Exchange) ?? "LSE",
		}));
}

/** Main research pipeline - runs during research window */
export async function runResearchPipeline(): Promise<void> {
	log.info("Research pipeline starting");

	try {
		// Stage 0: Decay stale watchlist scores before discovery
		await decayScores();

		// Stage 1: Universe screening - discover new candidates
		await discoverNewStocks();

		// Stage 2: Fetch news for all watchlist symbols
		const activeWatchlist = await getActiveWatchlist();
		const symbols = activeWatchlist.map((w) => w.symbol);
		const watchlistNames = new Map(
			activeWatchlist.filter((w) => w.name).map((w) => [w.symbol, w.name!]),
		);
		const news = await fetchNews(5);
		const symbolNews = await filterNewsForSymbols(news, symbols, watchlistNames);

		// Stage 2b: News-driven discovery — find new stocks mentioned in unmatched articles
		await discoverFromNews(news, symbolNews, symbols);

		// Stage 3: Deep research on stale/priority symbols
		const staleSymbols = await getStaleSymbols();
		const toResearch = staleSymbols.slice(0, 10); // Max 10 per session

		for (const { symbol, exchange } of toResearch) {
			try {
				await researchSymbol(symbol, symbolNews.get(symbol) ?? [], exchange);
				await updateScore(symbol);
				await Bun.sleep(2000);
			} catch (error) {
				log.error({ symbol, exchange, error }, "Research failed for symbol");
			}
		}

		log.info(
			{ researched: toResearch.length, watchlistSize: activeWatchlist.length },
			"Research pipeline complete",
		);
		await logPipelineEvent(getDb(), {
			phase: "research",
			message: "Research pipeline complete",
			data: { researched: toResearch.length, watchlistSize: activeWatchlist.length },
		});
	} catch (error) {
		log.error({ error }, "Research pipeline failed");
		await logPipelineEvent(getDb(), {
			phase: "research",
			message: "Research pipeline failed",
			level: "ERROR",
			data: { error: String(error) },
		}).catch(() => {});
	}
}

/** Discover new stocks to add to the watchlist — both LSE and US. */
async function discoverNewStocks(): Promise<void> {
	await discoverLSEStocks();
	await discoverUSStocks();
}

async function discoverLSEStocks(): Promise<void> {
	try {
		const deps = await createFMPScreenerDeps();
		const candidates = await screenLSEStocks(deps);
		const currentWatchlist = await getActiveWatchlist();
		const currentSymbols = new Set(currentWatchlist.map((w) => w.symbol));

		let added = 0;
		for (const candidate of candidates) {
			if (currentSymbols.has(candidate.symbol)) continue;

			const exclusion = await isSymbolExcluded(candidate.symbol);
			if (exclusion.excluded) continue;

			await addToWatchlist(candidate.symbol, candidate.name, candidate.sector, "LSE");
			added++;

			if (added >= 5) break;
		}

		log.info({ candidates: candidates.length, added, exchange: "LSE" }, "LSE discovery complete");
		await logPipelineEvent(getDb(), {
			phase: "discovery",
			message: "LSE discovery complete",
			data: { candidates: candidates.length, added, watchlistSize: currentWatchlist.length },
		});
	} catch (error) {
		log.error({ error }, "LSE stock discovery failed");
		await logPipelineEvent(getDb(), {
			phase: "discovery",
			message: "LSE stock discovery failed",
			level: "ERROR",
			data: { error: String(error) },
		}).catch(() => {});
	}
}

async function discoverUSStocks(): Promise<void> {
	try {
		const deps = await createUSScreenerDeps();
		const candidates = await screenUSStocks(deps);
		const currentWatchlist = await getActiveWatchlist();
		const currentSymbols = new Set(currentWatchlist.map((w) => w.symbol));

		let added = 0;
		for (const candidate of candidates) {
			if (currentSymbols.has(candidate.symbol)) continue;

			const exclusion = await isSymbolExcluded(candidate.symbol);
			if (exclusion.excluded) continue;

			await addToWatchlist(candidate.symbol, candidate.name, candidate.sector, candidate.exchange);
			added++;

			if (added >= 5) break;
		}

		log.info({ candidates: candidates.length, added, exchange: "US" }, "US discovery complete");
		await logPipelineEvent(getDb(), {
			phase: "discovery",
			message: "US discovery complete",
			data: { candidates: candidates.length, added },
		});
	} catch (error) {
		log.error({ error }, "US stock discovery failed");
		await logPipelineEvent(getDb(), {
			phase: "discovery",
			message: "US stock discovery failed",
			level: "ERROR",
			data: { error: String(error) },
		}).catch(() => {});
	}
}

/** Discover new stocks from unmatched news articles using Claude */
async function discoverFromNews(
	allNews: NewsItem[],
	matchedNews: Map<string, NewsItem[]>,
	existingSymbols: string[],
): Promise<void> {
	try {
		// Collect articles that didn't match any existing watchlist symbol
		const matchedArticles = new Set<string>();
		for (const items of matchedNews.values()) {
			for (const item of items) matchedArticles.add(item.link);
		}
		const unmatched = allNews.filter((n) => !matchedArticles.has(n.link));

		if (unmatched.length === 0) {
			log.debug("No unmatched news articles for discovery");
			return;
		}

		// Batch headlines for a single Haiku call
		const headlines = unmatched
			.slice(0, 30)
			.map((n) => `- ${n.title} (${n.source})`)
			.join("\n");

		const config = getConfig();
		const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

		const response = await client.messages.create({
			model: config.CLAUDE_MODEL_FAST,
			max_tokens: 512,
			messages: [
				{
					role: "user",
					content: `Extract stock tickers mentioned in these financial headlines. Only include companies clearly mentioned by name.
For UK companies, return the LSE ticker (without .L suffix), exchange "LSE".
For US companies, return the NASDAQ or NYSE ticker, exchange "NASDAQ" or "NYSE".
Return a JSON array of objects with "symbol", "name", and "exchange". Return [] if none found.

Headlines:
${headlines}`,
				},
			],
		});

		await recordUsage(
			"news_discovery",
			response.usage.input_tokens,
			response.usage.output_tokens,
			response.usage.cache_creation_input_tokens ?? undefined,
			response.usage.cache_read_input_tokens ?? undefined,
		);

		const text = response.content
			.filter((b): b is Anthropic.TextBlock => b.type === "text")
			.map((b) => b.text)
			.join("");

		const discovered = parseNewsDiscovery(text);
		if (discovered.length === 0) return;

		const existingSet = new Set(existingSymbols);

		let added = 0;
		for (const stock of discovered) {
			if (existingSet.has(stock.symbol)) continue;

			const exclusion = await isSymbolExcluded(stock.symbol);
			if (exclusion.excluded) continue;

			const profile = await getFMPProfile(stock.symbol, stock.exchange);
			if (profile) {
				await addToWatchlist(stock.symbol, profile.companyName, profile.sector, stock.exchange);
				added++;
			}

			if (added >= 3) break;
		}

		log.info(
			{
				unmatchedArticles: unmatched.length,
				discovered: discovered.length,
				added,
			},
			"News-driven discovery complete",
		);
		await logPipelineEvent(getDb(), {
			phase: "news_discovery",
			message: "News-driven discovery complete",
			data: { unmatchedArticles: unmatched.length, discovered: discovered.length, added },
		});
	} catch (error) {
		log.error({ error }, "News-driven discovery failed");
		await logPipelineEvent(getDb(), {
			phase: "news_discovery",
			message: "News-driven discovery failed",
			level: "ERROR",
			data: { error: String(error) },
		}).catch(() => {});
	}
}

/** Deep research on a single symbol */
export async function researchSymbol(
	symbol: string,
	newsItems: Array<{ title: string; snippet: string }>,
	exchange: Exchange = "LSE",
): Promise<void> {
	log.info({ symbol, exchange }, "Researching symbol");

	// Gather data from multiple sources (exchange-aware)
	const [quote, fundamentals] = await Promise.all([
		getYahooQuote(symbol, exchange),
		getYahooFundamentals(symbol, exchange),
	]);

	// Fetch 1Y bars for full indicators + 52w range (pipeline has time budget for this)
	let historicalBars = null;
	try {
		historicalBars = await getHistoricalBars(symbol, "1 Y", undefined, exchange);
	} catch {
		log.debug({ symbol }, "Historical bars not available (IBKR might be disconnected)");
	}

	// Compute indicators from bars
	let indicators = null;
	if (historicalBars && historicalBars.length > 0) {
		indicators = computeIndicators(symbol, historicalBars);

		// Update 52w high/low on watchlist
		const high52w = Math.max(...historicalBars.map((b) => b.high));
		const low52w = Math.min(...historicalBars.map((b) => b.low));
		const db = getDb();
		await db.update(watchlist).set({ high52w, low52w }).where(eq(watchlist.symbol, symbol));
	}

	// Claude analysis (with indicators when available)
	const analysis = await analyzeStock(symbol, {
		quote,
		fundamentals,
		news: newsItems,
		historicalBars,
		indicators,
	});

	const dataQuality =
		quote && fundamentals ? "full" : quote || fundamentals ? "partial" : "minimal";

	// Store research results with Layer 2 quality signals
	const db = getDb();
	await db.insert(research).values({
		symbol,
		source: "pipeline",
		rawData: JSON.stringify({
			quote,
			fundamentals,
			newsCount: newsItems.length,
			dataQuality,
			changePercentage: quote?.changePercent ?? 0,
			quality_pass: analysis.quality_pass ?? null,
			quality_flags: analysis.quality_flags ?? [],
			catalyst: analysis.catalyst ?? null,
			catalyst_detail: analysis.catalyst_detail ?? null,
			fundamental_value: analysis.fundamental_value ?? null,
			earnings_proximity: analysis.earnings_proximity ?? null,
			momentum_assessment: analysis.momentum_assessment ?? null,
		}),
		sentiment: analysis.sentiment,
		bullCase: analysis.bullCase,
		bearCase: analysis.bearCase,
		suggestedAction: analysis.action,
		confidence: analysis.confidence,
		analysis: analysis.analysis,
	});

	// Update watchlist sector if we learned it
	if (fundamentals?.sector) {
		await db
			.update(watchlist)
			.set({ sector: fundamentals.sector })
			.where(eq(watchlist.symbol, symbol));
	}

	log.info(
		{
			symbol,
			action: analysis.action,
			confidence: analysis.confidence,
			sentiment: analysis.sentiment,
		},
		"Research complete",
	);
}
