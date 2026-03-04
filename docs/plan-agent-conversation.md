# Plan Review Conversation

Participants:
- Q's active agent (this session)
- Secondary review agent

Context under review:
- `/Users/Cal/.cursor/plans/reduce_api_cost_9ee4a1fd.plan.md`
- `/Users/Cal/.cursor/plans/cost_&_effectiveness_upgrade_82272f41.plan.md`

---

## Turn 1 — Active agent to secondary review agent

Please review both plans and answer:
1. Which plan should be executed first?
2. What are the top 3 risks in that plan?
3. What concrete edits would you make before implementation starts?

Constraint: pick one plan only (no hybrid recommendation).

---

## Turn 2 — Secondary review agent to active agent

- **Preferred plan (single file path)**  
`/Users/Cal/.cursor/plans/reduce_api_cost_9ee4a1fd.plan.md`

- **Why it is better**
  - Tightly scoped to the confirmed cost incident and can be shipped quickly without cross-cutting refactors.
  - Controls are concrete and deterministic (cooldown, state hash, daily budget) rather than policy-heavy.
  - Directly fixes the known observability bug (`recordUsage` missing on expensive paths), which is prerequisite for trusting any cost optimization.
  - Has clear defaults and env-based tuning (`DAILY_API_BUDGET_USD`, `MAX_AGENT_ITERATIONS`) for safe production iteration.
  - Lower implementation blast radius means lower regression risk in trading behavior versus the broader upgrade plan.

- **Top 3 risks**
  - In-memory cooldown/hash state resets on process restart, potentially allowing repeated Tier 3 runs after deploy/restart.
  - A simplistic “material change” definition (e.g., fixed 3% move) can suppress needed escalations in edge risk scenarios.
  - Hardcoded Sonnet cost estimate (`0.40`) can drift from reality and cause either premature blocking or budget overruns.

- **Concrete pre-implementation edits**
  - Define and document an explicit `EscalationState` type plus deterministic fingerprint serializer (stable sort + canonical JSON).
  - Move cooldown duration, material-change threshold, and Sonnet estimated cost into typed config/env with validated defaults.
  - Persist minimal escalation state (`lastStateHash`, `lastSonnetRunTime`, `lastConclusion`) to DB for restart resilience.
  - Add a `finally`-based usage capture contract that records attempted/failed/incomplete sessions distinctly.
  - Add a small validation test matrix before coding: identical ticks, price-threshold edge, restart behavior, budget edge-of-day rollover.
  - Add structured skip reason codes (e.g., `budget_block`, `cooldown_block`, `duplicate_state`) to logs for post-rollout tuning.

---

## Turn 3 — Active agent synthesis

I agree with the secondary review outcome.

Decision:
- Proceed with `/Users/Cal/.cursor/plans/reduce_api_cost_9ee4a1fd.plan.md` as the implementation baseline.

Mandatory adjustments before coding:
1. Persist escalation state to survive restarts.
2. Move all gating constants into validated config.
3. Implement `finally`-safe usage capture with distinct failure states.
4. Add deterministic skip reason codes for measurable rollout tuning.

---

## Turn 4 — Active agent response

The secondary agent's review is sound. Responding to the three risks and the pre-implementation edits:

### On the risks

**1. In-memory state resets on restart.** Agreed — this is a real problem. The Docker container restarts daily at 05:00 UTC (IB Gateway cold restart), and deploys via CI also restart the container. If escalation state is purely in-memory, the first tick after restart has no cooldown context and will re-escalate on unchanged state.

Fix: persist `lastStateHash`, `lastSonnetRunTime`, and `lastSonnetConclusion` to the `agent_logs` table (or a dedicated lightweight table). On startup, hydrate from the most recent row. This is ~10 lines of code and makes the gate restart-safe.

**2. Simplistic material-change definition.** Agreed. A fixed 3% threshold is wrong for volatile small-caps vs stable large-caps. But making this adaptive is a Phase 2 optimization — for now, any fixed threshold is better than no threshold (which is the current state). I'd set it at 2% to match the existing Tier 1 "price moves >2%" flag, keeping the system internally consistent. We can evolve this to ATR-relative after we have data on how often the gate fires.

**3. Hardcoded Sonnet cost estimate.** The `0.40` in `canAffordSonnet(0.40)` was a ballpark. The secondary agent is right that this drifts. Better approach: derive it from the last 5 completed sessions' average cost (from `token_usage` table) with a 1.5x safety margin, floored at $0.20. This makes the budget check self-calibrating.

### On the pre-implementation edits

All six are accepted. Specifically:

- **`EscalationState` type + canonical fingerprint**: Yes. This prevents subtle bugs from object key ordering or floating-point quote values.
- **Config/env for all constants**: Yes. `ESCALATION_COOLDOWN_MIN`, `MATERIAL_CHANGE_PCT`, `DAILY_API_BUDGET_USD`, `MAX_AGENT_ITERATIONS` — all in `src/config.ts` with Zod validation.
- **DB persistence for escalation state**: Covered above.
- **`finally`-based usage capture with session status**: Yes. Record `status: "complete" | "max_iterations" | "error"` alongside the token counts.
- **Validation test matrix**: Yes, but lightweight. Three scenarios: (a) 5 identical ticks → Tier 3 fires once, (b) price crosses material-change threshold mid-cooldown → Tier 3 fires, (c) restart mid-day → state hydrates and cooldown resumes. These can be unit tests against the gate logic, no live API calls needed.
- **Structured skip reason codes**: Yes. `budget_exceeded`, `cooldown_active`, `state_unchanged`, `haiku_no_escalate` — logged to `agent_logs` with level `INFO` and phase `trading`.

### Gate ordering amendment

One thing neither the secondary agent nor the synthesis addressed: gate ordering. The other plan (cost_&_effectiveness_upgrade) checks novelty first, then Haiku, with budget at the end. My plan checks budget first. Budget should be checked first — it's the cheapest check (one DB query) and if the budget is blown, everything else is moot. Proposed order:

1. Budget check (DB query, ~1ms)
2. Cooldown + state-hash check (in-memory/DB, ~1ms)
3. Haiku quick scan (API call, ~$0.002)
4. Post-Haiku state-hash verification (in-memory, ~0ms)
5. Sonnet analyst

### Summary

Proceeding with the Reduce API Cost plan, amended with all 4 mandatory adjustments plus self-calibrating budget estimate and gate ordering. Updating the plan file now.

---

## Turn 5 — Q's verdict

Plan approved with four mandatory amendments:

1. **Dedicated `escalation_state` table** — remove `agent_logs` fallback.
2. **Haiku stays active when budget-capped** — budget gate blocks only Sonnet, not Haiku risk triage.
3. **Explicit Drizzle migration for `token_usage.status`** — `bun run db:generate`, include in PR.
4. **Quote-move buckets in fingerprint** — bucket prices into discrete bands to reduce false duplicate-state suppression.

All four incorporated into the plan. Ready for implementation.
