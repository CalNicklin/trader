import { desc, eq, gte } from "drizzle-orm";
import {
  getAccountSummary,
  getPositions as getBrokerPositions,
} from "../broker/account.ts";
import type { Quote } from "../broker/market-data.ts";
import { getQuotes } from "../broker/market-data.ts";
import { getDb } from "../db/client.ts";
import {
  agentLogs,
  dailySnapshots,
  positions,
  research,
  trades,
  watchlist,
} from "../db/schema.ts";
import {
  buildLearningBrief,
  buildRecentContext,
} from "../learning/context-builder.ts";
import { getMarketPhase } from "../utils/clock.ts";
import { createChildLogger } from "../utils/logger.ts";
import { runQuickScan, runTradingAnalyst } from "./planner.ts";
import {
  DAY_PLAN_PROMPT,
  MINI_ANALYSIS_PROMPT,
} from "./prompts/trading-analyst.ts";

const log = createChildLogger({ module: "orchestrator" });

/** In-memory cache of last-seen quotes for price move detection */
const lastQuotes = new Map<string, number>();

/** Price move threshold to trigger analysis */
const PRICE_MOVE_THRESHOLD = 0.02; // 2%

export type OrchestratorState =
  | "idle"
  | "pre_market"
  | "market_open"
  | "active_trading"
  | "wind_down"
  | "post_market"
  | "research"
  | "paused";

let currentState: OrchestratorState = "idle";
let tradingPaused = false;

export function getState(): OrchestratorState {
  return currentState;
}

export function isPaused(): boolean {
  return tradingPaused;
}

export function setPaused(paused: boolean): void {
  tradingPaused = paused;
  log.warn({ paused }, "Trading pause state changed");
}

/** Main orchestrator tick - called by scheduler */
export async function tick(): Promise<void> {
  if (tradingPaused) {
    log.debug("Trading is paused");
    return;
  }

  const phase = getMarketPhase();
  const prevState = currentState;

  switch (phase) {
    case "pre-market":
      currentState = "pre_market";
      if (prevState !== "pre_market") {
        await onPreMarket();
      }
      break;

    case "open":
      currentState = "active_trading";
      await onActiveTradingTick();
      break;

    case "wind-down":
      currentState = "wind_down";
      if (prevState !== "wind_down") {
        await onWindDown();
      }
      break;

    case "post-market":
      currentState = "post_market";
      if (prevState !== "post_market") {
        await onPostMarket();
      }
      break;

    case "research":
      currentState = "research";
      // Research is handled by its own scheduled job
      break;

    case "closed":
      currentState = "idle";
      break;
  }

  if (prevState !== currentState) {
    log.info({ from: prevState, to: currentState }, "State transition");
    const db = getDb();
    await db.insert(agentLogs).values({
      level: "INFO",
      phase: currentState,
      message: `State transition: ${prevState} -> ${currentState}`,
    });
  }
}

/** Pre-market: health check, sync, generate day plan */
async function onPreMarket(): Promise<void> {
  log.info("Pre-market phase starting");

  try {
    // Sync account
    const summary = await getAccountSummary();
    log.info(
      { netLiq: summary.netLiquidation, cash: summary.totalCashValue },
      "Account synced",
    );

    // Reconcile positions
    await reconcilePositions();

    // Generate day plan
    const accountData = JSON.stringify(summary);
    const db = getDb();
    const watchlistItems = await db
      .select()
      .from(watchlist)
      .where(eq(watchlist.active, true))
      .orderBy(desc(watchlist.score))
      .limit(20);

    const positionRows = await db.select().from(positions);

    const learningBrief = await buildLearningBrief();

    const context = `
Account: ${accountData}
Positions: ${JSON.stringify(positionRows)}
Watchlist (top 20): ${JSON.stringify(watchlistItems)}
Date: ${new Date().toISOString()}
${learningBrief ? `\n${learningBrief}` : ""}
`;

    const response = await runTradingAnalyst(
      `${DAY_PLAN_PROMPT}\n\n${context}`,
    );
    log.info({ plan: response.text.substring(0, 200) }, "Day plan generated");
  } catch (error) {
    log.error({ error }, "Pre-market phase failed");
  }
}

interface MarketState {
  reasons: string[];
  quotes: Map<string, Quote>;
}

