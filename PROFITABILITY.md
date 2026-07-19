# Path to Profitability — an honest map

Companion to `VISION.md` (features) and `LIVE_TRADING_PLAN.md` (execution).
This doc answers a different question: **where can real trading profit
actually come from, and what must the app build to find out?**

## The uncomfortable premise

Prediction markets are near-zero-sum: every dollar won is lost by someone
else, minus spread and slippage. Liquid Polymarket prices already aggregate
sharp money — an LLM reading public price history has **no edge** in a
liquid market, and neither does a human reading the same chart. Any plan
that starts "our analysis will beat the market" is a plan to donate.

Profit therefore requires one of a small number of *structural* edge
classes, plus the discipline to verify edge statistically before deploying
capital. The app's real asset is not any single strategy — it is the
**laboratory**: paper books with clean attribution, backtests, and (to
build) forward performance tracking. Pro shops don't know in advance what
works either; they industrialize the finding-out.

## Edge taxonomy — ranked by believability

### 1. Structural biases (strongest evidence, most durable)
Documented, persistent behavioral patterns in prediction markets:
- **Favorite–longshot bias:** longshots are systematically overpriced,
  heavy favorites slightly underpriced. Decades of evidence across betting
  markets. A rule that systematically fades longshots (sell/avoid <10¢
  outcomes, prefer 60–90¢ favorites held to resolution) harvests a small,
  real premium.
- **Resolution drift:** near-certain markets often trade 1–3¢ off
  certainty for days (capital cost + inattention). Buying 95–99¢
  "already decided" markets is a T-bill-like carry trade — real but
  capacity- and capital-intensive, and the tail risk (the 1% happens) must
  be sized for. Note tension with ClaudeBot's 5–90¢ band: that band
  protects an *analysis* bot; a dedicated *carry* strategy would
  deliberately live above it. Different strategies, different guards.

**Action:** implement as DSL strategies (VISION Design B) or a second house
bot; measure against the null baseline (below).

### 2. Microstructure (real but small and fast-decaying)
Neg-risk set incompleteness, binary incoherence (YES+NO < $1), stale books
on long-tail markets. Real money, small capacity, competed by bots on
anything liquid. The scanner (VISION Design D) finds them; live capture
needs limit orders + multi-leg atomicity (late live-phase work). Honest
sizing: pocket money, not a business — but pocket money with ~no
directional risk.

### 3. Copy selection (the app's thesis — empirically testable)
Copying profitable traders works **iff skill persists**. That is an
empirical question the app can answer better than almost anyone, because
paper books cost nothing:
- Auto-copy a *cohort* (e.g. top 20 leaderboard) into house paper books
  with uniform sleeves, and measure **post-copy** performance per trader.
  Backtests suffer survivorship bias; the cohort forward-test doesn't.
- If persistence exists, the profitable product is copying the persistent
  subset live. If it doesn't (plausible! leaderboards may be luck +
  variance), the app has cheaply falsified its own thesis before losing
  money on it — that is also a win.

### 4. Informational edge in *neglected* markets (weakest, not zero)
The desk cannot beat liquid markets, but thin, niche markets (local
politics, obscure sports props) have few analysts. Any genuine research
edge lives there — exactly where liquidity is worst and paper fills are
most fictional. Treat desk-driven trading in liquid markets as *content*
(entertaining, self-documenting), not as an edge claim. ClaudeBot's real
function is generating a public, honest track record of what LLM analysis
is worth — whatever the answer turns out to be.

### What has no edge (say it plainly)
Technical analysis on liquid binaries; copying fixed dollar amounts of
whales without persistence evidence; LLM vibes on markets with real
volume; anything whose backtest was tuned until it looked good.

## The architecture that finds truth

Three build items, in priority order. Everything else in VISION supports
these.

### A. Forward performance ledger (build first — nothing works without it)
- `value_history`: daily snapshot per user (and per house bot) of balance +
  position value. Piggyback the existing throttled sync.
- Per-attribution P&L series: the trades ledger already attributes every
  trade (`copied_from`, future `strategy_id`) — roll it up daily so every
  strategy/trader/bot has an equity curve, drawdown, and resolved-trade
  win rate, *forward*, not backtested.
- Surfaces: equity curves on portfolio/strategy/copy cards; leaderboard
  by risk-adjusted return.

### B. The null baseline: RandomBot
A second house user that bets **randomly**: every heartbeat, a random
tradeable market, random side, same sizing rules and stops as ClaudeBot.
It is the control group. Any strategy that cannot beat RandomBot over a
few hundred resolved trades is noise wearing a suit — including
ClaudeBot. Cheapest possible falsification machine (~an afternoon to
build on the aitrader skeleton), and it makes every performance claim in
the app honest by comparison.

### C. The promotion gate (paper → live, formalized)
Live capital is earned, never granted. A strategy (house bot, DSL
strategy, or copied trader) may be promoted only when its **forward**
paper record clears, e.g.:
- ≥ 50 resolved trades AND ≥ 60 days live on paper
- Positive net P&L AND beats RandomBot's concurrent record
- Max drawdown < 25% of deployed capital
- Effect surviving a basic sanity check: would halving the three best
  trades still leave it positive? (fragility test)

Promotion grants a *small* live allocation via the executor seam
(LIVE_TRADING_PLAN), with the kill switch and caps already specced.
Demotion is automatic on drawdown breach. **Additional live-only test:**
copy strategies must first run a slippage trial (paper mirrors at
historical fill prices; live fills at current price — measure the gap
with tiny size before scaling anything).

## What "profitable" realistically looks like

Order-of-magnitude honesty: with a $200–$2,000 bot wallet, structural
biases + microstructure might realistically produce single-digit-percent
monthly returns in good months, with drawdowns. That's a satisfying
outcome for a self-built quant lab, not an income. The compounding asset
is the *validated knowledge* — which strategies survive contact with
forward data — and the infrastructure that produces it. If something
genuinely persistent emerges from the lab, scaling capital into it is the
easy part.

As a *business*, the honest read: the market for "prediction-market paper
trading with AI copilots" is small today. The plausible business is the
lab itself — copy-selection with persistence evidence and honest
benchmarking is a real differentiator against copy-trading products that
sell survivorship bias. But build it as a lab first; a lab that finds a
real edge funds itself.

## Sequencing

1. `value_history` + per-attribution equity curves (A) — the measurement
   substrate; small build.
2. RandomBot (B) — the null hypothesis; trivial build on aitrader.
3. Longshot-fade strategy as a DSL/house bot — first structural-bias
   candidate into the lab.
4. Copy cohort forward-test — auto-follow top-20 in house paper books;
   start the persistence clock.
5. Scanner (VISION D) — independent, small real edge.
6. Promotion gate + live phases 2–4 — once candidates have forward
   records worth promoting.

Every step produces evidence even when strategies fail. That is the point:
the app's edge is not a strategy — it is the machine that tells you,
cheaply and honestly, whether a strategy is real.
