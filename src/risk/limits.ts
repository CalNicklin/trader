/** Hardcoded safety limits that cannot be overridden by the agent */
export const HARD_LIMITS = {
	/** ISA rules - no shorting, no margin, GBP/LSE only */
	ISA_CASH_ONLY: true,
	ISA_NO_SHORTING: true,
	ISA_NO_MARGIN: true,
	ISA_GBP_ONLY: true,
	ISA_LSE_ONLY: true,

	/** Maximum single position as % of portfolio */
	MAX_POSITION_PCT: 5,
	/** Hard cap on single position in GBP */
	MAX_POSITION_GBP: 50_000,
	/** Minimum cash reserve as % of portfolio */
	MIN_CASH_RESERVE_PCT: 20,

	/** Per-trade stop loss % */
	PER_TRADE_STOP_LOSS_PCT: 3,
	/** Daily loss limit as % of portfolio - stops trading for the day */
	DAILY_LOSS_LIMIT_PCT: 2,
	/** Weekly loss limit as % of portfolio - circuit breaker */
	WEEKLY_LOSS_LIMIT_PCT: 5,

	/** Maximum number of open positions */
	MAX_POSITIONS: 10,
	/** Maximum trades per day */
	MAX_TRADES_PER_DAY: 10,
	/** Minimum minutes between trades (live mode — paper mode uses shorter interval) */
	MIN_TRADE_INTERVAL_MIN: 15,
	/** Maximum sector exposure % */
	MAX_SECTOR_EXPOSURE_PCT: 30,

	/** Minimum stock price (GBP) - no penny stocks */
	MIN_PRICE_GBP: 0.1,
	/** Minimum average daily volume */
	MIN_AVG_VOLUME: 50000,

	/** Win rate threshold for auto-pause */
	PAUSE_WIN_RATE_THRESHOLD: 0.4,
	/** Consecutive weeks below threshold before pausing */
	PAUSE_WEEKS_THRESHOLD: 2,
} as const;

const PAPER_TRADE_INTERVAL_MIN = 2;

export function getTradeIntervalMin(mode: "paper" | "live"): number {
	return mode === "paper" ? PAPER_TRADE_INTERVAL_MIN : HARD_LIMITS.MIN_TRADE_INTERVAL_MIN;
}
