# State of the Art: AI × Prediction Markets (researched 2026-07-20)

What people are actually doing to make money with AI on Polymarket and
prediction markets, what the academic literature says, and — the part that
matters — **what each finding implies for this app's architecture.**
Companion to `PROFITABILITY.md` (edge taxonomy) and `ROADMAP.md` (order of
work).

## Finding 1 — The base rate is brutal; speed strategies are closed to us

On-chain analysis of 95M Polymarket transactions (Apr 2024–Dec 2025):
**only 0.51% of wallets earned >$1,000 profit.** Cross-side arbitrage —
the classic bot strategy — is dead for anyone slow: average opportunity
duration collapsed from 12.3s (2024) to **2.7s (2026)**, with 73% of arb
profits captured by sub-100ms bots. The famous "$313 → $414k in a month"
bot traded 15-minute crypto up/down markets by racing Binance spot
momentum — a pure latency game.

**Implication (decision, not aspiration):** this app runs on Vercel
serverless with a 2-minute sync throttle. We will *never* win a speed
war, so pure arb, latency/momentum racing, and sub-second news reaction
are **permanently out of scope**. Anything in our scanner that surfaces
fast-decaying arbs is a dashboard curiosity, not a strategy. Our edges
must be ones that persist for minutes-to-days.

## Finding 2 — LLM profit comes from *losing less*, not knowing more

"Beyond Accuracy: Can LLM Forecasters Profit on Prediction Markets?"
(June 2026) is the most important result for us: the best LLM forecaster
was only *as accurate as the market* — yet earned significantly higher
returns, because its edge came **entirely from losing less when wrong**,
i.e. exploiting human behavioral biases (longshot bias and friends)
rather than out-predicting anyone. Their biggest further improvement:
build a *diverse crowd* of LLM agents and use **within-crowd agreement as
a confidence filter** — only trade when the crowd concurs.

The PolySwarm framework (arXiv 2604.03888) industrializes the same idea:
50 diverse LLM personas, aggregated by **confidence-weighted Bayesian
combination with the market-implied probability as prior**,
**quarter-Kelly** position sizing, KL/JS divergence to detect
negation-pair and correlated-market mispricings. Swarm aggregation
consistently beat single-model calibration.

ForecastBench trend data: LLM forecasting improves ~0.016 Brier/year and
is extrapolated to reach human-superforecaster parity around **late
2026** — the informational tailwind is real and rising.

**Implication — ClaudeBot v2 (the biggest architecture upgrade this
research demands):** the current bot trades a *single* desk run against
no market prior. State of the art says:
1. **Ensemble, don't single-shot:** run the desk pipeline N times with
   varied analyst personas/temperatures (Groq is cheap); trade only on
   high within-crowd agreement.
2. **Market price as Bayesian prior:** blend the crowd probability with
   the market's implied probability (shrink toward the market); require
   the *posterior* divergence to exceed spread + a margin before any
   trade. This encodes "the market is usually right" structurally
   instead of hoping the desk is humble.
3. **Fractional Kelly sizing** from the blended edge, replacing the
   heuristic conviction/4 stake.
4. **Brier-score tracking:** we already store `yes_price` at run time
   and can join resolutions later — score every desk run's calibration
   on the forward ledger. Benchmarks (PolyBench, PredictionMarketBench)
   make Brier + calibration curves the standard evaluation; RandomBot
   remains the P&L null.

## Finding 3 — The most credible real-money income is *making*, not taking

Polymarket pays two overlapping yield streams to liquidity providers:
- **Liquidity rewards:** per-minute order-book snapshots score resting
  limit orders by proximity to midpoint; paid daily (min $1/day).
- **Maker rebates:** 20% (crypto) / 25% (most categories) of the taker
  fee matched against your resting order, settled daily.

Community estimates put disciplined market-making at **1–3%/month with
78–85% win rates** — modest, low-volatility, capacity-limited, and
*non-directional*: exactly the profile for a small bot wallet. This is
what "bots that actually profit in 2026" mostly do.

**Implication:** our live executor only supports FAK (taker) orders. A
**market-making module** — resting GTC limit orders straddling the
midpoint on reward-eligible markets, with inventory limits and
requote-on-drift — is a new, distinct live-phase track, and honestly the
single most probable path to real (small) profit this app has. It needs:
GTC order support + cancel/replace in `lib/clob.ts`, an inventory ledger,
midpoint tracking, and reward-eligibility detection. Added to the
backlog as its own item.

