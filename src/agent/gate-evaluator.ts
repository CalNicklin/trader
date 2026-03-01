import type { EscalationSnapshot } from "./escalation-state.ts";

export type SkipReason =
	| "budget_exceeded"
	| "cooldown_active"
	| "state_unchanged"
	| "haiku_no_escalate";

export interface GateInput {
	lastEscalation: EscalationSnapshot | null;
	cooldownMin: number;
	materialChangePct: number;
	haikuEscalated: boolean;
	canAffordSonnet: boolean;
	fingerprint: string;
	/** Last-seen prices from the previous tick (symbol → price) */
	lastQuotes: ReadonlyMap<string, number>;
	/** Current prices from this tick (symbol → price) */
	currentQuotes: ReadonlyMap<string, number>;
	positionRows: ReadonlyArray<{ symbol: string; quantity: number }>;
}

export type GateVerdict =
	| { proceed: true; skipReason?: undefined }
	| { proceed: false; skipReason: SkipReason; detail: string };

/**
 * Pure function that evaluates all escalation gates in order.
 * Gate order: cooldown → haiku → budget → state-hash
 *
 * The orchestrator calls this in two phases:
 * 1. evaluateCooldownGate() — before Haiku (to avoid wasting even a cheap call)
 * 2. evaluatePostHaikuGates() — after Haiku, with its result
 *
 * evaluateGates() combines both for testing convenience.
 */
export function evaluateGates(input: GateInput): GateVerdict {
	const cooldown = evaluateCooldownGate(input);
	if (!cooldown.proceed) return cooldown;

	return evaluatePostHaikuGates(input);
}

/** Gate 1: Cooldown — checked before Haiku runs */
export function evaluateCooldownGate(
	input: Pick<
		GateInput,
		| "lastEscalation"
		| "cooldownMin"
		| "materialChangePct"
		| "positionRows"
		| "lastQuotes"
		| "currentQuotes"
	>,
): GateVerdict {
	if (input.lastEscalation && input.lastEscalation.conclusion === "hold") {
		const elapsedMin = (Date.now() - input.lastEscalation.timestamp) / 60_000;
		if (elapsedMin < input.cooldownMin) {
			const materialChange = detectMaterialChange(
				input.positionRows,
				input.lastQuotes,
				input.currentQuotes,
				input.materialChangePct,
			);
			if (!materialChange) {
				return {
					proceed: false,
					skipReason: "cooldown_active",
					detail: `Last hold ${Math.round(elapsedMin)}m ago, cooldown ${input.cooldownMin}m, no material change`,
				};
			}
		}
	}

	return { proceed: true };
}

/** Gates 2-4: Haiku → Budget → State-hash — checked after Haiku runs */
export function evaluatePostHaikuGates(
	input: Pick<GateInput, "haikuEscalated" | "canAffordSonnet" | "fingerprint" | "lastEscalation">,
): GateVerdict {
	if (!input.haikuEscalated) {
		return {
			proceed: false,
			skipReason: "haiku_no_escalate",
			detail: "Haiku declined escalation",
		};
	}

	if (!input.canAffordSonnet) {
		return {
			proceed: false,
			skipReason: "budget_exceeded",
			detail: "Daily API budget would be exceeded by next Sonnet session",
		};
	}

	if (input.lastEscalation && input.fingerprint === input.lastEscalation.fingerprint) {
		return {
			proceed: false,
			skipReason: "state_unchanged",
			detail: "Fingerprint identical to last Sonnet session",
		};
	}

	return { proceed: true };
}

function detectMaterialChange(
	positionRows: ReadonlyArray<{ symbol: string; quantity: number }>,
	lastQuotes: ReadonlyMap<string, number>,
	currentQuotes: ReadonlyMap<string, number>,
	materialChangePct: number,
): boolean {
	const threshold = materialChangePct / 100;

	for (const pos of positionRows) {
		const lastPrice = lastQuotes.get(pos.symbol);
		const currentPrice = currentQuotes.get(pos.symbol);
		if (lastPrice && currentPrice) {
			const move = Math.abs(currentPrice - lastPrice) / lastPrice;
			if (move >= threshold) return true;
		}
	}

	return false;
}
