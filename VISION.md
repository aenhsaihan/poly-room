# Poly Trader — Full-Potential Vision & Roadmap

**Purpose of this document:** front-load the hard design work. Each section
below is specified to the point where implementation is mechanical — schemas,
formulas, algorithms, pitfalls, and sequencing are decided here so future
sessions execute rather than re-derive. Read `LIVE_TRADING_PLAN.md` for the
live-execution track; this doc covers everything else and how it all
converges.

## North star

A **personal quant desk for prediction markets**, with a complete strategy
lifecycle:

```
DISCOVER edges        → agent desk, scanners, analytics
VALIDATE them         → backtesting against real historical data
REHEARSE with $0 risk → paper trading (the current app)
DEPLOY real capital   → live mode (bot wallet, phased)
PROTECT the downside  → trailing stops, sleeves, caps, kill switch
```

Everything already built slots into this pipeline. The gaps are VALIDATE
(no backtesting), most of DEPLOY (live phases 2–4), and the deeper half of
DISCOVER (the agent desk analyzes but doesn't act or keep score).

## Maturity map

| Pillar | Today | Full potential |
|---|---|---|
| Markets/betting | browse, paper bets, stops at trade time | + risk-aware sizing hints, arb scanner flags |
| Copy trading | proportional sleeves, trader trailing stops | + backtest-before-copy, live sleeve execution |
| Stops | position + trader trails, activity-driven checks | + live stops, tighter cadence, notifications |
| Agent desk | per-market multi-agent analysis on demand | + AI trader with its own book, copyable, on the leaderboard |
| Strategies | free-text + AI review, manual activation | + compiled DSL, backtested, auto-executing, per-strategy P&L |
| Live | manual buys (phase 1) | full parity with paper engines (see LIVE_TRADING_PLAN.md) |

---

## Design A — Backtesting engine (highest leverage, build first)

**The killer question it answers:** *"If I had copied this whale with a $200
sleeve and a 15% trail for the last 90 days, what would have happened?"*
Every copy decision today is made blind; this makes the whole copy/sleeve/
stop stack evidence-based.

### Data sources (all public, no auth)
- **Trader history:** `data-api.polymarket.com/trades?user={wallet}&limit=&offset=`
  — page backwards to cover the window. (Verify max page size at build time;
  cache aggressively.)
- **Price history:** `clob.polymarket.com/prices-history?market={clobTokenId}`
  with `startTs`/`endTs`/`fidelity` (minutes) or `interval` — verify exact
  params at build time. Needed to mark positions to market between trades
  and to drive trailing-stop simulation.
- **Resolutions:** gamma market objects (`closed`, final outcome prices) for
  settlement payouts.

### Trader-replay algorithm (copy backtest)
Simulate our *exact* production semantics — reuse the constants and math,
don't approximate:

1. Fetch trader's trades in `[start, end]`, sort ascending.
2. Maintain: `sleeveCash = allocation`, `positions{token → shares}`,
   `cost`, `proceeds` (same attribution semantics as `getCopyCashflows`).
3. For each trader BUY: fraction = tradeUSD / traderPortfolioValue.
   *Historical portfolio value isn't retrievable* → document the
   approximation: use tradeUSD / (rolling sum of their open cost basis in
   the sim window), floored to `MAX_SLEEVE_FRACTION` (0.5), and label
   results "approximate sizing". Buy at their fill price, cap by sleeveCash.
4. For each trader SELL: exit our mirrored position at their fill price.
5. Between trades, step daily (fidelity permitting): mark to market via
   price history; compute copy P&L; ratchet peak; if
   `pnl ≤ peak − trail% × cost` → liquidate all sim positions at that day's
   prices, record stop-out, END (or optionally resume to measure re-entry).
6. On market resolution inside the window: settle at final price.

**Outputs:** equity curve (array of {t, pnl}), final P&L, max drawdown,
stop-out events, win rate by market, verdict line. Store in a `backtests`
table: `id, username, kind ('trader'|'strategy'), subject (wallet or
strategy_id), params JSONB, result JSONB, created_at`.

**UI:** "Backtest" button on trader profile + inside FollowModal
("test these settings against the last 90 days" — params: sleeve $, trail %,
window). Chart the equity curve (reuse PriceChart component patterns).

**Pitfalls decided in advance:**
- Rate limits: batch price-history fetches per unique token, cache in
  `meta`-style table or memory; a 90-day backtest of an active whale can
  touch 50+ tokens.
- Survivorship bias: leaderboard-sourced whales are winners by construction;
  print a disclaimer on results.
- Runtime: cap simulation at ~60s (Vercel maxDuration); if too slow, reduce
  fidelity to daily closes — fine for a trail measured in double-digit %.

### Strategy backtest
Same engine, different signal source: instead of "trader traded", the
entry/exit rules from Design B fire against historical prices. Ship trader
backtest first; strategy backtest reuses its plumbing.

---

## Design B — Strategy engine: text → DSL → execution

Today strategies are prose + an AI review. Full potential: a strategy is a
**compiled, executable, backtestable object** with its own P&L.

### The DSL (JSON, stored in `strategies.compiled JSONB`)
```json
{
  "universe":  { "categories": ["politics"], "minVolume": 100000, "minDaysToEnd": 7 },
  "entry":     { "when": "price_below", "outcome": "YES", "threshold": 0.30 },
  "exit":      { "any": [ { "when": "price_above", "threshold": 0.50 },
                          { "when": "trailing_stop", "trailPct": 15 },
                          { "when": "market_closed" } ] },
  "sizing":    { "type": "fixed_pct_balance", "pct": 5, "maxPositions": 3 },
  "cooldownHours": 24
}
```
Small closed vocabulary (5–6 `when` types, 2–3 sizing types). **The LLM
compiles prose → DSL** (Groq, JSON mode), the user confirms the rendered
human-readable version, and only the *DSL* executes — the LLM is a compiler,
never a runtime decision-maker. That keeps execution deterministic,
backtestable, and cheap.

### Execution
- `lib/strategyengine.ts`: for each enabled+active strategy, scan its
  universe (existing `getMarkets` with tag/volume filters), evaluate entry
  against current prices, respect cooldown/maxPositions, place paper trades
  attributed via a new `trades.strategy_id` column (mirror of `copied_from`
  — same attribution trick powers per-strategy P&L).
- Runs on the same throttled sync cadence as stops (piggyback the endpoint).
- Exits reuse the position trailing-stop machinery where possible
  (`stop_losses` rows created by the engine, tagged with strategy_id).
- Strategy card gains: live P&L, positions opened, backtest button, and the
  promotion path badge: `draft → backtested → paper → live(operator)`.

**Why this design:** attribution-by-column (`copied_from`, `strategy_id`) is
already the app's proven pattern for "whose money did what" — extend it, do
not invent a parallel ledger.

---

## Design C — The AI trader ("Claude's book") — cheapest big win

The agent desk already produces `agent_runs` rows with `action`, `rating`,
`conviction (1-10)`, `yes_price` per analyzed market. Nothing acts on them.

**Design:** create a house user (`claude-bot`, $1,000 like everyone). A sync
pass (piggybacked on existing cadence) converts fresh high-conviction runs
into paper trades:
- BUY when `action` says buy and `conviction ≥ 7`; size = `conviction × $10`
  (max $100/market); skip if already positioned.
- Auto-set a position trailing stop (15%) on every entry — the bot eats its
  own dog food.
- Optionally: a scheduled pass runs the agent desk on the top-N trending
  markets so the bot generates its own ideas instead of waiting for users.

**The payoff:** the AI appears on the leaderboard (measurable skill, in
public), and users can **copy it with sleeves and trailing stops** — every
piece of infrastructure for that already exists; the bot is just another
followed "trader" whose trades live in our own DB instead of on-chain. This
is the feature that makes the app feel alive, and it's ~90% wiring.

(Requires one small refactor: copy-sync currently only mirrors *on-chain*
wallets. Either give the bot's trades a synthetic feed through the same
`WalletTrade` shape, or special-case internal follows — prefer the synthetic
feed so all downstream math is untouched.)

---

## Design D — Arbitrage & market-quality scanner

Prediction-market-native analytics no generic trading app has:

1. **Neg-risk completeness:** for a multi-outcome event, `Σ best-ask(YES_i)`
   < $1 − ε means buying every YES guarantees profit; `Σ best-bid(YES_i)`
   > $1 + ε means selling the set does. Scan events from gamma, compute both
   sums, flag with the ε (spread+fee threshold, default 2¢).
2. **Binary coherence:** YES_ask + NO_ask < $1 (buy both, guaranteed $1 at
   resolution). Rare but appears in stale books.
3. **Stale-book detector:** midpoint far from last-trade price + low depth →
   "price is fiction" warning on the market page (protects paper users from
   fantasy fills, protects live users from thin books).

**Surfacing:** a Scanner page (More menu) listing current flags, and a badge
on market tiles. Paper mode can one-click "take the arb" (buy the set) —
a satisfying, safe demo of the concept. Live arb execution needs limit
orders + multi-leg atomicity: explicitly out of scope until live phase 4
matures.

**Honest caveat baked in:** real books eat naive arbs via fees, spread, and
partial fills; the scanner's ε must default conservative, and the page
should say so.

---

## Design E — Risk & analytics layer

- **Exposure clustering:** group open positions by event and category;
  warn when >X% of portfolio value sits in one event ("your 5 positions are
  all the same election").
- **Kelly hint:** where an agent-desk run exists for a market, show
  Kelly fraction `f* = (p̂ − price) / (1 − price)` using the agent's implied
  probability as p̂, scaled by a 0.25 safety factor, next to the bet input.
  Clearly labeled a hint, never auto-applied.
- **Drawdown tracking:** daily snapshot of each user's total value into a
  `value_history` table (piggyback cadence) → equity curve + max drawdown on
  the portfolio page. Also unlocks: leaderboard by *risk-adjusted* return
  instead of raw balance.

---

## Sequencing (value ÷ effort, dependencies respected)

| # | Item | Effort | Why this order |
|---|---|---|---|
| 1 | AI trader (C) | S | Massive visible win, ~pure wiring |
| 2 | Trader backtest (A) | M | Unblocks evidence-based copying; engine reused later |
| 3 | Live phase 2a+2b | M | Protective automation for real money (see live plan) |
| 4 | value_history + drawdown (E) | S | One table + chart; enables risk leaderboard |
| 5 | Strategy DSL + engine (B) | L | Depends on nothing above, but biggest scope |
| 6 | Scanner (D) | M | Independent; great demo feature |
| 7 | Strategy backtest (B+A) | S | Once A and B exist, nearly free |
| 8 | Live phases 3–4 | L | After caps/kill switch; last for a reason |

**Which items needed a frontier model:** the designs above (attribution
math, backtest semantics, DSL boundary, sleeve/trail interactions) — now
written down. What remains is disciplined implementation against this spec;
any competent model/session can execute it. If something in a design proves
wrong at build time, prefer amending this doc over silently diverging.

---

## Codebase invariants (tribal knowledge — do not violate)

1. **Attribution-by-column is load-bearing.** `trades.copied_from` powers
   sleeve cash, trader-stop P&L, and copy history. `strategy_id` should
   follow the identical pattern. Never track "whose money" in a side table
   that can drift from the trades ledger.
2. **Derive, don't store, running balances** (sleeve cash, copy P&L) — they
   are recomputed from trades each check. Stored counters drift; the ledger
   doesn't. Exception: `peak_pnl` must be stored (it's history-dependent).
3. **P&L trails, not equity trails,** for anything where capital deploys
   incrementally — deployments would poison an equity peak (see trader
   stops; the same applies to future strategy stops).
4. **Lazy sync + throttle** is the app's heartbeat pattern: page loads
   trigger syncs, `meta`-table timestamps throttle them (2-min global for
   stops, 60s/follow + 5-min global for copy). New engines should piggyback,
   not add crons (Hobby plan: one daily cron max).
5. **Schema changes** = additive `ALTER TABLE ... IF NOT EXISTS` in
   `ensureSchema()` (lib/db.ts). No migration framework; never rename or
   drop in place.
6. **No local Node toolchain** — verification is careful review + Vercel
   build. TS target is ES2017 (no BigInt literals). Production writes are
   SSO-blocked from CLI; user clicks buttons or uses browser for
   authenticated GETs.
7. **Live execution goes through the executor seam** (LIVE_TRADING_PLAN.md)
   with caps + kill switch checked on every order. Nothing auto-buys real
   money before those exist.

## File map (where things live)

- `lib/polymarket.ts` — all Gamma/Data-API access, Market type
- `lib/copysync.ts` — copy mirroring engine (pct + sleeve sizing)
- `lib/traderstops.ts` — attribution (`getCopyLegs`/`getCopyCashflows`),
  trader trailing stops, sleeve budget
- `lib/clob.ts` — live CLOB client, orders, allowances (operator-gated)
- `app/api/stop-losses/sync` — position stops + trader stops, throttled,
  cron target; the natural home for new piggybacked passes
- `app/api/follows` — follow CRUD + budget; `app/api/live/*` — live trading
- `app/copy/page.tsx`, `app/components/FollowModal.tsx` — copy UX
- `app/components/AgentDesk.tsx`, `agent_runs` table — AI analysis (input
  for Design C)
- `LIVE_TRADING.md` (setup), `LIVE_TRADING_PLAN.md` (live roadmap)