## Finding 4 — Slow structural inefficiencies still exist (our speed class)

What persists longer than 2.7 seconds:
- **Logical/correlated-market incoherence** within Polymarket (negation
  pairs, mutually-exclusive sets mispriced vs each other) — "shockingly
  common" per practitioners, and PolySwarm formalizes detection with
  KL/JS divergence. Windows: minutes to hours on long-tail markets.
- **Cross-platform spreads (Polymarket ↔ Kalshi):** documented 2–5%
  on major events; World Cup team contracts showed *sustained* 5–8¢
  gaps. But: different resolution authorities (UMA vs CFTC/Kalshi
  internal) mean the "same" market can resolve differently — this is
  basis risk, not free money; and Kalshi fees (~1.2%) eat thin spreads.

**Implication:** the scanner (VISION Design D) gets a sharper mandate:
skip fast arbs (Finding 1), focus on (a) intra-Polymarket logical
incoherence using divergence measures across related markets, and (b) a
**Kalshi comparison feed** — surface cross-platform spreads as *signal*
(a big spread means one platform is probably wrong → informs desk/bot
positioning) before ever attempting two-legged execution with its
resolution-mismatch risk.

## Finding 5 — News-reactive agents work at seconds-scale (mostly not ours)

LLM agents that watch news feeds and trade related markets within
seconds of announcements are a real, growing category. Our
infrastructure reacts in minutes at best.

**Implication:** skip generic breaking-news racing. The one structured
version open to us: **scheduled-event windows** (FOMC, jobs reports,
match results) where we know *when* news lands — the bot can pre-analyze
both branches and the heartbeat can be manually triggered post-event.
Low priority; noted for completeness.

## Revised priorities (feeds ROADMAP.md)

1. ClaudeBot v2 (ensemble + market-prior + Kelly + Brier) — directly
   SOTA-backed, cheap to build on the existing pipeline
2. Market-making module for live mode — most credible real income
3. Scanner refocus: logical incoherence + Kalshi comps as signal
4. Everything speed-dependent: explicitly never

## Sources

- [Beyond Simple Arbitrage: 4 Polymarket Strategies Bots Actually Profit From in 2026](https://medium.com/illumination/beyond-simple-arbitrage-4-polymarket-strategies-bots-actually-profit-from-in-2026-ddacc92c5b4f)
- [Arbitrage Bots Dominate Polymarket With Millions in Profits](https://finance.yahoo.com/news/arbitrage-bots-dominate-polymarket-millions-100000888.html)
- [Beyond Accuracy: Can LLM Forecasters Profit on Prediction Markets? (OpenReview)](https://openreview.net/forum?id=TSA5kRUKZv)
- [PolySwarm: A Multi-Agent LLM Framework for Prediction Market Trading and Latency Arbitrage (arXiv)](https://arxiv.org/html/2604.03888v1)
- [ForecastBench: How well can LLMs predict the future?](https://forecastingresearch.substack.com/p/ai-llm-forecasting-model-forecastbench-benchmark)
- [PolyBench: Benchmarking LLM Forecasting and Trading on Live Prediction Market Data (arXiv)](https://arxiv.org/html/2604.14199v1)
- [PredictionMarketBench: SWE-bench-Style Backtesting for Trading Agents (arXiv)](https://arxiv.org/pdf/2602.00133)
- [Polymarket Docs: Maker Rebates Program](https://docs.polymarket.com/market-makers/maker-rebates)
- [Polymarket Help: Liquidity Rewards](https://help.polymarket.com/en/articles/13364466-liquidity-rewards)
- [Market Making on Polymarket](https://startpolymarket.com/strategies/market-making/)
- [Polymarket & Kalshi Arbitrage Guide 2026](https://laikalabs.ai/prediction-markets/polymarket-kalshi-arbitrage-guide)
- [ImMike/polymarket-arbitrage (GitHub)](https://github.com/ImMike/polymarket-arbitrage)
- [AI Agents in Prediction Markets: How Bots Beat Humans](https://newyorkcityservers.com/blog/ai-agents-prediction-market-trading)
- [How AI Agents Can Reshape Arbitrage in Prediction Markets (Cointelegraph)](https://cointelegraph.com/features/ai-agents-can-reshape-arbitrage-prediction-markets)
- [Awesome Prediction Market Tools (GitHub)](https://github.com/aarora4/Awesome-Prediction-Market-Tools)
