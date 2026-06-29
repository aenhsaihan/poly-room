import { NextRequest, NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json() as { enabled?: boolean; status?: string; ai_review?: string };
  await ensureSchema();

  if (body.enabled !== undefined) {
    await sql`UPDATE strategies SET enabled = ${body.enabled}, updated_at = NOW() WHERE id = ${Number(id)}`;
  }
  if (body.status !== undefined) {
    if (!['pending', 'active', 'rejected'].includes(body.status))
      return NextResponse.json({ error: 'invalid status' }, { status: 400 });
    await sql`UPDATE strategies SET status = ${body.status}, updated_at = NOW() WHERE id = ${Number(id)}`;
  }
  if (body.ai_review !== undefined) {
    await sql`UPDATE strategies SET ai_review = ${body.ai_review}, updated_at = NOW() WHERE id = ${Number(id)}`;
  }
  if (body.appendRules) {
    await sql`
      UPDATE strategies
      SET rules = rules || ${'\n\n---\n**Reply:** ' + (body.appendRules as string).trim()},
          updated_at = NOW()
      WHERE id = ${Number(id)}
    `;
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await ensureSchema();
  await sql`DELETE FROM strategies WHERE id = ${Number(id)}`;
  return NextResponse.json({ ok: true });
}
