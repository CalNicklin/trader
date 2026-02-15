import { eq } from "drizzle-orm";
import { getHistoricalBars } from "../broker/market-data.ts";
import { getDb } from "../db/client.ts";
import { research, watchlist } from "../db/schema.ts";
import { isSymbolExcluded } from "../risk/exclusions.ts";
import { createChildLogger } from "../utils/logger.ts";
import { analyzeStock } from "./analyzer.ts";
import { getFMPProfile } from "./sources/fmp.ts";
import { fetchNews, filterNewsForSymbols } from "./sources/news-scraper.ts";
import { getYahooFundamentals, getYahooQuote, screenUKStocks } from "./sources/yahoo-finance.ts";
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
		const symbolNews = filterNewsForSymbols(news, symbols, watchlistNames);

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
	} catch (error) {
		log.error({ error }, "Research pipeline failed");
	}
}

/** Discover new stocks to add to the watchlist */
async function discoverNewStocks(): Promise<void> {
	try {
		const candidates = await screenUKStocks();
		const currentWatchlist = await getActiveWatchlist();
		const currentSymbols = new Set(currentWatchlist.map((w) => w.symbol));

		let added = 0;
		for (const symbol of candidates) {
			if (currentSymbols.has(symbol)) continue;

			// Check exclusions
			const exclusion = await isSymbolExcluded(symbol);
			if (exclusion.excluded) continue;

			// Try to get basic info
			const profile = await getFMPProfile(symbol);
			if (profile) {
				await addToWatchlist(symbol, profile.companyName, profile.sector);
				added++;
			} else {
				await addToWatchlist(symbol);
				added++;
			}

			if (added >= 5) break; // Max 5 new additions per session
		}

		log.info({ candidates: candidates.length, added }, "Stock discovery complete");
	} catch (error) {
		log.error({ error }, "Stock discovery failed");
	}
}

/** Deep research on a single symbol */
async function researchSymbol(
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
		rawData: JSON.stringify({ quote, fundamentals, newsCount: newsItems.length }),
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
