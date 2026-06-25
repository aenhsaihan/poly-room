import { NextRequest, NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export async function GET() {
  await ensureSchema();
  const { rows } = await sql`
    SELECT id, username, type, title, body, status, ai_response, created_at, updated_at
    FROM tickets
    ORDER BY created_at DESC
    LIMIT 100
  `;
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const { username, type, title, body } = await req.json() as {
    username: string; type: string; title: string; body: string;
  };
  if (!username?.trim() || !title?.trim() || !body?.trim())
    return NextResponse.json({ error: 'username, title, and body required' }, { status: 400 });
  if (!['bug', 'feature', 'other'].includes(type))
    return NextResponse.json({ error: 'type must be bug, feature, or other' }, { status: 400 });
  if (title.length > 200)
    return NextResponse.json({ error: 'title too long' }, { status: 400 });

  await ensureSchema();
  const { rows } = await sql`
    INSERT INTO tickets (username, type, title, body)
    VALUES (${username.trim()}, ${type}, ${title.trim()}, ${body.trim()})
    RETURNING id
  `;
  return NextResponse.json({ ok: true, id: Number(rows[0].id) });
}
