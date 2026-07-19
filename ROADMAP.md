# Poly Trader — Master Roadmap

**Start here.** This is the entry point for humans and AI sessions alike:
what the app is, which document answers which question, where things
stand, and the single authoritative order of work. Detail lives in the
linked docs — this file only orients and sequences.

## What this app is

A **personal quant desk for prediction markets** built on Polymarket data:
browse and paper-trade markets with $100k play-money books, copy real
on-chain traders with proportional "sleeves" and trailing stops, backtest
copy decisions against real history, get multi-agent AI analysis per
market (which also trades its own book as **ClaudeBot**), and — behind an
operator gate — execute real-money trades through a dedicated bot wallet.

The strategy lifecycle the whole app serves:

```
DISCOVER edges → VALIDATE them → REHEARSE with $0 risk → DEPLOY real capital → PROTECT the downside
(agent desk,     (backtests,      (paper trading,         (live mode,          (trailing stops,
 scanners)        forward lab)     copy sleeves)           bot wallet)          sleeves, caps)
```

## Document map

| Document | The question it answers |
|---|---|
| **ROADMAP.md** (this file) | Where are we, what's next, in what order? |
| [RESEARCH.md](RESEARCH.md) | What's the 2026 state of the art in AI × prediction-market trading, and what does it imply for our architecture? (Sourced) |
| [INFRASTRUCTURE.md](INFRASTRUCTURE.md) | How fast can we sense and act, which data can we trust, and what runs where? The two-tier (app + worker) substrate plan |
| [VISION.md](VISION.md) | What does each feature look like fully built? Implementation-ready designs (backtesting, strategy DSL, AI trader, scanner, risk layer) + **codebase invariants** every contributor must respect |
| [PROFITABILITY.md](PROFITABILITY.md) | Where can real trading profit come from? Edge taxonomy, the RandomBot null baseline, the paper→live promotion gate |
| [LIVE_TRADING_PLAN.md](LIVE_TRADING_PLAN.md) | How does real-money execution get built safely? Phases 2–4, executor seam, kill switch, known CLOB gotchas |
| [LIVE_TRADING.md](LIVE_TRADING.md) | Operator manual: bot wallet setup, env vars, allowances, safety rails |
| [AGENTS.md](AGENTS.md) / [CLAUDE.md](CLAUDE.md) | Rules for AI sessions working in this repo |
| [README.md](README.md) | Stock Next.js boilerplate (unmodified) |

**Reading order for a new contributor:** this file → VISION.md's
"Codebase invariants" section (non-negotiable) → whichever doc owns your
task.

## Where things stand (as of 2026-07-20)

**Shipped and live in production:**
- Markets browse/filter/sort, paper betting with optional trailing stops
- Copy trading: proportional sleeves (+ legacy %-mode), sleeve budget
  enforcement, per-trader trailing stops with full-exit + resume
- Trader search (anyone on Polymarket, not just the leaderboard top)
- Trader copy backtest (90d replay through exact production semantics)
- ClaudeBot: autonomous AI trader on a $100k book — ideates on trending
  markets, trades desk convictions both directions, event-overlap guard,
  5–90¢ price band, self-set 15% trails, per-run decision log at
  `GET /api/ai-trader` (`?force=1` to run a cycle now), copyable like any
  trader
- Live trading **phase 1**: manual real-money buys via operator-gated bot
  wallet ($100/order cap, audit log) — *code live, wallet not yet funded*
- $100k starting balances (retroactive migration, P&L-preserving)
- Tickets system with AI review; strategies page (free-text + AI review)
- Stops/bot heartbeat: page-visit-driven (2-min throttle) + daily cron

**Blocked on the operator (user):**
- Bot wallet creation/funding + env vars → unlocks live phase 2
  ([LIVE_TRADING.md](LIVE_TRADING.md) steps 1–4)
- Vercel Protection Bypass secret in GitHub → unlocks ticket #6 workflow
- Resolve clicks on shipped tickets

## The unified backlog

One list, one order — supersedes the per-doc sequencing tables where they
disagree. Rationale: measurement before strategies (you can't tell what
works without it), null baseline before belief, protective automation
before offensive, live capital only through the promotion gate.

