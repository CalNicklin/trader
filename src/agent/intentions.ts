export interface IntentionInput {
	symbol: string;
	condition: string;
	action: string;
	note: string;
}

export interface Intention extends IntentionInput {
	createdAt: string;
}

export interface MetIntention {
	symbol: string;
	action: string;
	condition: string;
	note: string;
	currentPrice: number;
}

const intentions: Intention[] = [];

export function addIntention(input: IntentionInput): void {
	intentions.push({ ...input, createdAt: new Date().toISOString() });
}

export function getPendingIntentions(): ReadonlyArray<Intention> {
	return intentions;
}

export function clearAllIntentions(): void {
	intentions.length = 0;
}

/**
 * Check pending intentions against current quotes.
 * Parses simple conditions like "price < 2450" or "price > 12000".
 * Returns met intentions and removes them from the pending list.
 */
export function checkIntentions(quotes: Map<string, number>): MetIntention[] {
	const met: MetIntention[] = [];
	const remaining: Intention[] = [];

	for (const intent of intentions) {
		const price = quotes.get(intent.symbol);
		if (price === undefined) {
			remaining.push(intent);
			continue;
		}

		if (evaluateCondition(intent.condition, price)) {
			met.push({
				symbol: intent.symbol,
				action: intent.action,
				condition: intent.condition,
				note: intent.note,
				currentPrice: price,
			});
		} else {
			remaining.push(intent);
		}
	}

	intentions.length = 0;
	intentions.push(...remaining);
	return met;
}

function evaluateCondition(condition: string, price: number): boolean {
	const ltMatch = condition.match(/price\s*<\s*([\d.]+)/);
	if (ltMatch) return price < Number(ltMatch[1]);

	const gtMatch = condition.match(/price\s*>\s*([\d.]+)/);
	if (gtMatch) return price > Number(gtMatch[1]);

	const lteMatch = condition.match(/price\s*<=\s*([\d.]+)/);
	if (lteMatch) return price <= Number(lteMatch[1]);

	const gteMatch = condition.match(/price\s*>=\s*([\d.]+)/);
	if (gteMatch) return price >= Number(gteMatch[1]);

	return false;
}
