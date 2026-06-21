import { NextRequest, NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  await ensureSchema();
  const { rows: users } = await sql`SELECT * FROM users WHERE LOWER(username) = LOWER(${username})`;
  if (!users[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const user = users[0];

  const { rows: positions } = await sql`
    SELECT * FROM positions WHERE user_id = ${user.id} AND shares > 0.0001
    ORDER BY market_question ASC
  `;
  const { rows: trades } = await sql`
    SELECT * FROM trades WHERE user_id = ${user.id}
    ORDER BY created_at DESC LIMIT 50
  `;
  return NextResponse.json({
    user: { ...user, balance: Number(user.balance) },
    positions: positions.map(p => ({ ...p, shares: Number(p.shares), avg_price: Number(p.avg_price) })),
    trades: trades.map(t => ({ ...t, shares: Number(t.shares), price: Number(t.price), amount: Number(t.amount) })),
  });
}
