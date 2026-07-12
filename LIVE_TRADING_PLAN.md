# Live Trading Roadmap

The master plan for taking everything built in paper mode — manual bets,
proportional sleeve copy-trading, trader trailing stops, position trailing
stops — to real-money execution on Polymarket. Setup instructions for what's
already shipped live in `LIVE_TRADING.md`.

## Where we are

**Shipped (phase 1):**
- Paper/Live mode toggle; live portfolio reads real positions/trades/value
  from the Data API for any connected wallet address
- Dedicated bot-wallet custody: `POLY_BOT_PRIVATE_KEY` env var, execution
  gated to `LIVE_OPERATOR_USERNAME`, blast radius = bot wallet balance
- `lib/clob.ts`: CLOB client, marketable FAK orders, status, allowance setup
- `POST /api/live/trade`: manual buys, $100/order cap, `live_trades` audit log
- Bet modal: two-step confirm live buy flow for the operator

**Blocked on operator (one-time):** create + fund bot wallet, set env vars,
run `/api/live/setup`, place a small test buy. Nothing below matters until a
$2 test buy has actually filled.

## Guiding principles

1. **Paper is the lab, live is deployment.** Strategies are proven in paper
   mode first; live reuses the same engines, not parallel reimplementations.
2. **Automation can sell before it can buy.** Protective automation (stops)
   goes live before offensive automation (copy-buying) — a bug can only
   reduce exposure, not create it.
3. **Every live order is logged before and after** (`live_trades`), and the
   chain is the source of truth for positions — reconcile from Data API
   reads, never trust our own bookkeeping alone.
4. **Caps everywhere:** per-order cap, per-market cap, daily loss cap, kill
   switch. Bot wallet funding is the final backstop.

## Architecture: the executor seam

The paper engines (`lib/copysync.ts`, `lib/traderstops.ts`,
`/api/stop-losses/sync`) currently write DB rows directly. The live plan
introduces one seam:

```
executeOrder(intent) where intent = { tokenId | marketId+outcome, side, amount, reason }
  ├─ PaperExecutor  → existing DB transactions (balance/positions/trades)
  └─ LiveExecutor   → lib/clob.placeMarketOrder + live_trades log + reconcile
```

Engines compute *decisions* (what to buy/sell and why); executors own
*settlement*. This keeps stop logic, sleeve math, and attribution identical
across modes — the only difference is where orders land.

## Phase 2 — Live sells + live position stops (protective automation)

**2a. Manual sell from live portfolio**
- Add `asset` (CLOB token id) back to `/api/live-positions` mapping — the
  Data API already returns it
- Sell button on live position cards (operator only) → `POST /api/live/trade`
  with `side: SELL`, `tokenId` direct, shares amount, two-step confirm

**2b. Live trailing stops on real positions**
- New `live_stops` table (or `scope TEXT` column on `stop_losses`):
  token_id, trail_pct, peak_price, active, triggered_at
- Sync pass: read bot wallet positions from Data API, ratchet peaks off
  `curPrice`, on trigger → CLOB SELL via LiveExecutor
- UI: "Set stop" on live position cards, mirroring the paper UX
- **Must fix first:** neg-risk markets. `placeMarketOrder` doesn't pass
  `negRisk`/`tickSize` order options yet — orders on neg-risk markets
  (multi-outcome events) will likely be rejected. Detect via gamma
  `negRisk` field and pass through to `createMarketOrder` options.
  This may bite phase 1 manual buys too — first thing to check after
  the operator's test trades.

## Phase 3 — Live copy trading with sleeves (offensive automation)

- `live BOOLEAN` on follows (operator-only): a live follow mirrors the
  followed wallet's trades through the LiveExecutor with real USDC
- Sleeve accounting denominated in real dollars: allocation checked against
  bot wallet USDC balance (a live variant of `getSleeveBudget`)
- Trader trailing stops on live sleeves: same P&L-vs-peak math, but equity
  computed from Data API positions attributed via `live_trades` (our own
  buys), trigger → liquidate copied share via CLOB
- **Honest slippage caveat:** paper mode copies at the trader's historical
  fill price; live mode can only trade at the *current* market price when
  our sync notices the trade. Sync latency = slippage. This makes cadence
  (below) matter much more than in paper mode.

## Phase 4 — Cadence, hardening, observability

- **Cadence:** activity-driven checks + daily cron are fine for paper, weak
  for live. Options: GitHub Actions cron (~10–15 min, free — ticket already
  filed), Vercel Pro 5-min cron, or an external pinger. Decide before
  enabling phase 3; phase 2 stops can live with activity-driven cadence.
- **Kill switch:** `live_trading_enabled` flag in `meta` table, checked by
  every LiveExecutor call; toggle endpoint + a red switch in the UI
- **Risk caps:** daily loss cap (sum of realized live P&L today), max
  concurrent live positions, per-market exposure cap — all in `meta`,
  enforced in `/api/live/trade` and the executor
- **Fill reconciliation:** FAK orders can partially fill. After each order,
  poll order status / recent trades to record *actual* filled size and price
  in `live_trades`, not the requested amount
- **Live dashboard:** operator page showing bot balance, open live
  positions, live stops, recent `live_trades` with statuses, and the kill
  switch
- **Notifications:** on stop trigger / order failure, at minimum insert a
  ticket or surface a banner; later, email/webhook

## Known gotchas (check during phase 2)

- **Neg-risk order options** (see 2b — likely the first real-world failure)
- **Tick size:** markets quote at 0.01 or 0.001 — `createMarketOrder` may
  need `tickSize` from the market's CLOB metadata for exotic markets
- **Minimum order size:** CLOB enforces minimums (~$1 / 5 shares); tiny
  sleeve fractions will get rejected — floor or skip sub-minimum intents
- **Slippage guard:** we fetch best price then submit; add a max-slippage
  parameter (reject if fill price would exceed quoted by >X%)
- **USDC.e vs native USDC** — Polymarket uses bridged USDC.e
  (`0x2791...84174`); funding with native USDC (`0x3c49...3359`) won't work
- **Cold-start API key derivation** adds ~1s per cold lambda; cache is
  per-instance. Fine now, revisit if order latency matters
- **Geo/compliance:** if the CLOB rejects orders from Vercel's US-East IPs,
  treat it as an account-eligibility signal to resolve with Polymarket, not
  an engineering problem

## Open decisions for next session

- [ ] Did the $2 test buy fill? (unblocks everything)
- [ ] Neg-risk handling confirmed working?
- [ ] Cadence choice for live stops: activity-driven only, GitHub Actions,
      or Vercel Pro?
- [ ] Phase 2b stop storage: new `live_stops` table vs `scope` column?
- [ ] Default slippage tolerance (suggest 2–3%)?
- [ ] Daily loss cap amount?
- [ ] Does live copy reuse `follows` rows (a `live` flag) or separate
      operator-only live follows? (leaning: same rows, flag)

## Sequence summary

```
phase 1 (done) → operator wallet setup → $2 test buy
  → phase 2a manual sells → 2b live position stops (+ neg-risk fix)
  → phase 4 kill switch + caps (before any auto-buying!)
  → phase 3 live sleeve copy + live trader stops
  → phase 4 rest: cadence upgrade, reconciliation, dashboard
```

Note the deliberate ordering: the kill switch and risk caps land *before*
live copy-buying is enabled.
