# Phase 4: Autonomy Escalation

> Graduated rollout from paper trading to full live trading. Categorized rollback triggers. Governance reporting with attributable impact measurement.
>
> Reference: [strategy-framework.md](./strategy-framework.md) for KPI framework and rollout discipline.

---

## Table of Contents

1. [Rollout Ladder](#1-rollout-ladder)
2. [Rollback Triggers](#2-rollback-triggers)
3. [Governance Reporting](#3-governance-reporting)

---

## 1. Rollout Ladder

Four operating modes, each with increasing autonomy and risk exposure:

### Mode: `paper`

**Current state.** All decisions executed on IBKR paper account.

- Full position sizing, full strategy execution
- No real capital at risk
- Generates data for Phase 3 learning loop
- **Minimum time at mode:** Until Phase 3 exit gate is met

### Mode: `shadow_live`

Paper decisions continue. Additionally, log what _would_ have happened live:

- Compare paper fills vs live market conditions (slippage, spread, execution timing)
- Track hypothetical P&L if orders had been live
- Identify systematic differences between paper and live execution
- **Minimum time at mode:** 2 weeks with positive shadow P&L

### Mode: `constrained_live`

Live trading with reduced limits:

```typescript
const CONSTRAINED_LIMITS = {
  MAX_POSITIONS: 3,          // vs 5 in full mode
  MAX_POSITION_PCT: 10,      // vs 15 in full mode
  MIN_CASH_RESERVE_PCT: 30,  // vs 10 in full mode (extra safety buffer)
  DAILY_LOSS_LIMIT_PCT: 2,   // vs 5 in full mode (tighter circuit breaker)
  WEEKLY_LOSS_LIMIT_PCT: 4,  // vs 10 in full mode
};
```

- Real capital at risk, but exposure is capped
- All Phase 1 safety infrastructure active (Guardian, risk pipeline, stop-losses)
- **Minimum time at mode:** 4 weeks with positive expectancy

### Mode: `full_live`

Full risk config limits. Normal operation.

- **Requires Q's explicit approval** — no automated promotion to this mode
- All KPIs must be green for the trailing 4-week window
- Zero unplanned rollbacks in final 2 weeks of `constrained_live`

### Promotion Between Modes

Promotion requires:
1. Meeting the current mode's exit gate
2. Minimum time at current mode satisfied
3. All relevant KPIs within thresholds (rolling windows from strategy-framework.md)
4. For `full_live`: Q's explicit sign-off

```typescript
interface ModePromotion {
  from: OperatingMode;
  to: OperatingMode;
  requires: {
    exitGateMet: boolean;
    minimumTimeAtMode: string; // e.g., "2 weeks", "4 weeks"
    kpisGreen: boolean;
    humanApproval: boolean;    // true only for full_live
  };
}
```

### Configuration

Operating mode is stored in a config file (not hard-coded):

```typescript
// config/operating-mode.json
{
  "mode": "paper",
  "promotedAt": "2026-02-23T00:00:00Z",
  "promotedBy": "initial",
  "previousMode": null
}
```

Changes to operating mode require a PR (same governance as gate config changes).

---

## 2. Rollback Triggers

Triggers are categorized by type to avoid false emergency reversions. An infrastructure failure (stale quotes, IBKR disconnect) should not cause a strategy rollback.

### Strategy-Level Triggers

_Revert to previous operating mode + last known-good config:_

| Trigger | Threshold | Action |
|---------|-----------|--------|
| Daily loss | > 3% at any mode | Pause trading, alert Q, revert to previous mode |
| Weekly loss | > 5% | Pause trading, alert Q, revert to previous mode |
| Consecutive strategy rejections | 3+ consecutive | Pause and alert. Strategy is misaligned with risk bounds. |
| Self-improvement KPI regression | Rolling 20-trade window post-merge shows regression | Revert PR, alert Q |

**Strategy rejections** are risk pipeline rejections where the _reason_ is strategy-related:
- Sector concentration exceeded (agent trying to over-concentrate)
- Position sizing exceeded (agent trying to take too-large positions)
- Confidence threshold failed (agent's conviction doesn't meet bar)

These indicate the strategy is pushing against risk bounds — a signal that gate parameters or prompt need adjustment.

### Infrastructure-Level Triggers

_Alert + investigate. Do NOT revert strategy config:_

| Trigger | Threshold | Action |
|---------|-----------|--------|
| Consecutive infrastructure rejections | 3+ consecutive | Pause trading, alert Q, investigate infrastructure |
| Job failures | Any critical job fails | Alert via heartbeat |
| Missed ticks | 2+ consecutive missed orchestrator ticks | Alert Q |
| Reconciliation mismatches | Any position mismatch | Alert Q, pause until resolved |

**Infrastructure rejections** are risk pipeline rejections where the _reason_ is infrastructure-related:
- Stale quotes (data unavailable)
- IBKR connection failure
- Market hours mismatch
- Data fetch timeout

These do NOT indicate a strategy problem. Reverting gate/prompt config would be a false response.

### Rejection Categorization

Uses the specific rejection codes already returned by `checkTradeRisk()` in `src/risk/manager.ts`:

```typescript
type RejectionCategory = "strategy" | "infrastructure";

function categorizeRejection(reason: string): RejectionCategory {
  const infrastructurePatterns = [
    "stale_quote", "connection_failed", "data_unavailable",
    "market_closed", "timeout", "quote_fetch_failed",
  ];
  return infrastructurePatterns.some(p => reason.includes(p))
    ? "infrastructure"
    : "strategy";
}
```

### Rollback Mechanics

```typescript
interface RollbackEvent {
  timestamp: string;
  trigger: string;           // which trigger fired
  category: "strategy" | "infrastructure";
  previousMode: OperatingMode;
  revertedTo: OperatingMode;
  configReverted: boolean;   // true only for strategy triggers
  resolvedAt: string | null;
  resolution: string | null;
}
```

Rollback events are logged to `agent_logs` and included in governance reports.

---

## 3. Governance Reporting

Weekly automated report via existing email infrastructure (Resend). Sent every Friday at 18:00 alongside the weekly summary.

### Report Contents

**Policy Changes:**
- Gate parameter changes made this week (with before/after values)
- Prompt version changes
- Hypothesis promotions (PROPOSED → ACTIVE, ACTIVE → CONFIRMED)
- Self-improvement PRs merged

**Attributable Impact:**
- For each change: before/after KPIs measured over the same rolling window
  ```
  Change: minVolumeRatio 0.8 → 0.6 (merged Mon)
  Before (20-trade window ending Sun): WR 55%, expectancy £42
  After  (20-trade window ending Fri): WR 62%, expectancy £58
  ```
- Net portfolio impact attributable to changes vs market movement

**Operating Mode:**
- Current mode and time at mode
- Progress toward next mode's exit gate
- Estimated time to promotion (based on current trade frequency)

**Rollback Events:**
- Any rollbacks this week with trigger, category, and resolution
- Unresolved rollbacks flagged as blockers

**Upcoming Evaluations:**
- Hypotheses nearing n>=30 sample threshold
- Expected evaluation dates based on current trade frequency

### Report Generation

```typescript
// New file: src/reporting/governance-report.ts

interface GovernanceReport {
  period: { start: string; end: string };
  policyChanges: PolicyChange[];
  attributableImpact: ImpactMeasurement[];
  operatingMode: {
    current: OperatingMode;
    timeAtMode: string;
    exitGateProgress: Record<string, { met: boolean; current: string; threshold: string }>;
  };
  rollbackEvents: RollbackEvent[];
  upcomingEvaluations: {
    hypothesisId: number;
    hypothesis: string;
    currentSample: number;
    targetSample: number;
    estimatedReadyDate: string;
  }[];
}
```

### Measurement Windows

All governance KPIs use the same rolling windows defined in [strategy-framework.md](./strategy-framework.md):
- Trade-denominated: rolling 20-trade window
- Calendar-denominated: rolling 4-week window

---

## Exit Gate

Phase 4 is complete (system reaches steady state) when ALL of the following are met:

- **Operating mode:** System in `constrained_live` for 4+ weeks with positive expectancy over the trailing 20-trade window.
- **Zero unplanned rollbacks:** No strategy-level rollbacks in the final 2 weeks. Infrastructure rollbacks are acceptable if resolved within 24 hours.
- **Governance reports generating:** Weekly reports include attributable impact data for at least 2 policy changes. Reports are being sent and reviewed.
- **Champion/challenger flowing:** At least one hypothesis has completed a full lifecycle (PROPOSED → ACTIVE → CONFIRMED or REJECTED) with proper promotion gate enforcement.
- **`full_live` promotion:** Requires Q's explicit sign-off. This is not an automated gate.

---

## Files Changed/Created

| File | Action | What |
|------|--------|------|
| `config/operating-mode.json` | **NEW** | Operating mode config (paper/shadow/constrained/full) |
| `src/risk/limits.ts` | **MODIFY** | Add constrained-mode limit overrides |
| `src/risk/manager.ts` | **MODIFY** | Rejection categorization (strategy vs infrastructure) |
| `src/reporting/governance-report.ts` | **NEW** | Weekly governance report generation |
| `src/scheduler/cron.ts` | **MODIFY** | Add governance report job (Friday 18:00) |
| `src/scheduler/jobs.ts` | **MODIFY** | Register governance report job |
| `src/agent/orchestrator.ts` | **MODIFY** | Operating mode checks, rollback trigger monitoring |
| `src/broker/guardian.ts` | **MODIFY** | Consecutive rejection tracking, rollback trigger evaluation |

**Total: 2 new files, 6 modified files.**
