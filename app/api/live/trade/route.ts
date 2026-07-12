import { NextRequest, NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';
import { getMarket } from '@/lib/polymarket';
import { isLiveConfigured, isLiveOperator, placeMarketOrder } from '@/lib/clob';

export const maxDuration = 30;

// Hard per-order ceiling — a fat-fingered amount can't empty the bot wallet
const MAX_ORDER_USD = 100;

export async function POST(req: NextRequest) {
  const { username, marketId, outcome, side, amount } = await req.json() as {
    username?: string; marketId?: string; outcome?: string; side?: string; amount?: number;
  };

  if (!isLiveConfigured())
    return NextResponse.json({ error: 'Live trading not configured (POLY_BOT_PRIVATE_KEY missing)' }, { status: 503 });
  if (!username?.trim() || !isLiveOperator(username))
    return NextResponse.json({ error: 'Live trading is restricted to the configured operator' }, { status: 403 });
  if (!marketId || !outcome || (side !== 'BUY' && side !== 'SELL'))
    return NextResponse.json({ error: 'marketId, outcome, side (BUY|SELL) required' }, { status: 400 });
  const amt = Number(amount);
  if (!amt || isNaN(amt) || amt <= 0)
    return NextResponse.json({ error: 'amount must be positive' }, { status: 400 });
  if (side === 'BUY' && amt > MAX_ORDER_USD)
    return NextResponse.json({ error: `Per-order cap is $${MAX_ORDER_USD}` }, { status: 400 });

  const market = await getMarket(marketId).catch(() => null);
  if (!market) return NextResponse.json({ error: 'Market not found' }, { status: 404 });
  if (market.closed) return NextResponse.json({ error: 'Market is closed' }, { status: 400 });
  const idx = market.outcomes.findIndex(o => o.toLowerCase() === outcome.toLowerCase());
  if (idx === -1) return NextResponse.json({ error: 'Outcome not found on market' }, { status: 400 });
  const tokenId = market.clobTokenIds[idx];
  if (!tokenId) return NextResponse.json({ error: 'Market has no CLOB token id' }, { status: 400 });

  await ensureSchema();
  try {
    const result = await placeMarketOrder(tokenId, side, amt);
    await sql`
      INSERT INTO live_trades (username, market_id, market_question, outcome, token_id, side, amount, price, order_id, status, raw)
      VALUES (${username}, ${marketId}, ${market.question}, ${market.outcomes[idx]}, ${tokenId}, ${side}, ${amt},
              ${result.price}, ${result.orderId}, ${result.status}, ${JSON.stringify(result.raw ?? null)})
    `;
    return NextResponse.json({ ok: true, orderId: result.orderId, status: result.status, price: result.price });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'order failed';
    await sql`
      INSERT INTO live_trades (username, market_id, market_question, outcome, token_id, side, amount, status, raw)
      VALUES (${username}, ${marketId}, ${market.question}, ${market.outcomes[idx]}, ${tokenId}, ${side}, ${amt},
              'error', ${JSON.stringify({ error: message })})
    `.catch(() => {});
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
