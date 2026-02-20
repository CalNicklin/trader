const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

const ACTIVE_PHASES = new Set(["pre-market", "open", "wind-down"]);

/**
 * Determine if a catch-up tick should run after a restart.
 * Returns true if the last log is stale AND the market is in an active phase.
 */
export function shouldRunCatchUpTick(lastLogTime: Date, marketPhase: string): boolean {
	if (!ACTIVE_PHASES.has(marketPhase)) return false;
	return Date.now() - lastLogTime.getTime() > STALE_THRESHOLD_MS;
}