/** Tier 1: Gather market state and flag notable changes */
async function shouldRunAnalysis(): Promise<MarketState> {
  const reasons: string[] = [];
  const db = getDb();

  // Check for open positions (need monitoring)
  const positionRows = await db.select().from(positions);
  if (positionRows.length > 0) {
    reasons.push(`${positionRows.length} open position(s) to monitor`);
  }

  // Check for pending/submitted orders
  const pendingOrders = await db
    .select()
    .from(trades)
    .where(eq(trades.status, "SUBMITTED"));
  if (pendingOrders.length > 0) {
    reasons.push(`${pendingOrders.length} pending order(s)`);
  }

  // Get watchlist quotes and check for price moves
  const watchlistItems = await db
    .select()
    .from(watchlist)
    .where(eq(watchlist.active, true))
    .orderBy(desc(watchlist.score))
    .limit(10);

  const symbols = watchlistItems.map((w) => w.symbol);
  const quotes = await getQuotes(symbols);

  for (const [symbol, quote] of quotes) {
    if (!quote.last) continue;
    const lastPrice = lastQuotes.get(symbol);
    if (lastPrice) {
      const move = Math.abs(quote.last - lastPrice) / lastPrice;
      if (move >= PRICE_MOVE_THRESHOLD) {
        reasons.push(`${symbol} moved ${(move * 100).toFixed(1)}%`);
      }
    }
    lastQuotes.set(symbol, quote.last);
  }

  // Check for new research with actionable signals (last 24h)
  // BUY signals are always actionable; SELL only if we hold that stock (ISA = long-only, can't short)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const actionableResearch = await db
    .select()
    .from(research)
    .where(gte(research.createdAt, oneDayAgo));

  const heldSymbols = new Set(positionRows.map((p) => p.symbol));
  const actionable = actionableResearch.filter(
    (r) =>
      r.suggestedAction === "BUY" ||
      (r.suggestedAction === "SELL" && heldSymbols.has(r.symbol)),
  );
  if (actionable.length > 0) {
    const actions = actionable
      .map((r) => `${r.symbol}:${r.suggestedAction}`)
      .join(", ");
    reasons.push(`Actionable research: ${actions}`);
  }

  return { reasons, quotes };
}

