import { NextResponse } from 'next/server';
import { sql, db, ensureSchema } from '@/lib/db';

export const maxDuration = 60;

export async function POST() {
  await ensureSchema();

  // All open positions across all users in one query
  const { rows: positions } = await sql`
    SELECT p.id, p.user_id, p.market_id, p.market_question, p.outcome,
           p.shares, p.avg_price
    FROM positions p
    WHERE p.shares > 0.0001
  `;

  if (positions.length === 0) return NextResponse.json({ settled: 0, users: 0, payout: 0 });

  // Fetch each unique market once (parallel)
  const marketIds = [...new Set(positions.map(p => p.market_id as string))];
  const marketMap = new Map<string, Record<string, unknown>>();
  await Promise.all(
    marketIds.map(async id => {
      try {
        const res = await fetch(`https://gamma-api.polymarket.com/markets/${id}`, { cache: 'no-store' });
        if (res.ok) marketMap.set(id, await res.json() as Record<string, unknown>);
      } catch {}
    })
  );

  // Settle closed positions
  let settled = 0;
  let totalPayout = 0;
  const affectedUsers = new Set<number>();

  const client = await db.connect();
  try {
    for (const pos of positions) {
      const market = marketMap.get(pos.market_id as string);
      if (!market?.closed) continue;

      let outcomes: string[] = [];
      let prices: number[] = [];
      try { outcomes = JSON.parse(market.outcomes as string); } catch {}
      try { prices = (JSON.parse(market.outcomePrices as string) as string[]).map(Number); } catch {}

      const idx = outcomes.findIndex(o => o.toLowerCase() === (pos.outcome as string).toLowerCase());
      const resolutionPrice = idx >= 0 ? (prices[idx] ?? 0) : 0;
      const shares = Number(pos.shares);
      const payout = shares * resolutionPrice;

      await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [payout, pos.user_id]);
      await client.query('DELETE FROM positions WHERE id = $1', [pos.id]);
      await client.query(
        `INSERT INTO trades (user_id, market_id, market_question, outcome, shares, price, side, amount)
         VALUES ($1, $2, $3, $4, $5, $6, 'SELL', $7)`,
        [pos.user_id, pos.market_id, pos.market_question, pos.outcome, shares, resolutionPrice, payout]
      );

      settled++;
      totalPayout += payout;
      affectedUsers.add(Number(pos.user_id));
    }
  } finally {
    client.release();
  }

  return NextResponse.json({ settled, users: affectedUsers.size, payout: totalPayout });
}
