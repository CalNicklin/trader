export interface PositionWithSector {
	symbol: string;
	marketValue: number;
	sector: string | null;
}

export interface EnrichmentInputs {
	dayPlan: string | null;
	lastAgentResponse: string | null;
	positionsWithSectors: ReadonlyArray<PositionWithSector>;
	quoteSuccessCount: number;
	quoteFailures: ReadonlyArray<string>;
}

const DAY_PLAN_EXCERPT_LENGTH = 500;
const LAST_RESPONSE_EXCERPT_LENGTH = 800;

/**
 * Build additional context for Tier 3 trading analysis.
 * Pure function — returns enrichment text to append to the full context.
 */
export function buildContextEnrichments(inputs: EnrichmentInputs): string {
	const sections: string[] = [];

	if (inputs.dayPlan) {
		sections.push(`## Today's Day plan\n${inputs.dayPlan.substring(0, DAY_PLAN_EXCERPT_LENGTH)}`);
	}

	if (inputs.lastAgentResponse) {
		sections.push(
			`## Your last assessment\n${inputs.lastAgentResponse.substring(0, LAST_RESPONSE_EXCERPT_LENGTH)}`,
		);
	}

	if (inputs.positionsWithSectors.length > 0) {
		const sectorTotals = new Map<string, number>();
		let portfolioTotal = 0;

		for (const pos of inputs.positionsWithSectors) {
			const sector = pos.sector ?? "Unknown";
			sectorTotals.set(sector, (sectorTotals.get(sector) ?? 0) + pos.marketValue);
			portfolioTotal += pos.marketValue;
		}

		if (portfolioTotal > 0) {
			const breakdown = [...sectorTotals.entries()]
				.sort((a, b) => b[1] - a[1])
				.map(([sector, value]) => `${sector}: ${((value / portfolioTotal) * 100).toFixed(0)}%`)
				.join(", ");
			sections.push(`## Portfolio composition\n${breakdown}`);
		}
	}

	if (inputs.quoteFailures.length > 0) {
		sections.push(
			`## Data completeness\n${inputs.quoteSuccessCount} quotes succeeded, ${inputs.quoteFailures.length} failed: ${inputs.quoteFailures.join(", ")}`,
		);
	}

	return sections.join("\n\n");
}
