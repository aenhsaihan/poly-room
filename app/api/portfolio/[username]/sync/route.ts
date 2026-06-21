import { NextRequest, NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  await ensureSchema();

  const { rows: users } = await sql`SELECT * FROM users WHERE LOWER(username) = LOWER(${username})`;
  if (!users[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const user = users[0];

  const { rows: positions } = await sql`
    SELECT * FROM positions WHERE user_id = ${user.id} AND shares > 0.0001
  `;

  let settled = 0;
  let totalPayout = 0;

  for (const pos of positions) {
    let market: Record<string, unknown>;
    try {
      const res = await fetch(`https://gamma-api.polymarket.com/markets/${pos.market_id}`, {
        cache: 'no-store',
      });
      if (!res.ok) continue;
      market = await res.json() as Record<string, unknown>;
    } catch {
      continue;
    }

    if (!market.closed) continue;

    let outcomes: string[] = [];
    let prices: number[] = [];
    try { outcomes = JSON.parse(market.outcomes as string); } catch {}
    try { prices = (JSON.parse(market.outcomePrices as string) as string[]).map(Number); } catch {}

    const idx = outcomes.findIndex(o => o.toLowerCase() === (pos.outcome as string).toLowerCase());
    const resolutionPrice = idx >= 0 ? (prices[idx] ?? 0) : 0;
    const shares = Number(pos.shares);
    const payout = shares * resolutionPrice;

    await sql`UPDATE users SET balance = balance + ${payout} WHERE id = ${user.id}`;
    await sql`DELETE FROM positions WHERE id = ${pos.id}`;
    await sql`
      INSERT INTO trades (user_id, market_id, market_question, outcome, shares, price, side, amount)
      VALUES (${user.id}, ${pos.market_id}, ${pos.market_question}, ${pos.outcome}, ${shares}, ${resolutionPrice}, 'SELL', ${payout})
    `;

    settled++;
    totalPayout += payout;
  }

  return NextResponse.json({ settled, payout: totalPayout });
}
