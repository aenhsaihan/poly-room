import { NextRequest, NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export async function GET(req: NextRequest) {
  const username = req.nextUrl.searchParams.get('username');
  if (!username) return NextResponse.json({ error: 'username required' }, { status: 400 });
  await ensureSchema();
  const { rows } = await sql`
    SELECT f.id, f.wallet, f.trader_name, f.copy_pct, f.created_at, f.last_synced_at,
           COUNT(t.id)::int AS copied_trades,
           COALESCE(SUM(CASE WHEN t.side = 'BUY' THEN t.amount ELSE 0 END), 0) AS copied_spent
    FROM follows f
    JOIN users u ON u.id = f.user_id
    LEFT JOIN trades t ON t.user_id = f.user_id AND t.copied_from = f.trader_name
    WHERE LOWER(u.username) = LOWER(${username})
    GROUP BY f.id
    ORDER BY f.created_at DESC
  `;
  return NextResponse.json(rows.map(r => ({
    id: Number(r.id),
    wallet: r.wallet as string,
    traderName: r.trader_name as string,
    copyPct: Number(r.copy_pct ?? 100),
    createdAt: r.created_at as string,
    lastSyncedAt: r.last_synced_at as string,
    copiedTrades: Number(r.copied_trades),
    copiedSpent: Number(r.copied_spent),
  })));
}

export async function POST(req: NextRequest) {
  const { username, wallet, traderName, copyPct } = await req.json() as {
    username: string; wallet: string; traderName: string; copyPct: number;
  };
  if (!username?.trim() || !wallet?.trim() || !traderName?.trim())
    return NextResponse.json({ error: 'username, wallet, traderName required' }, { status: 400 });
  const pct = Number(copyPct);
  if (!pct || pct < 1 || pct > 100)
    return NextResponse.json({ error: 'copyPct must be 1–100' }, { status: 400 });

  await ensureSchema();
  const { rows: users } = await sql`SELECT id FROM users WHERE LOWER(username) = LOWER(${username})`;
  if (!users[0]) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const now = Math.floor(Date.now() / 1000);
  const { rows } = await sql`
    INSERT INTO follows (user_id, wallet, trader_name, copy_amount, copy_pct, last_synced_ts)
    VALUES (${users[0].id as number}, ${wallet.trim().toLowerCase()}, ${traderName.trim()}, 0, ${pct}, ${now})
    ON CONFLICT (user_id, wallet) DO UPDATE SET copy_pct = ${pct}, trader_name = ${traderName.trim()}
    RETURNING id
  `;
  return NextResponse.json({ ok: true, id: Number(rows[0].id) });
}

export async function DELETE(req: NextRequest) {
  const { username, wallet } = await req.json() as { username: string; wallet: string };
  if (!username?.trim() || !wallet?.trim())
    return NextResponse.json({ error: 'username and wallet required' }, { status: 400 });
  await ensureSchema();
  await sql`
    DELETE FROM follows f USING users u
    WHERE f.user_id = u.id AND LOWER(u.username) = LOWER(${username}) AND f.wallet = ${wallet.trim().toLowerCase()}
  `;
  return NextResponse.json({ ok: true });
}
