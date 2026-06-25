import { NextRequest, NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { status, ai_response } = await req.json() as { status?: string; ai_response?: string };
  await ensureSchema();

  if (status) {
    if (!['open', 'needs_info', 'resolved'].includes(status))
      return NextResponse.json({ error: 'invalid status' }, { status: 400 });
    await sql`UPDATE tickets SET status = ${status}, updated_at = NOW() WHERE id = ${Number(id)}`;
  }
  if (ai_response !== undefined) {
    await sql`UPDATE tickets SET ai_response = ${ai_response}, updated_at = NOW() WHERE id = ${Number(id)}`;
  }
  return NextResponse.json({ ok: true });
}
