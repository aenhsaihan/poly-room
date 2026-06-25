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

  // Closed positions: grouped by market+outcome where a SELL trade exists
  const { rows: closed } = await sql`
    SELECT
      market_id,
      market_question,
      outcome,
      SUM(CASE WHEN side = 'BUY'  THEN amount ELSE 0 END) AS cost,
      SUM(CASE WHEN side = 'SELL' THEN amount ELSE 0 END) AS proceeds,
      MAX(CASE WHEN side = 'SELL' THEN created_at END)    AS closed_at,
      MAX(copied_from)                                     AS copied_from
    FROM trades
    WHERE user_id = ${user.id}
    GROUP BY market_id, market_question, outcome
    HAVING COUNT(CASE WHEN side = 'SELL' THEN 1 END) > 0
    ORDER BY MAX(CASE WHEN side = 'SELL' THEN created_at END) DESC
    LIMIT 50
  `;

  return NextResponse.json({
    user: { ...user, balance: Number(user.balance) },
    positions: positions.map(p => ({ ...p, shares: Number(p.shares), avg_price: Number(p.avg_price) })),
    closed: closed.map(c => ({
      market_id: c.market_id as string,
      market_question: c.market_question as string,
      outcome: c.outcome as string,
      cost: Number(c.cost),
      proceeds: Number(c.proceeds),
      pnl: Number(c.proceeds) - Number(c.cost),
      closed_at: c.closed_at as string,
      copied_from: (c.copied_from as string) || null,
    })),
  });
}
