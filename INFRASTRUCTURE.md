# Execution Substrate — latency, reliability, and what runs where

The strategy docs assume orders happen when engines decide. This doc is
about the layer underneath: **how fast we can actually sense and act, which
data we can trust, and the architecture that closes the gap.** Strategy
without substrate is a plan without legs — several known issues below are
correctness bugs, not just latency annoyances.

## Current substrate, honestly assessed

| Layer | What we have | Real-world consequence |
|---|---|---|
| Trigger | Page-visit piggyback (2-min global throttle) + 1×/day Vercel cron | Nothing runs unless someone opens the app. Overnight = dead. Stops can fire ~24h late. |
| Market data | REST polling: gamma (cached, lags the book), data-api (leaderboard is a frozen snapshot; window params ignored) | Paper fills at prices the real book might not offer ("stale book"); trader discovery limited to top-N. |
| Trade feeds | `getWalletTrades` last-40 lazy poll per follow | **Correctness bug: hyperactive traders (5-min crypto scalpers) exceed 40 trades between syncs — copied trades are silently missed.** |
| Order books | Not consumed at all (gamma mid-prices only) | No spread/depth awareness; market-making impossible; slippage invisible. |
| Live execution | Serverless FAK orders; ~1s cold start + API-key derivation | Fine for manual buys; too slow/jittery for quoting or fast protective exits. |
| Streaming | None — serverless cannot hold WebSockets | We see snapshots, never the movie. Polymarket's CLOB WS (books, trades, user fills) is unusable from Vercel. |

**Fundamental vs fixable:** serverless will never do sub-second reaction or
persistent sockets — that's final, and why RESEARCH.md bans speed
strategies. Everything else in the table is fixable with one cheap
addition.

## Target architecture: two tiers + one principle

```
┌─ Vercel app (unchanged role) ────────────────────────────────┐
│ UI · Postgres ledger · strategy engines · executor · audit   │
│ Slow loop: page-visit syncs + daily cron (unchanged)          │
└──────────────▲───────────────────────────────▲───────────────┘
               │ POSTs w/ bypass secret        │ reads
┌──────────────┴───────────────────────────────┴───────────────┐
│ WORKER ("the pulse") — tiny always-on Node process            │
│ $5/mo Fly.io / Railway container, or any spare machine        │
│ - subscribes: CLOB WS books for held/quoted tokens,           │
│   trade streams for followed wallets                          │
│ - maintains: fresh price cache w/ staleness stamps            │
│ - triggers: existing sync endpoints when something moves      │
│   (stop breach candidate, followed-wallet trade, drift)       │
│ - NO strategy logic, NO keys, NO ledger writes of its own     │
└──────────────────────────────────────────────────────────────┘
```

**The principle: the worker is a nervous system, not a brain.** All
decisions, money math, and state stay in the app where they already live
(invariants intact). The worker senses and pokes. This keeps it ~200
lines, stateless-restartable, and safe: if it dies, the app degrades
gracefully back to today's behavior instead of breaking.

