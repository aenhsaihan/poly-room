import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';
import { getMarket } from '@/lib/polymarket';

// Recent desk runs across all markets, enriched with the current price
// so the Agents page can show how each call has aged.
export async function GET() {
  await ensureSchema();
  const { rows } = await sql`
    SELECT id, market_id, market_question, username, action, rating, conviction, yes_price, created_at
    FROM agent_runs
    ORDER BY created_at DESC
    LIMIT 25
  `;

  const uniqueIds = [...new Set(rows.map(r => r.market_id as string))];
  const priceMap = new Map<string, number>();
  await Promise.all(uniqueIds.map(async id => {
    try {
      const m = await getMarket(id);
      priceMap.set(id, m.outcomePrices[0] ?? 0.5);
    } catch {}
  }));

  return NextResponse.json(rows.map(r => ({
    id: Number(r.id),
    marketId: r.market_id as string,
    marketQuestion: r.market_question as string,
    username: r.username as string,
    action: r.action as string,
    rating: r.rating as string,
    conviction: Number(r.conviction),
    yesPriceAtRun: Number(r.yes_price),
    yesPriceNow: priceMap.get(r.market_id as string) ?? null,
    createdAt: r.created_at as string,
  })));
}
