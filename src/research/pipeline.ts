import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
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
import { getYahooFundamentals, getYahooQuote } from "./sources/yahoo-finance.ts";
import { addToWatchlist, getActiveWatchlist, getStaleSymbols, updateScore } from "./watchlist.ts";

const log = createChildLogger({ module: "research-pipeline" });

/** Main research pipeline - runs during research window */
export async function runResearchPipeline(): Promise<void> {
	log.info("Research pipeline starting");

	try {
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

		for (const symbol of toResearch) {
			try {
				await researchSymbol(symbol, symbolNews.get(symbol) ?? []);
				await updateScore(symbol);
				// Brief pause between analyses
				await Bun.sleep(2000);
			} catch (error) {
				log.error({ symbol, error }, "Research failed for symbol");
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

/** Discover new stocks to add to the watchlist via FMP screener */
async function discoverNewStocks(): Promise<void> {
	try {
		const deps = await createFMPScreenerDeps();
		const candidates = await screenLSEStocks(deps);
		const currentWatchlist = await getActiveWatchlist();
		const currentSymbols = new Set(currentWatchlist.map((w) => w.symbol));

		let added = 0;
		for (const candidate of candidates) {
			if (currentSymbols.has(candidate.symbol)) continue;

			// Check exclusions
			const exclusion = await isSymbolExcluded(candidate.symbol);
			if (exclusion.excluded) continue;

			await addToWatchlist(candidate.symbol, candidate.name, candidate.sector);
			added++;

			if (added >= 5) break; // Max 5 new additions per session
		}

		log.info({ candidates: candidates.length, added }, "Stock discovery complete");
		await logPipelineEvent(getDb(), {
			phase: "discovery",
			message: "Stock discovery complete",
			data: { candidates: candidates.length, added, watchlistSize: currentWatchlist.length },
		});
	} catch (error) {
		log.error({ error }, "Stock discovery failed");
		await logPipelineEvent(getDb(), {
			phase: "discovery",
			message: "Stock discovery failed",
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
					content: `Extract LSE-listed UK company tickers from these financial headlines. Only include companies clearly mentioned by name. Return a JSON array of objects with "symbol" (LSE ticker without .L suffix) and "name" (company name). Return [] if none found.

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

		const jsonMatch = text.match(/\[[\s\S]*\]/);
		if (!jsonMatch) return;

		const discovered = JSON.parse(jsonMatch[0]) as Array<{
			symbol: string;
			name: string;
		}>;
		const existingSet = new Set(existingSymbols);

		let added = 0;
		for (const stock of discovered) {
			const symbol = stock.symbol.toUpperCase().replace(".L", "");
			if (existingSet.has(symbol)) continue;

			const exclusion = await isSymbolExcluded(symbol);
			if (exclusion.excluded) continue;

			// Verify it exists on LSE via FMP
			const profile = await getFMPProfile(symbol);
			if (profile) {
				await addToWatchlist(symbol, profile.companyName, profile.sector);
				added++;
			}

			if (added >= 3) break; // Max 3 news-driven additions per run
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
): Promise<void> {
	log.info({ symbol }, "Researching symbol");

	// Gather data from multiple sources
	const [quote, fundamentals] = await Promise.all([
		getYahooQuote(symbol),
		getYahooFundamentals(symbol),
	]);

	// Get historical bars from IBKR if connected
	let historicalBars = null;
	try {
		historicalBars = await getHistoricalBars(symbol, "1 M");
	} catch {
		log.debug({ symbol }, "Historical bars not available (IBKR might be disconnected)");
	}

	// Claude analysis
	const analysis = await analyzeStock(symbol, {
		quote,
		fundamentals,
		news: newsItems,
		historicalBars,
	});

	// Store research results
	const db = getDb();
	await db.insert(research).values({
		symbol,
		source: "pipeline",
		rawData: JSON.stringify({
			quote,
			fundamentals,
			newsCount: newsItems.length,
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
