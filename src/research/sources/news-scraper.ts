import { eq } from "drizzle-orm";
import Parser from "rss-parser";
import { getDb } from "../../db/client.ts";
import { watchlist } from "../../db/schema.ts";
import { createChildLogger } from "../../utils/logger.ts";
import { RateLimiter } from "../../utils/rate-limiter.ts";

const log = createChildLogger({ module: "research-news" });
const parser = new Parser({
	headers: { "User-Agent": "Mozilla/5.0 (compatible; TraderAgent/1.0)" },
	timeout: 10000,
});
const rateLimiter = new RateLimiter(15, 60000); // 15 feeds per minute

const RSS_FEEDS = [
	// UK-focused
	{
		name: "BBC Business",
		url: "https://feeds.bbci.co.uk/news/business/rss.xml",
	},
	{
		name: "FT Markets",
		url: "https://www.ft.com/markets?format=rss",
	},
	{
		name: "Yahoo Finance UK",
		url: "https://uk.finance.yahoo.com/rss/topstories",
	},
	{
		name: "Yahoo Finance FTSE",
		url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=^FTSE&region=UK&lang=en-GB",
	},
	{
		name: "Proactive Investors UK",
		url: "https://www.proactiveinvestors.co.uk/rss/all_news",
	},
	// Global markets
	{
		name: "MarketWatch",
		url: "https://feeds.marketwatch.com/marketwatch/topstories",
	},
	{
		name: "CNBC World",
		url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=19794221",
	},
	{
		name: "Investing.com UK",
		url: "https://www.investing.com/rss/news_301.rss",
	},
];

export interface NewsItem {
	title: string;
	link: string;
	source: string;
	pubDate: string;
	snippet: string;
}

/** Fetch financial news from RSS feeds */
export async function fetchNews(maxItemsPerFeed: number = 10): Promise<NewsItem[]> {
	const allItems: NewsItem[] = [];

	for (const feed of RSS_FEEDS) {
		try {
			await rateLimiter.acquire();
			const parsed = await parser.parseURL(feed.url);

			const items = (parsed.items ?? []).slice(0, maxItemsPerFeed).map((item) => ({
				title: item.title ?? "",
				link: item.link ?? "",
				source: feed.name,
				pubDate: item.pubDate ?? item.isoDate ?? "",
				snippet: (item.contentSnippet ?? item.content ?? "").substring(0, 300),
			}));

			allItems.push(...items);
			log.debug({ source: feed.name, count: items.length }, "News fetched");
		} catch (error) {
			log.warn({ source: feed.name, error }, "Failed to fetch RSS feed");
		}
	}

	// Sort by date, newest first
	allItems.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());

	log.info({ total: allItems.length }, "News fetch complete");
	return allItems;
}

/**
 * Static fallback aliases for symbols where the DB name alone isn't sufficient.
 * Supplemented at runtime by watchlist names from the database.
 */
const STATIC_ALIASES: Record<string, string[]> = {
	SHEL: ["Shell"],
	"BP.": ["BP"],
	AZN: ["AstraZeneca"],
	GSK: ["GSK"],
	ULVR: ["Unilever"],
	HSBA: ["HSBC"],
	VOD: ["Vodafone"],
	BARC: ["Barclays"],
	LLOY: ["Lloyds"],
	"RR.": ["Rolls-Royce", "Rolls Royce"],
	LSEG: ["London Stock Exchange", "LSE Group"],
	DGE: ["Diageo"],
	RIO: ["Rio Tinto"],
	GLEN: ["Glencore"],
	REL: ["RELX"],
	AAL: ["Anglo American"],
	"BA.": ["BAE Systems", "BAE"],
	"NG.": ["National Grid"],
	SSE: ["SSE"],
	AVV: ["Aviva"],
	PRU: ["Prudential"],
	TSCO: ["Tesco"],
	SBRY: ["Sainsbury"],
	MKS: ["Marks and Spencer", "Marks & Spencer", "M&S"],
	NWG: ["NatWest"],
	STAN: ["Standard Chartered"],
	"BT.A": ["BT Group", "British Telecom"],
	IMB: ["Imperial Brands"],
	BATS: ["British American Tobacco", "BAT"],
	CPG: ["Compass Group"],
};

/** Build a dynamic symbol-to-names map from DB + static aliases */
async function buildNameMap(): Promise<Map<string, string[]>> {
	const nameMap = new Map<string, string[]>();

	// Load from DB
	try {
		const db = getDb();
		const rows = await db
			.select({ symbol: watchlist.symbol, name: watchlist.name })
			.from(watchlist)
			.where(eq(watchlist.active, true));

		for (const row of rows) {
			if (row.name) {
				nameMap.set(row.symbol, [row.name]);
			}
		}
	} catch {
		log.debug("Could not load watchlist names — using static aliases only");
	}

	// Merge static aliases (may add additional names the DB doesn't have)
	for (const [symbol, aliases] of Object.entries(STATIC_ALIASES)) {
		const existing = nameMap.get(symbol) ?? [];
		const merged = [...new Set([...existing, ...aliases])];
		nameMap.set(symbol, merged);
	}

	return nameMap;
}

/** Filter news for mentions of specific symbols, matching both ticker and company name */
export async function filterNewsForSymbols(
	news: NewsItem[],
	symbols: string[],
	watchlistNames?: Map<string, string>,
): Promise<Map<string, NewsItem[]>> {
	const result = new Map<string, NewsItem[]>();
	const nameMap = await buildNameMap();

	for (const symbol of symbols) {
		// Build search terms: ticker + known names + watchlist name
		const searchTerms: string[] = [symbol.replace(".", "")]; // strip dots for matching
		if (symbol.includes(".")) searchTerms.push(symbol); // also match with dot

		const names = nameMap.get(symbol);
		if (names) searchTerms.push(...names);

		const watchlistName = watchlistNames?.get(symbol);
		if (watchlistName) searchTerms.push(watchlistName);

		const relevant = news.filter((item) => {
			const text = `${item.title} ${item.snippet}`.toUpperCase();
			return searchTerms.some((term) => text.includes(term.toUpperCase()));
		});

		if (relevant.length > 0) {
			result.set(symbol, relevant);
		}
	}

	return result;
}
