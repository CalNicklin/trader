import Parser from "rss-parser";
import { createChildLogger } from "../../utils/logger.ts";
import { RateLimiter } from "../../utils/rate-limiter.ts";

const log = createChildLogger({ module: "research-news" });
const parser = new Parser();
const rateLimiter = new RateLimiter(10, 60000); // 10 feeds per minute

const RSS_FEEDS = [
	{
		name: "FT Markets",
		url: "https://www.ft.com/markets?format=rss",
	},
	{
		name: "Reuters Business",
		url: "https://feeds.reuters.com/reuters/businessNews",
	},
	{
		name: "BBC Business",
		url: "https://feeds.bbci.co.uk/news/business/rss.xml",
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

/** Filter news for mentions of specific symbols */
export function filterNewsForSymbols(news: NewsItem[], symbols: string[]): Map<string, NewsItem[]> {
	const result = new Map<string, NewsItem[]>();

	for (const symbol of symbols) {
		const relevant = news.filter(
			(item) =>
				item.title.toUpperCase().includes(symbol.toUpperCase()) ||
				item.snippet.toUpperCase().includes(symbol.toUpperCase()),
		);
		if (relevant.length > 0) {
			result.set(symbol, relevant);
		}
	}

	return result;
}
