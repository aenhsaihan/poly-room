import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { syncUserFollows } from '@/lib/copysync';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const { username } = await req.json().catch(() => ({})) as { username?: string };
  if (!username?.trim()) return NextResponse.json({ error: 'username required' }, { status: 400 });
  await ensureSchema();
  try {
    const result = await syncUserFollows(username);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ follows: 0, copied: 0 });
  }
}