Interim step (zero new infra): the GitHub Actions cron (ticket #6) is a
poor-man's worker at 10–15-min granularity. Ship it first; it makes the
floor "every 15 min" instead of "daily". The worker then lowers the floor
to seconds-to-minutes.

## Data-trust rules (apply everywhere, worker or not)

1. **Staleness stamps on every cached quote** — engines refuse to act on
   data older than a per-use threshold (stop checks: minutes; fills:
   seconds in live mode).
2. **Reconcile, never trust our own mirror**: positions/balances for live
   mode re-derive from data-api/chain each check (already the live plan's
   rule; extend to worker caches).
3. **Paged reads, never fixed windows**: any "last N" API read must page
   until it crosses the last-synced watermark. The 40-trade copy-sync
   window is the standing violation — fix by paginating `getWalletTrades`
   to `last_synced_ts` (the backtester already does this correctly).
4. **Every external API is assumed flaky**: timeouts, retry-with-backoff,
   and a failure mode that skips a cycle rather than half-applies one.
   (The transaction discipline in the engines already gives us the
   half-apply protection; keep it.)

## What this unlocks, mapped to the backlog

| Substrate piece | Unblocks |
|---|---|
| Paginated trade feeds (bug fix — do soon regardless) | Correct copying of active traders; trustworthy copy-cohort forward test (ROADMAP #6) |
| GitHub Actions cron (#1) | Stops/bot/copies run 24/7 at 15-min floor |
| Worker + WS books | Market-making module (#10) — quoting needs minute-scale inventory management; stale-book detection for the scanner (#11); honest slippage estimates for live copy (#15) |
| Worker + wallet trade streams | Seconds-scale copy mirroring — shrinks live-copy slippage from "minutes of drift" to "seconds" |
| Fresh-price cache | Trailing stops that trail the actual peak, not the daily/visit-sampled one |

## Sequencing amendment

- **Now (bug fix, no infra):** paginate copy-sync trade reads to the
  watermark. Small, correctness, do before the copy-cohort test.
- **Ticket #6** (GitHub Actions): unchanged, ship on user's secret.
- **Worker tier:** build when the first substrate-dependent strategy is
  ready to matter — i.e., alongside market-making (#10) or live copy
  (#15), not before. Until then it would be plumbing without a consumer.

---

# Competitive gap analysis — what catching up actually costs

What the bots that beat us actually run, where exactly we fall short, and
the specific hardware/software that closes each gap — priced, and mapped
to the backlog item that consumes it. Organized as spending tiers so the
upgrade path is a sequence of small decisions, not one big one.

## Gap inventory: us vs. the competition

| Capability | Competition runs | We run | Gap | Closes at |
|---|---|---|---|---|
| Reaction time | Sub-100ms co-located loops (pure arb) to ~1–5s (serious copy/MM bots) | Minutes (visit-driven) to 24h (cron floor) | 3–5 orders of magnitude | Tier 1 gets seconds; sub-100ms is Tier 3 (declined) |
| Market data | CLOB WebSockets: live books, trade ticks, own-fill stream | Gamma REST mid-prices (cached, lags the book); no books at all | Blind to spread, depth, book staleness | Tier 0 (REST books) → Tier 1 (WSS) |
| Followed-wallet detection | Polygon on-chain event streams (`OrderFilled` on the CTF exchange) → ~2s from fill to signal | Data-API polling, last-40 window, minutes-to-hours late, drops trades | Copy latency + correctness | #0 fix (correctness) → Tier 2 (on-chain stream) |
| Wallet analytics | Own indexed trade DB (Dune/Goldsky/self-indexed) → any wallet, any window, any metric | Polymarket's frozen top-N leaderboard snapshot | Can't rank, screen, or window beyond what the API deigns to give | Tier 2 (own ingestion) |
| Order management | Persistent authed CLOB client: GTC quotes, cancel/replace, fill stream reconciliation, slippage pre-checks | Cold-start FAK taker orders, no book pre-check, no neg-risk options | Market-making impossible; live exits slow and blind | Tier 1 + backlog #8/#10 |
| LLM firepower | Ensembles/swarms (50-persona PolySwarm-style), agreement filtering | One Groq call per desk run, free tier | Calibration gap the SOTA says matters most | Tier 0–2 (API spend, not hardware) |
| News/event awareness | Streaming news APIs, social firehoses, event calendars | None | Whole category (mostly banned as speed-play anyway) | Partial at Tier 2 (calendar); firehose = Tier 3 (declined) |
| Ops/reliability | Uptime monitoring, alerting, dead-man switches | Nothing — silent failure is invisible until someone notices | We wouldn't know the worker died | Tier 1 (free tools) |

## Tier 0 — $0, software only (do regardless)

1. **Pagination-to-watermark** everywhere (#0 bug and any future "last N"
   read).
2. **CLOB REST order books** (`/book` per token) into paper fills and the
   scanner: real spread/depth awareness, honest slippage estimates,
   stale-book detection. No sockets needed at poll cadence.
3. **Request discipline:** in-process caching with staleness stamps,
   request coalescing, batched market fetches — makes undocumented rate
   limits a non-issue at our scale.
4. **GitHub Actions cron** (ticket #6): 10–15-min heartbeat floor, free.
5. **Groq paid tier as needed** (~$1–5/mo at our volume): unlocks small
   desk ensembles (5–10 runs/market on candidates only) — the cheapest
   version of the SOTA agreement filter (RESEARCH §2).

**Gets us:** correctness, book-awareness, 15-min floor, mini-ensembles.
**Doesn't get us:** anything real-time.

## Tier 1 — ~$5–15/month: the always-on worker (the big unlock)

One small VPS/container (Fly.io, Railway, or Hetzner; **US-East region**
minimizes RTT to Polymarket's infrastructure — but see compliance note
below) running a single Node process:

- **CLOB WebSocket subscriptions**: market channel (books/ticks) for held
  + quoted + watched tokens; user channel for our own live fills →
  order-state reconciliation for free.
- **Warm CLOB client**: persistent API creds and HTTP keep-alive — kills
  the ~1s cold-start signing tax; order round-trips drop to ~100–300ms.
- **GTC quoting support** (with cancel/replace) — the mechanical
  prerequisite for market-making (#10).
- **Trigger duty**: pokes the app's existing sync endpoints (bypass
  secret) on stop-breach candidates, followed-wallet activity, book
  drift. App stays the brain (INFRASTRUCTURE principle above).
- **Ops**: free UptimeRobot ping + a Telegram/ntfy alert channel + a
  dead-man switch (worker heartbeats a URL; silence = alert). Failure
  degrades to today's behavior.

**Gets us:** seconds-scale sensing and reaction, market-making
feasibility, live stops that trail real peaks, alerting.
**Doesn't get us:** on-chain-speed copy detection or wallet analytics.

## Tier 2 — ~$50–100/month: data independence

1. **Managed Polygon WebSocket** (Alchemy/QuickNode, free tier → ~$49/mo
   at volume): subscribe to `OrderFilled` events on the CTF exchange
   contracts, decode fills in real time → followed-wallet copy latency
   drops from minutes to **~2s (block time)** — parity with serious copy
   bots. (Running our own Polygon node — 32GB RAM, multi-TB NVMe — is
   strictly dominated by managed access at our scale.)
2. **Own wallet-analytics ingestion**: continuously ingest fills into our
   Postgres (or a cheap ClickHouse/DuckDB sidecar) → our own leaderboard
   with arbitrary windows/metrics, wallet screening beyond top-N,
   persistence analysis for the copy-cohort test with *full* trade
   histories. This is the moat piece: everyone else queries the same
   crippled API; we'd own the data.
3. **Shared cache** (worker-local is fine; Redis only if the app must
   read it): one place for fresh books/prices with staleness stamps.
4. **LLM ensemble budget** (~$10–30/mo across Groq/OpenRouter): full
   PolySwarm-style diverse-persona swarms on candidate markets, using
   *different model families* for genuine diversity in the agreement
   filter.
5. **Event calendar feed** (free–cheap: FOMC/CPI/sports schedules) for
   scheduled-event windows (RESEARCH §5) — pre-position analysis, trigger
   syncs at known news times.

**Gets us:** near-SOTA copy latency, data no competitor at our scale has,
real swarms.
**Doesn't get us:** the sub-second tier — by design.

## Tier 3 — declined on purpose (write it down so nobody relitigates)

Co-located bare metal, kernel-tuned networking, Rust/Go order engines,
social-media firehoses ($100+/mo for X alone), own archive nodes. This
tier exists to win races RESEARCH §1 shows are won by whoever spends the
most on being 50ms faster — a negative-sum game against specialists, on
strategies we've already banned. Our competitive position is the *lab*
(falsification machinery + own analytics), not the racetrack.

## Compliance note (not optional)

Worker hosting region and live-order routing interact with Polymarket's
geo-restrictions and your jurisdiction. Choose hosting consistent with
where the operator may lawfully trade; if the CLOB rejects orders on
geo grounds, that is an eligibility signal to resolve with Polymarket,
never an engineering problem to route around. (Same stance as
LIVE_TRADING.md.)

## Cost curve summary

| Tier | $/month | Reaction time | Unlocked backlog items |
|---|---|---|---|
| 0 | 0 (+$1–5 LLM) | 15 min floor | #0, #1, better #2/#11, mini-ensembles for #4 |
| 1 | 5–15 | seconds | #8 (live stops), #10 (market-making), ops/alerting |
| 2 | 50–100 | ~2s copy detection | #6 (real cohort data), #15 (live copy at low slippage), full #4 swarms, own analytics |
| 3 | 500+ | sub-100ms | nothing we play |
