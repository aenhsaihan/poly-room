import { NextRequest, NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export async function GET(req: NextRequest) {
  const username = req.nextUrl.searchParams.get('username');
  if (!username) return NextResponse.json({ error: 'username required' }, { status: 400 });
  await ensureSchema();
  const { rows: users } = await sql`SELECT id FROM users WHERE LOWER(username) = LOWER(${username})`;
  if (!users[0]) return NextResponse.json([]);
  const { rows } = await sql`
    SELECT id, market_id, market_question, outcome, trail_pct, peak_price, active, triggered_at, created_at
    FROM stop_losses
    WHERE user_id = ${users[0].id}
    ORDER BY created_at DESC
  `;
  return NextResponse.json(rows.map(r => ({
    ...r,
    trail_pct: Number(r.trail_pct),
    peak_price: Number(r.peak_price),
  })));
}

export async function POST(req: NextRequest) {
  const { username, marketId, marketQuestion, outcome, trailPct, currentPrice } = await req.json() as {
    username: string; marketId: string; marketQuestion: string;
    outcome: string; trailPct: number; currentPrice: number;
  };
  await ensureSchema();
  const { rows: users } = await sql`SELECT id FROM users WHERE LOWER(username) = LOWER(${username})`;
  if (!users[0]) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  await sql`
    INSERT INTO stop_losses (user_id, market_id, market_question, outcome, trail_pct, peak_price)
    VALUES (${users[0].id}, ${marketId}, ${marketQuestion}, ${outcome}, ${trailPct}, ${currentPrice})
    ON CONFLICT (user_id, market_id, outcome) DO UPDATE SET
      trail_pct = ${trailPct}, peak_price = ${currentPrice},
      active = true, triggered_at = NULL, updated_at = NOW()
  `;
  return NextResponse.json({ ok: true });
}
