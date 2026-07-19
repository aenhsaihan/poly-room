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
