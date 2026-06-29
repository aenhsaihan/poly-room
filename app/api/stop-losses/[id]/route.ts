import { NextRequest, NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await ensureSchema();
  await sql`DELETE FROM stop_losses WHERE id = ${Number(id)}`;
  return NextResponse.json({ ok: true });
}
