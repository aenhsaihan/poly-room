import { NextRequest, NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export async function GET() {
  await ensureSchema();
  const { rows } = await sql`
    SELECT id, username, name, description, rules, enabled, status, ai_review, created_at, updated_at
    FROM strategies
    ORDER BY created_at DESC
    LIMIT 100
  `;
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const { username, name, description, rules } = await req.json() as {
    username: string; name: string; description: string; rules: string;
  };
  if (!username?.trim() || !name?.trim() || !description?.trim() || !rules?.trim())
    return NextResponse.json({ error: 'username, name, description, and rules are required' }, { status: 400 });
  if (name.length > 100)
    return NextResponse.json({ error: 'name too long' }, { status: 400 });

  await ensureSchema();
  const { rows } = await sql`
    INSERT INTO strategies (username, name, description, rules)
    VALUES (${username.trim()}, ${name.trim()}, ${description.trim()}, ${rules.trim()})
    RETURNING id
  `;
  return NextResponse.json({ ok: true, id: Number(rows[0].id) });
}
