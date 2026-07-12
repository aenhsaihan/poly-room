# Live Trading Setup

Live mode can execute real orders on Polymarket's CLOB, signed by a
**dedicated bot wallet**. Your main funds never touch the app — fund the bot
with only what you're willing to deploy.

Before you start: make sure trading on Polymarket is permitted for you and
your account is in good standing. Real money, real consequences.

## 1. Create the bot wallet

Generate a fresh Polygon wallet (MetaMask → new account, or any keygen).
Never reuse a wallet that holds other funds.

## 2. Fund it

Send to the bot address on **Polygon**:
- **USDC.e** (bridged USDC, `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`) — your trading capital, e.g. $50–200 to start
- **POL** — ~1 POL for gas (only needed for the one-time approvals)

## 3. Set Vercel environment variables

Project → Settings → Environment Variables (Production):

| Variable | Value |
|---|---|
| `POLY_BOT_PRIVATE_KEY` | the bot wallet's private key (`0x...`) |
| `LIVE_OPERATOR_USERNAME` | your app username — only this user can fire live trades |
| `POLYGON_RPC_URL` | optional; defaults to `https://polygon-rpc.com` |

Redeploy after saving (env changes need a new deployment).

## 4. Approve Polymarket's contracts (one-time)

Visit in your logged-in browser:

```
https://<your-app>/api/live/setup?username=<LIVE_OPERATOR_USERNAME>
```

This approves USDC + conditional tokens to Polymarket's exchange contracts
(6 transactions, idempotent — safe to re-run). Check status anytime at
`/api/live/status`.

## 5. Trade

Flip the nav toggle to **Live**, open any market, enter an amount, and use
**⚡ Buy LIVE** → confirm. Orders are marketable fill-and-kill: partial fills
land, the rest cancels.

## Safety rails

- **$100 per-order cap** (`MAX_ORDER_USD` in `app/api/live/trade/route.ts`)
- Only the operator username can execute; everyone else sees the
  "Trade on Polymarket →" link
- Two-step confirm in the UI
- Every attempt (success or error) is logged to the `live_trades` table
- Blast radius = bot wallet balance

## Notes / known limitations

- The CLOB API may restrict trading by server region. Vercel functions run
  in `iad1` (US East) by default; if orders are rejected with a geo error,
  that is a compliance signal to take seriously, not to engineer around.
- Phase 1 is **manual buys only**. Selling, automated copy execution, and
  live trailing stops are phase 2 — the same engines that run paper mode
  will call `placeMarketOrder` once we trust the pipes.
- Cold starts re-derive the CLOB API key (one extra signed request); fine
  at this scale.
