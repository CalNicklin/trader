# Phase 3: Learning Depth — Detailed Design

> Implementation-ready specification for the decision scorer and strategy journal.

---

## Table of Contents

1. [Decision Scorer](#1-decision-scorer)
2. [Strategy Journal](#2-strategy-journal)
3. [Integration Points](#3-integration-points)

---

## 1. Decision Scorer

### Problem

The agent says "HOLD" or "WATCH" ~90% of the time. These decisions are never reviewed. If the agent passes on a stock that rallies 10%, there's no mechanism to detect this and learn from the miss. The trade reviewer only processes FILLED trades — which is the minority of decisions.

### Design

A new daily job (`decision_scorer`) runs at **17:30** — after trade reviews (17:15) but before research pipeline (18:00). It scores every logged HOLD/WATCH decision from today against what actually happened to the stock.

### New File: `src/learning/decision-scorer.ts`

```typescript
/**
 * Decision Scorer
 *
 * Evaluates the quality of HOLD/WATCH/NO-ACTION decisions by checking
 * what happened to the stock price after the decision was made.
 *
 * Scoring:
 *   GOOD HOLD:   Agent said HOLD, stock went down or stayed flat (< +2%)
 *   MISSED OPP:  Agent said HOLD/WATCH, stock went up > 5%
 *   GOOD PASS:   Agent said WATCH, stock went sideways (< ±2%)
 *   GOOD AVOID:  Agent said WATCH on a stock that dropped > 3%
 *   UNCLEAR:     Not enough time has passed or move was 2-5%
 */
```

### How It Works

```
1. Query agent_logs for today's DECISION-level entries
2. Parse each decision for symbol mentions and stated action (HOLD/WATCH/BUY/SELL)
3. For HOLD and WATCH decisions on specific symbols:
   a. Get the stock's price at decision time (from the logged quote data)
   b. Get the stock's current closing price (from daily bar or post-market quote)
   c. Calculate % change since decision
   d. Score the decision
4. For missed opportunities (stock moved +5% since a WATCH decision):
   a. Send to Haiku for brief analysis: "Was this a genuine miss or was caution warranted?"
5. Store results in decision_scores table
6. Feed into pattern analysis pipeline
```

### Decision Extraction

The agent's DECISION-level logs contain free text like:

```
"After reviewing the watchlist and positions, I see no compelling
opportunities today. SHEL is in an uptrend but RSI is overbought at 72.
AZN has a WATCH signal but earnings are next week. Holding current
positions. NO TRADES."
```

We need to extract: which symbols were considered, and what was the stated action.

Rather than regex (which is fragile), we use a Haiku call to extract structured data:

```typescript
interface DecisionExtract {
  symbols: Array<{
    symbol: string;
    statedAction: "BUY" | "SELL" | "HOLD" | "WATCH" | "PASS";
    reason: string; // brief, from the decision text
  }>;
}
```

Prompt for extraction:

```typescript
const EXTRACT_DECISIONS_PROMPT = `Extract stock-level decisions from this trading agent log entry. For each stock mentioned, identify:
- symbol: the LSE ticker
- statedAction: what the agent decided (BUY, SELL, HOLD, WATCH, or PASS if explicitly rejected)
- reason: brief summary of why (max 50 chars)

If the log says "NO TRADES" or similar with no specific stocks mentioned, return an empty array.
Return JSON: { "symbols": [...] }`;
```

This is one Haiku call (~$0.02) for all of today's decisions batched together.

### Scoring Logic

```typescript
interface DecisionScore {
  symbol: string;
  decisionTime: string;        // ISO timestamp
  statedAction: string;        // HOLD, WATCH, PASS
  reason: string;              // Why the agent made this decision
  priceAtDecision: number;
  priceNow: number;
  changePct: number;
  score: "good_hold" | "good_pass" | "good_avoid" | "missed_opportunity" | "unclear";
  assessment: string | null;   // Haiku assessment for missed opportunities
}

function scoreDecision(
  statedAction: string,
  changePct: number,
): DecisionScore["score"] {
  if (statedAction === "HOLD") {
    // Holding an existing position
    if (changePct < -3) return "good_hold"; // Would have lost more if we'd sold and re-entered
    if (changePct > 5) return "missed_opportunity"; // Held but could have added
    return changePct < 2 ? "good_hold" : "unclear";
  }

  if (statedAction === "WATCH" || statedAction === "PASS") {
    // Didn't enter a position
    if (changePct > 5) return "missed_opportunity";
    if (changePct < -3) return "good_avoid";
    return Math.abs(changePct) < 2 ? "good_pass" : "unclear";
  }

  return "unclear";
}
```

### Missed Opportunity Analysis

When a decision scores as `missed_opportunity`, we send it to Haiku for a brief assessment:

```typescript
const MISSED_OPP_PROMPT = `A trading agent decided to ${statedAction} on ${symbol} at ${priceAtDecision}p.
Reason: "${reason}"
The stock has since moved ${changePct > 0 ? "up" : "down"} ${Math.abs(changePct).toFixed(1)}% to ${priceNow}p.

Was this a genuine miss, or was the caution warranted given the information available at decision time?
Consider: Was the move predictable from the data? Were there warning signs the agent should have heeded?

Respond with JSON:
{
  "genuineMiss": true/false,
  "lesson": "one sentence lesson (max 100 chars)",
  "tags": ["tag1", "tag2"]  // 1-3 tags like "missed-momentum", "overly-cautious", "unpredictable-move"
}`;
```

Cost: ~$0.02 per missed opportunity. Typically 0-3 per day.

### Database Schema

```typescript
// New table in src/db/schema.ts
export const decisionScores = sqliteTable("decision_scores", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull(),
  decisionTime: text("decision_time").notNull(),
  statedAction: text("stated_action").notNull(), // HOLD, WATCH, PASS
  reason: text("reason"),
  priceAtDecision: real("price_at_decision").notNull(),
  priceNow: real("price_now").notNull(),
  changePct: real("change_pct").notNull(),
  score: text("score", {
    enum: ["good_hold", "good_pass", "good_avoid", "missed_opportunity", "unclear"],
  }).notNull(),
  genuineMiss: integer("genuine_miss", { mode: "boolean" }),
  lesson: text("lesson"),
  tags: text("tags"), // JSON array string
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
```

### Integration with Pattern Analysis

The pattern analyzer (`src/learning/pattern-analyzer.ts`) already processes trade reviews. Extend it to also process decision scores:

```typescript
// In runPatternAnalysis(), add after existing data gathering:

// Get recent decision scores
const decisionScoreRows = await db
  .select()
  .from(decisionScores)
  .where(gte(decisionScores.createdAt, sevenDaysAgo));

const missedOpps = decisionScoreRows.filter(d => d.score === "missed_opportunity");
const goodAvoids = decisionScoreRows.filter(d => d.score === "good_avoid");
const goodHolds = decisionScoreRows.filter(d => d.score === "good_hold");

// Add to the pattern analysis prompt:
const decisionContext = `
## Decision Quality (${decisionScoreRows.length} scored decisions)
- Missed opportunities: ${missedOpps.length} (stocks passed on that rallied >5%)
${missedOpps.map(d => `  - ${d.symbol}: passed at ${d.priceAtDecision}p, now ${d.priceNow}p (+${d.changePct.toFixed(1)}%) — ${d.lesson}`).join("\n")}
- Good avoids: ${goodAvoids.length} (stocks passed on that dropped >3%)
- Good holds: ${goodHolds.length}
- Caution ratio: ${decisionScoreRows.length > 0 ? (missedOpps.length / decisionScoreRows.length * 100).toFixed(0) : 0}% missed vs ${goodAvoids.length > 0 ? (goodAvoids.length / decisionScoreRows.length * 100).toFixed(0) : 0}% good avoid
`;
```

This gives the pattern analyzer data to produce insights like:
- "Agent is too cautious on momentum setups — 4 missed opportunities vs 1 good avoid in tech sector"
- "Caution on earnings-adjacent stocks is justified — 3/4 good avoids were pre-earnings"

### Job Registration

```typescript
// In src/scheduler/jobs.ts — add to job registry
"decision_scorer"  // Daily at 17:30

// In src/scheduler/cron.ts
cron.schedule("30 17 * * 1-5", () => runJobs("decision_scorer"), {
  timezone: "Europe/London",
});
```

### Price Data Source

For "price at decision time" — the agent's decision logs don't always include the exact price. Two options:

**Option A (simple):** Use the day's closing price from `getHistoricalBars(symbol, "1 M")` — the last bar is today's daily bar (available after market close).

**Option B (more accurate):** During the active trading tick, when the Haiku/Sonnet decision is logged, also log the quote data as JSON in the `agent_logs.data` field. The decision scorer parses this.

**Recommendation:** Option B for new decisions (add quote data to decision logs going forward). Option A as fallback for decisions that don't have quote data attached. Since the scorer runs at 17:30 (after market close), the closing price is a reasonable approximation for same-day decisions.

### Full Scoring Timeline

```
During trading day:
  07:30-16:30: Agent makes decisions, logged to agent_logs
  Each DECISION log includes: text, symbol mentions, quote data in .data field

After market close:
  17:15: Trade reviewer (existing) — scores FILLED trades
  17:30: Decision scorer (NEW) — scores HOLD/WATCH/PASS decisions
    1. Batch all DECISION logs from today
    2. Extract symbols + actions via Haiku ($0.02)
    3. Get closing prices for each symbol
    4. Score each decision
    5. For missed opportunities: Haiku analysis ($0.02 each, 0-3 typical)
    6. Store to decision_scores table

Wednesday/Friday 19:00:
  Pattern analysis reads decision_scores alongside trade_reviews
  Produces insights about decision quality, caution calibration
```

### Cost

| Component | Per Day | Per Month (20 days) |
|-----------|---------|-------------------|
| Decision extraction (1 Haiku call) | $0.02 | $0.40 |
| Missed opportunity analysis (0-3 Haiku) | $0.00-0.06 | $0.00-1.20 |
| **Total** | **$0.02-0.08** | **$0.40-1.60** |

---

## 2. Strategy Journal

### Problem

The system records lessons from individual trades and identifies patterns, but these don't accumulate into an evolving strategy. The trading prompt is static. The agent makes the same types of decisions regardless of what it has learned. The self-improvement system can modify prompt text, but there's no structured hypothesis-testing framework.

### Design

A **strategy journal** is a living set of hypotheses that the agent builds from evidence and then acts on. It bridges the gap between "we observed a pattern" (weekly insights) and "we should change our behaviour" (trading prompt).

### How Hypotheses Work

```
Lifecycle:
  PROPOSED → ACTIVE → CONFIRMED or REJECTED

  PROPOSED:   Pattern analysis identified a potential pattern.
              Insufficient data to act on it. Monitor.

  ACTIVE:     Enough supporting evidence to start using in decisions.
              Agent should factor this into scoring.
              Tracked for ongoing validation.

  CONFIRMED:  Strong evidence over 20+ trades. Permanent strategy element.
              Self-improvement system may codify into prompt text.

  REJECTED:   Counter-evidence disproved the hypothesis.
              Kept for reference (don't re-propose the same thing).
```

### Database Schema

```typescript
// New table in src/db/schema.ts
export const strategyHypotheses = sqliteTable("strategy_hypotheses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  hypothesis: text("hypothesis").notNull(),
    // e.g., "Momentum entries in technology sector have higher win rate"
  evidence: text("evidence").notNull(),
    // e.g., "8/12 tech momentum trades were wins (67%). Sector avg is 45%."
  actionable: text("actionable").notNull(),
    // e.g., "Increase confidence by +0.05 for tech momentum setups"
  category: text("category", {
    enum: ["sector", "timing", "momentum", "value", "risk", "sizing", "general"],
  }).notNull(),
  status: text("status", {
    enum: ["proposed", "active", "confirmed", "rejected"],
  }).notNull().default("proposed"),
  supportingTrades: integer("supporting_trades").notNull().default(0),
  winRate: real("win_rate"),
  sampleSize: integer("sample_size").notNull().default(0),
  proposedAt: text("proposed_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  lastEvaluatedAt: text("last_evaluated_at"),
  statusChangedAt: text("status_changed_at"),
  rejectionReason: text("rejection_reason"),
});
```

### Hypothesis Proposal (via Pattern Analysis)

The pattern analyzer already runs Wed/Fri. Extend its prompt to also propose and evaluate hypotheses.

Add to `PATTERN_ANALYZER_SYSTEM` in `src/learning/prompts.ts`:

```typescript
// Append to existing prompt:
`
## Strategy Hypotheses

You also manage the strategy journal. Based on the data:

1. **Propose new hypotheses** if you see a pattern with ≥5 supporting trades that isn't already tracked.
2. **Evaluate existing hypotheses** against the latest data. Update status:
   - PROPOSED → ACTIVE: if supporting evidence reaches ≥10 trades with consistent pattern
   - ACTIVE → CONFIRMED: if ≥20 trades with stable win rate (±10% from original observation)
   - ANY → REJECTED: if counter-evidence clearly disproves it (e.g., win rate dropped below 40%)

Include in your response a second JSON array "hypotheses":
[
  {
    "action": "propose" | "update" | "reject",
    "id": null (for propose) | number (for update/reject),
    "hypothesis": "description",
    "evidence": "supporting data from this analysis",
    "actionable": "what the trading agent should do differently",
    "category": "sector" | "timing" | "momentum" | "value" | "risk" | "sizing" | "general",
    "status": "proposed" | "active" | "confirmed" | "rejected",
    "winRate": 0.67,
    "sampleSize": 12,
    "rejectionReason": null | "reason"
  }
]

Existing hypotheses to evaluate:
${existingHypotheses}
`
```

### Integration Into Pattern Analyzer

In `src/learning/pattern-analyzer.ts`, after parsing insights, also parse hypothesis updates:

```typescript
// After existing insight storage:

interface HypothesisUpdate {
  action: "propose" | "update" | "reject";
  id: number | null;
  hypothesis: string;
  evidence: string;
  actionable: string;
  category: string;
  status: string;
  winRate: number | null;
  sampleSize: number;
  rejectionReason: string | null;
}

// Parse from response (same JSON, second array)
const hypothesesMatch = text.match(/"hypotheses"\s*:\s*(\[[\s\S]*?\])/);
if (hypothesesMatch) {
  const updates = JSON.parse(hypothesesMatch[1]) as HypothesisUpdate[];

  for (const update of updates) {
    if (update.action === "propose") {
      await db.insert(strategyHypotheses).values({
        hypothesis: update.hypothesis,
        evidence: update.evidence,
        actionable: update.actionable,
        category: update.category as any,
        status: "proposed",
        winRate: update.winRate,
        sampleSize: update.sampleSize,
      });
    } else if (update.action === "update" && update.id) {
      await db.update(strategyHypotheses).set({
        evidence: update.evidence,
        status: update.status as any,
        winRate: update.winRate,
        sampleSize: update.sampleSize,
        lastEvaluatedAt: new Date().toISOString(),
        statusChangedAt: update.status !== "proposed" ? new Date().toISOString() : undefined,
      }).where(eq(strategyHypotheses.id, update.id));
    } else if (update.action === "reject" && update.id) {
      await db.update(strategyHypotheses).set({
        status: "rejected",
        rejectionReason: update.rejectionReason,
        lastEvaluatedAt: new Date().toISOString(),
        statusChangedAt: new Date().toISOString(),
      }).where(eq(strategyHypotheses.id, update.id));
    }
  }
}
```

### Feeding Hypotheses Into Trading Decisions

The learning brief (`src/learning/context-builder.ts`) already injects insights into the day plan and active trading context. Extend it to include active/confirmed hypotheses:

```typescript
// In buildLearningBrief():

// Active and confirmed strategy hypotheses
const hypotheses = await db
  .select()
  .from(strategyHypotheses)
  .where(
    or(
      eq(strategyHypotheses.status, "active"),
      eq(strategyHypotheses.status, "confirmed"),
    ),
  )
  .orderBy(desc(strategyHypotheses.sampleSize));

if (hypotheses.length > 0) {
  parts.push("\n### Strategy Journal (Active Hypotheses):");
  for (const h of hypotheses) {
    const prefix = h.status === "confirmed" ? "[CONFIRMED] " : "";
    parts.push(`- ${prefix}${h.hypothesis}`);
    parts.push(`  Action: ${h.actionable}`);
    parts.push(`  Evidence: ${h.evidence} (n=${h.sampleSize}, win rate=${((h.winRate ?? 0) * 100).toFixed(0)}%)`);
  }
}
```

Example output in the agent's context:

```
### Strategy Journal (Active Hypotheses):
- [CONFIRMED] Momentum entries in technology sector outperform
  Action: Increase confidence by +0.05 for tech momentum setups
  Evidence: 15/22 tech momentum trades were wins. Sector avg is 48%. (n=22, win rate=68%)
- Avoid entries after 3+ consecutive green days
  Action: Reduce confidence by 0.1 for extended rally entries
  Evidence: 3/9 wins on extended rally entries vs 62% baseline. (n=9, win rate=33%)
```

The agent sees this in its learning brief and adjusts its multi-factor scoring accordingly. [CONFIRMED] hypotheses act as hard modifiers. Active hypotheses are softer suggestions.

### Self-Improvement Integration

The self-improvement system (`src/self-improve/monitor.ts`) already proposes code changes. With the strategy journal:

1. **Confirmed hypotheses** with large sample sizes (n≥30) become candidates for codification into the prompt text (via self-improvement PR).
2. The self-improvement prompt is extended to review confirmed hypotheses and decide if any should be permanently embedded.

```typescript
// Add to self-improvement context:
const confirmedHypotheses = await db
  .select()
  .from(strategyHypotheses)
  .where(
    and(
      eq(strategyHypotheses.status, "confirmed"),
      gte(strategyHypotheses.sampleSize, 30),
    ),
  );

// Include in self-improvement prompt:
`Confirmed strategy hypotheses (candidates for codification):
${confirmedHypotheses.map(h => `- ${h.hypothesis} (n=${h.sampleSize}, WR=${((h.winRate ?? 0) * 100).toFixed(0)}%): ${h.actionable}`).join("\n")}

If any of these are strong enough, propose embedding them into the trading analyst prompt as permanent rules.`
```

### Hypothesis Lifecycle Example

```
Week 1:
  Pattern analysis sees 5/7 tech momentum trades win.
  Proposes: "Momentum entries in technology sector have higher win rate"
  Status: PROPOSED, n=7, WR=71%

Week 3:
  Pattern analysis re-evaluates. Now 10/15 tech momentum trades win.
  Updates: Status → ACTIVE, n=15, WR=67%
  Agent now sees this in learning brief and adjusts confidence.

Week 6:
  Pattern analysis re-evaluates. Now 18/25 tech momentum trades win.
  Updates: Status → CONFIRMED, n=25, WR=72%
  Agent treats this as a hard modifier.

Week 8:
  Self-improvement reviews. n=32, WR=69%.
  Proposes PR: "Add tech-momentum confidence boost to trading prompt."
  If merged, the hypothesis becomes permanent prompt logic.
```

---

## 3. Integration Points

### New Files

| File | Purpose |
|------|---------|
| `src/learning/decision-scorer.ts` | Decision scoring job |

### Modified Files

| File | Change |
|------|--------|
| `src/db/schema.ts` | Add `decisionScores` and `strategyHypotheses` tables |
| `src/learning/prompts.ts` | Extend `PATTERN_ANALYZER_SYSTEM` with hypothesis management |
| `src/learning/pattern-analyzer.ts` | Add hypothesis proposal/update logic, add decision score data |
| `src/learning/context-builder.ts` | Include active/confirmed hypotheses in learning brief |
| `src/scheduler/cron.ts` | Add `decision_scorer` job at 17:30 |
| `src/scheduler/jobs.ts` | Register `decision_scorer` in job registry |
| `src/self-improve/monitor.ts` | Include confirmed hypotheses in self-improvement context |
| `src/agent/orchestrator.ts` | Include quote data in DECISION-level agent_logs (for scorer) |

### New DB Tables

| Table | Purpose |
|-------|---------|
| `decision_scores` | Scored HOLD/WATCH/PASS decisions |
| `strategy_hypotheses` | Living strategy journal |

### Daily Schedule (Updated)

```
17:15  trade_review         — Score FILLED trades (existing)
17:30  decision_scorer      — Score HOLD/WATCH decisions (NEW)
18:00  research_pipeline    — Discover + research stocks (existing)
19:00  pattern_analysis     — Insights + hypothesis management (EXTENDED)
```

### Cost Summary

| Component | Per Day | Per Month |
|-----------|---------|-----------|
| Decision extraction (1 Haiku) | $0.02 | $0.40 |
| Missed opportunity analysis (0-3 Haiku) | $0.00-0.06 | $0.00-1.20 |
| Hypothesis management (within existing pattern analysis call) | $0.00 | $0.00 |
| **Total Phase 3** | **$0.02-0.08** | **$0.40-1.60** |

---

## Full Learning Loop (After Phase 3)

```
Trading Day:
  Agent makes decisions → logged with quote data
      │
      ▼
17:15 Trade Reviewer
  Reviews FILLED trades → trade_reviews table
      │
      ▼
17:30 Decision Scorer (NEW)
  Scores HOLD/WATCH decisions → decision_scores table
  Identifies missed opportunities
      │
      ▼
18:00 Research Pipeline
  Updates stock data and watchlist scores
      │
      ▼
19:00 Pattern Analysis (EXTENDED)
  Reads: trade_reviews + decision_scores + daily_snapshots
  Produces: weekly_insights + hypothesis updates
      │
      ├─ New hypotheses → PROPOSED
      ├─ Supported hypotheses → ACTIVE → CONFIRMED
      └─ Disproven hypotheses → REJECTED
      │
      ▼
07:30 Next Day - Learning Brief
  Includes: insights + active/confirmed hypotheses
  Agent adjusts scoring based on evidence
      │
      ▼
Trading Day:
  Agent makes BETTER decisions informed by:
  - Trade lessons (what went right/wrong)
  - Decision quality (was caution warranted?)
  - Strategy hypotheses (what patterns work?)
      │
      ▼
Sunday 20:00 Self-Improvement
  Reviews confirmed hypotheses (n≥30)
  May propose codifying into permanent prompt logic
  Creates PR → merge → hypothesis becomes code
```

The full loop from "observation" to "codified strategy change" is:
- **Fast path:** Insight → learning brief → next day's decisions (1 day)
- **Medium path:** Hypothesis ACTIVE → agent adjusts scoring (1-2 weeks)
- **Slow path:** Hypothesis CONFIRMED → self-improvement PR → merged → permanent (4-8 weeks)

This gives the system three speeds of adaptation: daily tactical adjustment, weekly strategic adjustment, and monthly structural improvement.
