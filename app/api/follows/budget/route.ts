import { NextRequest, NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';
import { getSleeveBudget } from '@/lib/traderstops';

export async function GET(req: NextRequest) {
  const username = req.nextUrl.searchParams.get('username');
  const excludeWallet = req.nextUrl.searchParams.get('excludeWallet') ?? undefined;
  if (!username) return NextResponse.json({ error: 'username required' }, { status: 400 });
  await ensureSchema();
  const { rows: users } = await sql`SELECT id FROM users WHERE LOWER(username) = LOWER(${username})`;
  if (!users[0]) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  const budget = await getSleeveBudget(Number(users[0].id), excludeWallet);
  return NextResponse.json(budget);
}
