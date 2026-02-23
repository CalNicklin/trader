The Core Problem
The system is designed around not losing money. 20% cash reserve, 5% max position, 10-position diversification, 3% fixed stops, 0.7 confidence threshold, sector caps, trade frequency limits. That's the right design if you don't know whether you have edge. But it also guarantees modest returns even when you do have edge. You've built a trading system optimised for survival, not for profit.
If you want maximum returns, you need to change the objective function. Here's what I'd do, ranked by impact.
1. US Stocks First, LSE Second (Phase 1.5)
Already covered, but it's the single biggest lever. Every trade on LSE main market costs you 0.5% before it even moves. On US equities that's zero. The friction difference alone is worth 5-7% annually on active strategies. This isn't a nice-to-have — it's the foundation everything else builds on.
2. Momentum, Not Multi-Factor
The Phase 2 prompt designs a balanced 5-factor framework (trend, momentum, value, catalyst, risk/reward). That's academically responsible but it dilutes the strongest signal. Academic research across decades and geographies is clear: momentum is the single most persistent market anomaly. Stocks going up tend to keep going up. Stocks going down tend to keep going down.
The current system tries to be a research analyst, a value investor, and a momentum trader simultaneously. It should pick one and be great at it. For an automated system that monitors every 10 minutes, momentum is the natural fit:
Entry: Buy stocks making 20-day highs with above-average volume and RSI 50-70 (momentum building, not exhausted)
Exit: Sell when momentum breaks — price closes below the 20-day SMA, or RSI diverges from price
Universe: Top 100 NASDAQ/NYSE stocks by 30-day performance, filtered for liquidity
Value investing requires deep qualitative judgement (moats, management, competitive dynamics) that an LLM is mediocre at. Momentum is quantitative — it plays directly to the system's strengths: tireless monitoring, systematic entry/exit rules, no emotional attachment to positions.
This doesn't mean ignoring fundamentals entirely — use them as a filter (don't buy momentum in a stock that's losing money and burning cash), not as a signal.
3. Concentrate
This is the change that scares people but moves the needle most.
Parameter	Current	Aggressive
Max positions	10	5
Max per position	5%	15%
Cash reserve	20%	10%
Effective max deployment	50%	75%
The Kelly criterion says: if your edge is real, bet proportionally to it. Ten positions at 5% each is a closet index tracker. Five positions at 15% each is a concentrated portfolio that can actually move.
On a £20K ISA:
Current: 10 × £1,000 = £10K deployed, £10K cash. A 10% winner makes you £100.
Aggressive: 5 × £3,000 = £15K deployed, £5K cash. A 10% winner makes you £300.
Same edge, 3x the absolute return. The risk is also higher — a -10% loser costs £300 instead of £100. That's the trade-off. But the current system already has stop losses (which Phase 2 makes ATR-adaptive), daily/weekly circuit breakers, and a Guardian enforcing exits. The downside is capped by design. The upside is being left on the table by choice.
Do this after proving edge on paper, not before. Concentration amplifies whatever you have — including losses if the strategy is bad.
4. Event-Driven Trading
The system has no earnings calendar. This is leaving the highest-signal, most predictable source of big moves completely untapped.
Earnings reactions on US stocks routinely produce 5-20% moves in a single session. Post-earnings drift (the tendency for the move to continue for days) is one of the most well-documented anomalies. The system should:
Know when earnings are — Yahoo Finance provides earningsDate in the quote data. You're already calling quoteSummary — just extract it.
Position before earnings when research supports it — if fundamentals are strong and the stock is in an uptrend, holding through earnings is a high-expected-value play
Trade the reaction — gap-up on earnings + volume confirmation = momentum entry. The 10-minute tick during US hours (14:30-21:00) catches these within minutes.
Avoid the trap — gap-down on earnings = stay away. Don't bottom-fish.
This is a concrete, measurable edge source. One good earnings trade per week at 8% on a £3K position = £240/week = £12,480/year. That alone would be 62% annual return on £20K.
5. Kill the Sector Rotation Screen
Monday tech, Tuesday healthcare, Wednesday small-caps, Thursday financials, Friday consumer. This is arbitrary diversification dressed up as a strategy. It guarantees you'll spend 4 days per week screening sectors that might have zero momentum.
Replace with: screen the entire market for momentum every day. Sort by 30-day return × volume ratio. Whatever sector is moving, that's where you should be. If tech is ripping for 3 weeks straight, you should be screening tech every day, not one day a week.
The system already tracks sectors for concentration limits (30% max). That's the guard rail. Let the screening follow the money.
6. Faster Ticks During High-Vol
The 10-minute fixed tick is a compromise between cost and responsiveness. But not all ticks are equal. A 10-minute tick during lunch (low vol, nothing happening) is wasted. A 10-minute tick during a 5% market move is too slow.
Adaptive tick frequency:
Normal: 10 minutes (current)
High vol: 5 minutes — triggered when Guardian detects a >3% move in any held position or top watchlist name
Opening/closing: 5 minutes for first and last 30 minutes of each session (where most alpha lives)
Dead zone: 15 minutes during lunch (11:30-13:30 LSE, first 30 min of US overlap)
Cost impact is minimal: a few extra Haiku scans at $0.001 each. But catching an entry 5 minutes earlier on a fast-moving stock can mean the difference between a 2% and a 5% gain.
7. Use Sonnet for Research, Not Haiku
The verdict doc's own cost philosophy says "optimise for quality, not cheapness." But research analysis is running on Haiku. Research is where edge is generated. A Sonnet analysis that catches a nuance Haiku misses — deteriorating margins masked by one-off revenue, insider buying ahead of a catalyst, a competitor about to eat market share — that's worth orders of magnitude more than the $0.30 cost difference.
Research runs on 10 symbols/day. Upgrading from Haiku to Sonnet: 10 × ($0.35 - $0.005) = ~$3.45/day extra. If it produces one additional good trade per week, that trade pays for a month of research costs.
8. Trailing Stops, Not Fixed Targets
The current system targets 5-10% fixed gains and exits. This cuts winners short. The biggest profits in momentum trading come from letting winners run.
Replace fixed targets with trailing stops:
Initial stop: 2× ATR below entry (Phase 2)
As price rises: Trail the stop at 2× ATR below the highest close since entry
Never move the stop down — only up
No fixed target — let the trend decide when you're done
A stock that you'd exit at +8% with a fixed target might run to +25% with a trailing stop. You'll give back some at the end (the stop triggers after a pullback), but you capture the bulk of the move.
The Guardian already runs every 60 seconds checking stop levels. Making it trail stops based on the highest close is a small code change with a large return impact.
9. Go Live Faster
Every week on paper is a week of tax-free ISA compounding you're not getting. The paper account is £1M — nothing learned on paper at that scale transfers cleanly to £20K anyway. Position sizing, liquidity, fills, and emotional weight are all completely different.
Proposed timeline:
Phase 1 observation: Done (Feb 20-27)
Phase 1.5 (US stocks): Build and deploy immediately after observation
Phase 2 (indicators + momentum prompt): 2-3 sessions, deploy
Go live with £5K: Not the full £20K. Allocate £5K to live, keep paper running in parallel. 3 positions max at £1.5K each. Prove the system makes money with real fills and real slippage.
Scale to full ISA: After 4-6 profitable weeks on £5K, move to £20K
The risk of going live early at £5K is... £5K. The risk of sitting on paper for 6 months "perfecting" the system is 6 months of compounding you'll never get back.
10. Multi-Year Compounding View
The ISA is the actual edge, not the AI. Tax-free compounding over 10+ years is enormously powerful. The AI's job is to beat the index. Even a modest 5% annual alpha over the FTSE (12-13% total vs 7-8%) compounds dramatically:
Year	Passive Index (7%)	Agent (13%)	Difference
1	£21,400	£22,600	£1,200
3	£68,500	£78,200	£9,700
5	£123,000	£148,000	£25,000
10	£295,000	£430,000	£135,000
(Assumes £20K contribution/year, compounded returns, no withdrawals)
The £135K difference at year 10 is entirely tax-free. That's the real prize. The AI doesn't need to produce hedge fund returns — it needs to consistently beat the index by a few percent, inside a tax-free wrapper, for a decade.
Summary: The Maximum-Profit Stack
Priority	Change	Expected Impact
1	US stocks (kill stamp duty)	+5-7% annual
2	Momentum-first strategy	+3-5% vs balanced approach
3	Concentrate (5 positions, 15% max)	2-3x absolute returns
4	Earnings calendar + event trading	+5-10% from event alpha
5	Kill sector rotation, screen for momentum daily	Better opportunity sourcing
6	Trailing stops instead of fixed targets	+2-4% from letting winners run
7	Sonnet for research	Better signal quality
8	Reduce cash reserve to 10%	+10% more capital deployed
9	Go live at £5K after Phase 2	Start compounding sooner
10	Adaptive tick frequency	Faster entries on big moves
If all of this works as designed, 20-30% annual returns on a £20K ISA is structurally realistic. Not guaranteed — markets can be hostile, the AI can be wrong, momentum can reverse. But the current architecture is leaving that potential on the table by design.