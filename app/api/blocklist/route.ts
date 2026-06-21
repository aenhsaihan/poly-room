import { NextRequest, NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export async function GET(req: NextRequest) {
  const username = req.nextUrl.searchParams.get('username');
  if (!username) return NextResponse.json({ error: 'username required' }, { status: 400 });
  await ensureSchema();
  const { rows } = await sql`
    SELECT b.id, b.wallet, b.trader_name, b.created_at
    FROM blocklist b
    JOIN users u ON u.id = b.user_id
    WHERE LOWER(u.username) = LOWER(${username})
    ORDER BY b.created_at DESC
  `;
  return NextResponse.json(rows.map(r => ({
    id: Number(r.id),
    wallet: r.wallet as string,
    traderName: r.trader_name as string,
    createdAt: r.created_at as string,
  })));
}

export async function POST(req: NextRequest) {
  const { username, wallet, traderName } = await req.json() as {
    username: string; wallet: string; traderName: string;
  };
  if (!username?.trim() || !wallet?.trim() || !traderName?.trim())
    return NextResponse.json({ error: 'username, wallet, traderName required' }, { status: 400 });
  await ensureSchema();
  const { rows: users } = await sql`SELECT id FROM users WHERE LOWER(username) = LOWER(${username})`;
  if (!users[0]) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  await sql`
    INSERT INTO blocklist (user_id, wallet, trader_name)
    VALUES (${users[0].id as number}, ${wallet.trim().toLowerCase()}, ${traderName.trim()})
    ON CONFLICT (user_id, wallet) DO NOTHING
  `;
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { username, wallet } = await req.json() as { username: string; wallet: string };
  if (!username?.trim() || !wallet?.trim())
    return NextResponse.json({ error: 'username and wallet required' }, { status: 400 });
  await ensureSchema();
  await sql`
    DELETE FROM blocklist b USING users u
    WHERE b.user_id = u.id AND LOWER(u.username) = LOWER(${username}) AND b.wallet = ${wallet.trim().toLowerCase()}
  `;
  return NextResponse.json({ ok: true });
}
