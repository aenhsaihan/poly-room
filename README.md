# 📈 Poly Trader

**A personal quant desk for prediction markets** — paper-trade Polymarket
with $100k play-money books, copy real on-chain traders with proportional
sleeves and trailing stops, backtest before you commit, get multi-agent AI
analysis on any market, and watch an autonomous AI trader compete on the
leaderboard with its own book. Behind an operator gate, execute real
trades through a dedicated bot wallet.

Built around one strategy lifecycle:

```
DISCOVER edges → VALIDATE them → REHEARSE with $0 risk → DEPLOY real capital → PROTECT the downside
(agent desk,     (backtests,      (paper trading,         (live mode,          (trailing stops,
 scanners)        forward lab)     copy sleeves)           bot wallet)          sleeves, caps)
```

## What's inside

**🎯 Markets & paper trading** — browse/search/filter live Polymarket
markets (category tags, honest sort orders), bet play money at real
prices, optional trailing stop at trade time.

**⧉ Copy trading with sleeves** — follow any Polymarket wallet (search
finds anyone, not just the leaderboard top). Allocate a dollar *sleeve*
per trader: when they bet 10% of their portfolio, you bet 10% of your
sleeve — their conviction transfers, and sleeves cap exposure so copying
five traders can't overextend you. Sleeve budgets are enforced and
visible.

**🛑 Trailing stops, two levels** — per-position stops (sell when price
falls X% off its peak) and per-*trader* stops (stop copying and liquidate
the copied slice when your P&L on them falls X% of deployed capital off
its peak — measured against the trades ledger, so it can't drift).

**⏪ Copy backtesting** — "if I'd copied this whale with a $10k sleeve
and 15% trail for 90 days?" Replays their real trade history through the
exact production sleeve/stop math, with a no-stop counterfactual curve
and honest approximation notes.

**🤖 Agent desk + ClaudeBot** — a multi-agent analyst pipeline (analysts →
bull/bear debate → research rating → trader → risk team → final call) runs
on any market, including pasted Polymarket URLs. ClaudeBot trades the
desk's convictions autonomously on its own $100k book — event-overlap
guard, 5–90¢ price band, self-set trailing stops, per-run decision log at
`/api/ai-trader` — and is copyable like any trader.

**⚡ Live mode (operator-gated)** — real CLOB orders through a dedicated
bot wallet with hard per-order caps and an audit log; live portfolio view
for any wallet address. Phase 1 (manual buys) shipped; see the roadmap
for the deliberately cautious path to automated live trading.

**🎫 Community loop** — tickets with AI triage, user-proposed strategies
with AI review, leaderboard, per-market comments and real-money flow
tape.

## Documentation

**[ROADMAP.md](ROADMAP.md) is the master entry point** — current state,
doc map, and the single authoritative backlog. The deep docs it indexes:

| Doc | Question it answers |
|---|---|
| [VISION.md](VISION.md) | Full designs for each feature + codebase invariants |
| [PROFITABILITY.md](PROFITABILITY.md) | Where can real trading profit come from? (Honest edge taxonomy) |
| [RESEARCH.md](RESEARCH.md) | 2026 state of the art in AI × prediction markets, sourced |
| [INFRASTRUCTURE.md](INFRASTRUCTURE.md) | Latency/reliability limits and the two-tier substrate plan |
| [LIVE_TRADING_PLAN.md](LIVE_TRADING_PLAN.md) | Phased path to safe real-money execution |
| [LIVE_TRADING.md](LIVE_TRADING.md) | Operator manual: wallet setup, env vars, safety rails |

## Stack & architecture

Next.js (App Router) + Tailwind on Vercel · Vercel Postgres as the
ledger · Polymarket **Gamma** (markets/events), **Data API**
(trades/positions/leaderboard), and **CLOB** (order books, live orders,
price history) · Groq for LLM narration/review (optional — features
degrade gracefully without it).

Key engine files: `lib/copysync.ts` (copy mirroring + sleeve sizing),
`lib/traderstops.ts` (attribution + trader trailing stops),
`lib/traderbacktest.ts` (replay engine), `lib/aitrader.ts` (ClaudeBot),
`lib/agents.ts` (analyst pipeline), `lib/clob.ts` (live execution),
`lib/db.ts` (schema — additive migrations only).

Design principles that keep the money math honest (full list in
[VISION.md](VISION.md)): every trade carries attribution
(`copied_from`); running balances are *derived* from the trades ledger,
never stored; stops trail P&L, not equity; engines piggyback a throttled
lazy-sync heartbeat.

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
```

Environment (all optional except the database):

| Var | For |
|---|---|
| `POSTGRES_URL` (+ Vercel Postgres vars) | the ledger — required |
| `GROQ_API_KEY` | AI narration, ticket/strategy review |
| `POLY_BOT_PRIVATE_KEY`, `LIVE_OPERATOR_USERNAME`, `POLYGON_RPC_URL` | live trading (see [LIVE_TRADING.md](LIVE_TRADING.md)) |

## Honesty notes

Paper fills execute at quoted mid-prices — real books have spread, depth,
and slippage. Prediction markets are near-zero-sum; on-chain analysis
shows only ~0.5% of Polymarket wallets have netted over $1k
([RESEARCH.md](RESEARCH.md)). This project treats every strategy as a
hypothesis to falsify cheaply on paper before real money believes it —
that discipline *is* the product. Live mode moves real funds: cap the
bot wallet at what you can lose, and mind your jurisdiction's rules.
