import { NextRequest, NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

function coerceUser(u: Record<string, unknown>) {
  return { ...u, balance: Number(u.balance) };
}

export async function POST(req: NextRequest) {
  const { username } = await req.json() as { username: string };
  if (!username?.trim()) return NextResponse.json({ error: 'Username required' }, { status: 400 });
  const name = username.trim();
  await ensureSchema();
  await sql`INSERT INTO users (username) VALUES (${name}) ON CONFLICT (username) DO NOTHING`;
  const { rows } = await sql`SELECT * FROM users WHERE LOWER(username) = LOWER(${name})`;
  return NextResponse.json(coerceUser(rows[0]));
}

export async function GET(req: NextRequest) {
  const username = req.nextUrl.searchParams.get('username');
  if (!username) return NextResponse.json({ error: 'username required' }, { status: 400 });
  await ensureSchema();
  const { rows } = await sql`SELECT * FROM users WHERE LOWER(username) = LOWER(${username})`;
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(coerceUser(rows[0]));
}