| # | Item | Detail lives in | Size | Status |
|---|---|---|---|---|
| 0 | **Bug fix: paginate copy-sync trade reads to the watermark** (last-40 window silently drops trades of hyperactive wallets) | INFRASTRUCTURE §data-trust | S | correctness — do first |
| 1 | GitHub Actions cron for off-hours stop checks (ticket #6) | LIVE_TRADING_PLAN §Phase 4 cadence | S | open — needs user secret |
| 2 | Forward performance ledger: `value_history` + per-attribution equity curves + **Brier scores per desk run** | PROFITABILITY §A · VISION §E · RESEARCH §2 | S–M | next up |
| 3 | RandomBot null baseline | PROFITABILITY §B | S | after 2 |
| 4 | **ClaudeBot v2: ensemble desk runs + market-prior Bayesian blend + fractional-Kelly sizing** | RESEARCH §2 | M | after 2 — SOTA-backed, highest-conviction upgrade |
| 5 | Longshot-fade house strategy (first structural-bias candidate) | PROFITABILITY §1 | M | after 3 |
| 6 | Copy-cohort forward test (does leaderboard skill persist?) | PROFITABILITY §3 | M | after 2 |
| 7 | Live phase 2a: manual sells from live portfolio | LIVE_TRADING_PLAN §2a | S | blocked on wallet |
| 8 | Live phase 2b: live trailing stops (+ neg-risk order fix) | LIVE_TRADING_PLAN §2b | M | after 7 |
| 9 | Kill switch + risk caps | LIVE_TRADING_PLAN §Phase 4 | M | before any live auto-buying |
| 10 | **Market-making module: GTC limit orders + liquidity rewards/maker rebates harvesting** | RESEARCH §3 | L | most credible real income; after 9 |
| 11 | Scanner: intra-Polymarket logical incoherence + **Kalshi comparison feed** (spreads as signal, not arb) | VISION §D · RESEARCH §4 | M | independent |
| 12 | Strategy DSL + engine (prose → compiled rules → execution) | VISION §B | L | independent |
| 13 | Strategy backtests | VISION §A+B | S | after 12 |
| 14 | Promotion gate: formalized paper→live criteria | PROFITABILITY §C | M | after 2+3, before 15 |
| 15 | Live phase 3: live sleeve copy + live trader stops | LIVE_TRADING_PLAN §3 | L | last, gated by 9+14 |
| 16 | Risk layer extras: exposure clustering, risk-adjusted leaderboard | VISION §E | M | opportunistic |
| 17 | Worker tier ("the pulse"): always-on process holding CLOB websockets, fresh-price cache, endpoint triggers | INFRASTRUCTURE | M | build alongside #10 or #15 — plumbing needs a consumer |

**Permanently out of scope** (RESEARCH §1: serverless can't win speed
wars): cross-side arbitrage execution, latency/momentum racing,
sub-second news reaction. Windows are ~2.7s and 73% goes to sub-100ms
bots — our edges must persist minutes-to-days.

**Done** (for the record): agent desk + URL analysis, tickets, strategies
page, sleeves, trader stops, trader backtest, ClaudeBot, trader search,
$100k migration, live phase 1, mobile nav, category/sort fixes.

## Working agreements (compressed — full versions in the owning docs)

- **Invariants** (VISION.md, full list): attribution-by-column is
  load-bearing; derive running balances from the trades ledger, don't
  store them; trail P&L, not equity; piggyback the lazy-sync heartbeat,
  don't add crons (Hobby = 1/day max); schema changes are additive
  `IF NOT EXISTS` in `ensureSchema()`.
- **Environment** (memory + hard experience): no local Node toolchain —
  verify by review, push, and watch the Vercel build (~30–90s). Production
  is SSO-gated: CLI can't read or write app routes; the user opens API
  URLs in a logged-in browser and pastes JSON back. Diagnostic endpoints
  are GETs with readable output for exactly this reason.
- **Live money**: nothing auto-buys with real funds before the kill
  switch, caps (#8), and promotion gate (#12) exist. Protective
  automation (sells/stops) ships before offensive automation (buys).
- **Truth over theater**: strategies are believed when their *forward*
  paper record beats RandomBot — not when their backtest looks good.