/** Active trading tick: three-tier analysis (pre-filter -> Haiku -> Sonnet) */
async function onActiveTradingTick(): Promise<void> {
  try {
    // === Tier 1: Gather market state (quotes, positions, research) ===
    const preFilter = await shouldRunAnalysis();
    if (preFilter.reasons.length > 0) {
      log.info(
        { reasons: preFilter.reasons },
        "Pre-filter: notable changes detected",
      );
    }

    const db = getDb();
    const positionRows = await db.select().from(positions);

    // Update position prices if we have positions
    if (positionRows.length > 0) {
      const posSymbols = positionRows.map((p) => p.symbol);
      const posQuotes = await getQuotes(posSymbols);

      for (const pos of positionRows) {
        const quote = posQuotes.get(pos.symbol);
        if (!quote?.last) continue;

        await db
          .update(positions)
          .set({
            currentPrice: quote.last,
            unrealizedPnl: (quote.last - pos.avgCost) * pos.quantity,
            marketValue: quote.last * pos.quantity,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(positions.id, pos.id));

        if (pos.stopLossPrice && quote.last <= pos.stopLossPrice) {
          log.warn(
            {
              symbol: pos.symbol,
              price: quote.last,
              stopLoss: pos.stopLossPrice,
            },
            "Stop loss triggered!",
          );
        }
      }
    }

    // Build context for Haiku scan
    const watchlistItems = await db
      .select()
      .from(watchlist)
      .where(eq(watchlist.active, true))
      .orderBy(desc(watchlist.score))
      .limit(10);

    const quoteSummary = [...preFilter.quotes.entries()]
      .map(([sym, q]) => `${sym}: ${q.last ?? "N/A"}`)
      .join(", ");

    const recentResearch = await db
      .select({
        symbol: research.symbol,
        action: research.suggestedAction,
        confidence: research.confidence,
        sentiment: research.sentiment,
      })
      .from(research)
      .where(
        gte(
          research.createdAt,
          new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        ),
      )
      .orderBy(desc(research.createdAt));

    const pendingOrders = await db
      .select({
        id: trades.id,
        symbol: trades.symbol,
        side: trades.side,
        limitPrice: trades.limitPrice,
        status: trades.status,
      })
      .from(trades)
      .where(eq(trades.status, "SUBMITTED"));

    const scanContext = `Notable changes: ${
      preFilter.reasons.length > 0
        ? preFilter.reasons.join("; ")
        : "None — routine monitoring tick"
    }
Positions: ${
      positionRows.length === 0
        ? "None"
        : JSON.stringify(
            positionRows.map((p) => ({
              symbol: p.symbol,
              qty: p.quantity,
              avgCost: p.avgCost,
              currentPrice: p.currentPrice,
              pnl: p.unrealizedPnl,
            })),
          )
    }
Pending orders: ${
      pendingOrders.length === 0 ? "None" : JSON.stringify(pendingOrders)
    }
Quotes: ${quoteSummary}
Research signals: ${
      recentResearch.length === 0 ? "None" : JSON.stringify(recentResearch)
    }
Watchlist top scores: ${watchlistItems
      .slice(0, 5)
      .map((w) => `${w.symbol}(${w.score})`)
      .join(", ")}`;

    // === Tier 2: Haiku quick scan (~$0.02) ===
    const scan = await runQuickScan(scanContext);

    if (!scan.escalate) {
      log.info({ reason: scan.reason }, "Haiku scan: no escalation needed");
      const dbForLog = getDb();
      await dbForLog.insert(agentLogs).values({
        level: "INFO",
        phase: "trading",
        message: `Quick scan: ${scan.reason}`,
      });
      return;
    }

    // === Tier 3: Full Sonnet agent loop (~$1.70) ===
    log.info({ reason: scan.reason }, "Escalating to full Sonnet analysis");

    const recentContext = await buildRecentContext();
    let fullContext: string;

    if (positionRows.length === 0) {
      fullContext = `
Watchlist quotes: ${JSON.stringify(Object.fromEntries(preFilter.quotes))}
Watchlist data: ${JSON.stringify(watchlistItems)}
${recentContext ? `\n${recentContext}` : ""}
Escalation reason: ${scan.reason}
`;
    } else {
      const account = await getAccountSummary();
      fullContext = `
Account: ${JSON.stringify(account)}
Positions with current quotes: ${JSON.stringify(
        positionRows.map((p) => ({
          ...p,
          currentPrice: preFilter.quotes.get(p.symbol)?.last,
          bid: preFilter.quotes.get(p.symbol)?.bid,
          ask: preFilter.quotes.get(p.symbol)?.ask,
        })),
      )}
${recentContext ? `\n${recentContext}` : ""}
Escalation reason: ${scan.reason}
`;
    }

    await runTradingAnalyst(`${MINI_ANALYSIS_PROMPT}\n\n${fullContext}`);
  } catch (error) {
    log.error({ error }, "Active trading tick failed");
  }
}

/** Wind-down: no new orders */
async function onWindDown(): Promise<void> {
  log.info("Wind-down phase - no new orders will be placed");
  const db = getDb();
  await db.insert(agentLogs).values({
    level: "INFO",
    phase: "wind_down",
    message: "Entering wind-down phase. No new orders.",
  });
}

/** Post-market: reconcile, snapshot, send daily email */
async function onPostMarket(): Promise<void> {
  log.info("Post-market phase starting");

  try {
    await reconcilePositions();
    await recordDailySnapshot();

    log.info("Post-market complete");
  } catch (error) {
    log.error({ error }, "Post-market phase failed");
  }
}

/** Reconcile positions with IBKR */
async function reconcilePositions(): Promise<void> {
  const db = getDb();
  const brokerPositions = await getBrokerPositions();

  // Get current DB positions
  const dbPositions = await db.select().from(positions);
  const dbSymbols = new Set(dbPositions.map((p) => p.symbol));

  // Add/update broker positions
  for (const bp of brokerPositions) {
    if (dbSymbols.has(bp.symbol)) {
      await db
        .update(positions)
        .set({
          quantity: bp.quantity,
          avgCost: bp.avgCost,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(positions.symbol, bp.symbol));
    } else {
      await db.insert(positions).values({
        symbol: bp.symbol,
        quantity: bp.quantity,
        avgCost: bp.avgCost,
      });
    }
  }

  // Remove positions no longer in broker
  const brokerSymbols = new Set(brokerPositions.map((p) => p.symbol));
  for (const dbPos of dbPositions) {
    if (!brokerSymbols.has(dbPos.symbol)) {
      await db.delete(positions).where(eq(positions.id, dbPos.id));
    }
  }

  log.info(
    { broker: brokerPositions.length, db: dbPositions.length },
    "Positions reconciled",
  );
}

/** Record end-of-day portfolio snapshot */
async function recordDailySnapshot(): Promise<void> {
  const db = getDb();
  const account = await getAccountSummary();
  const today = new Date().toISOString().split("T")[0]!;

  // Get previous snapshot for P&L calc
  const prevSnapshot = await db
    .select()
    .from(dailySnapshots)
    .orderBy(desc(dailySnapshots.date))
    .limit(1);

  const prevValue = prevSnapshot[0]?.portfolioValue ?? account.netLiquidation;
  const dailyPnl = account.netLiquidation - prevValue;
  const dailyPnlPercent = prevValue > 0 ? (dailyPnl / prevValue) * 100 : 0;

  // Count today's trades
  const todayTrades = await db
    .select()
    .from(trades)
    .where(gte(trades.createdAt, today));

  const wins = todayTrades.filter((t) => t.pnl !== null && t.pnl > 0).length;
  const losses = todayTrades.filter((t) => t.pnl !== null && t.pnl < 0).length;

  // Calculate total P&L
  const firstSnapshot = await db
    .select()
    .from(dailySnapshots)
    .orderBy(dailySnapshots.date)
    .limit(1);
  const initialValue =
    firstSnapshot[0]?.portfolioValue ?? account.netLiquidation;
  const totalPnl = account.netLiquidation - initialValue;

  await db
    .insert(dailySnapshots)
    .values({
      date: today,
      portfolioValue: account.netLiquidation,
      cashBalance: account.totalCashValue,
      positionsValue: account.grossPositionValue,
      dailyPnl,
      dailyPnlPercent,
      totalPnl,
      tradesCount: todayTrades.length,
      winsCount: wins,
      lossesCount: losses,
    })
    .onConflictDoNothing();

  log.info(
    { date: today, value: account.netLiquidation, dailyPnl, totalPnl },
    "Daily snapshot recorded",
  );
}
