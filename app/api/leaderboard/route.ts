import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';
import { syncAllFollows } from '@/lib/copysync';

export const maxDuration = 30;

export async function GET() {
  await ensureSchema();
  // mirror everyone's copy-trades first (throttled to once per 5 min globally)
  // so rankings include copied positions of users who haven't opened the app
  await syncAllFollows().catch(() => null);
  const { rows } = await sql`
    SELECT u.username,
           u.balance,
           COALESCE(SUM(p.shares * p.avg_price), 0) AS position_value
    FROM users u
    LEFT JOIN positions p ON p.user_id = u.id AND p.shares > 0.0001
    GROUP BY u.id, u.username, u.balance
    ORDER BY (u.balance + COALESCE(SUM(p.shares * p.avg_price), 0)) DESC
    LIMIT 50
  `;
  return NextResponse.json(rows.map(r => ({
    ...r,
    balance: Number(r.balance),
    position_value: Number(r.position_value),
  })));
}
