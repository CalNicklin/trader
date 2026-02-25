/** Hardcoded safety limits that cannot be overridden by the agent */
export const HARD_LIMITS = {
	/** ISA rules - no shorting, no margin, GBP/LSE only */
	ISA_CASH_ONLY: true,
	ISA_NO_SHORTING: true,
	ISA_NO_MARGIN: true,
	ISA_GBP_ONLY: true,
	ISA_LSE_ONLY: true,

	/** Maximum single position as % of portfolio */
	MAX_POSITION_PCT: 15,
	/** Hard cap on single position in GBP */
	MAX_POSITION_GBP: 50_000,
	/** Minimum cash reserve as % of portfolio */
	MIN_CASH_RESERVE_PCT: 10,

	/** Per-trade stop loss % (fallback when ATR unavailable) */
	PER_TRADE_STOP_LOSS_PCT: 3,
	/** Stop at N × ATR below entry */
	STOP_LOSS_ATR_MULTIPLIER: 2,
	/** Minimum target at N × ATR above entry */
	TARGET_ATR_MULTIPLIER: 3,
	/** Risk N% of portfolio per trade */
	RISK_PER_TRADE_PCT: 1,
	/** Trail stop at N × ATR below highest close */
	TRAILING_STOP_ATR_MULTIPLIER: 2,
	/** Daily loss limit as % of portfolio - stops trading for the day */
	DAILY_LOSS_LIMIT_PCT: 2,
	/** Weekly loss limit as % of portfolio - circuit breaker */
	WEEKLY_LOSS_LIMIT_PCT: 5,

	/** Maximum number of open positions */
	MAX_POSITIONS: 5,
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

export type TradingMode = "paper" | "live";

type WidenNumbers<T> = {
	[K in keyof T]: T[K] extends number ? number : T[K];
};

export type ActiveLimits = WidenNumbers<typeof HARD_LIMITS>;

export function getActiveLimits(mode: TradingMode): ActiveLimits {
	if (mode === "paper") {
		return {
			...HARD_LIMITS,
			MIN_CASH_RESERVE_PCT: 5,
			DAILY_LOSS_LIMIT_PCT: 5,
			WEEKLY_LOSS_LIMIT_PCT: 10,
		};
	}
	return { ...HARD_LIMITS };
}

export function getTradeIntervalMin(mode: TradingMode): number {
	return mode === "paper" ? PAPER_TRADE_INTERVAL_MIN : HARD_LIMITS.MIN_TRADE_INTERVAL_MIN;
}
