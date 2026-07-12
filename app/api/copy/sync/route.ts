import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { syncUserFollows } from '@/lib/copysync';
import { checkTraderStops } from '@/lib/traderstops';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { username } = await req.json().catch(() => ({})) as { username?: string };
  if (!username?.trim()) return NextResponse.json({ error: 'username required' }, { status: 400 });
  await ensureSchema();
  try {
    const result = await syncUserFollows(username);
    // after mirroring fresh trades, evaluate this user's trader trailing stops
    const stops = await checkTraderStops(username).catch(() => ({ checked: 0, triggered: [] }));
    return NextResponse.json({
      ...result,
      stopsTriggered: stops.triggered.map(t => ({ trader: t.trader, pnl: t.pnl, sold: t.sold })),
    });
  } catch {
    return NextResponse.json({ follows: 0, copied: 0, stopsTriggered: [] });
  }
}
