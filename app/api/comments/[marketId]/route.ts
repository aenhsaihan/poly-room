import { NextRequest, NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ marketId: string }> }) {
  const { marketId } = await params;
  await ensureSchema();
  const { rows } = await sql`
    SELECT id, username, body, created_at
    FROM comments
    WHERE market_id = ${marketId}
    ORDER BY created_at ASC
  `;
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ marketId: string }> }) {
  const { marketId } = await params;
  const { username, body } = await req.json() as { username: string; body: string };
  if (!username?.trim() || !body?.trim())
    return NextResponse.json({ error: 'username and body required' }, { status: 400 });
  if (body.trim().length > 1000)
    return NextResponse.json({ error: 'Max 1000 characters' }, { status: 400 });

  await ensureSchema();
  const { rows } = await sql`
    INSERT INTO comments (market_id, username, body)
    VALUES (${marketId}, ${username.trim()}, ${body.trim()})
    RETURNING id, username, body, created_at
  `;
  return NextResponse.json(rows[0]);
}
