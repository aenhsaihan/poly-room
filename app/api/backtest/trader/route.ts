import { NextRequest, NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';
import { runTraderBacktest } from '@/lib/traderbacktest';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { username, wallet, allocation, trailPct, days } = await req.json() as {
    username?: string; wallet?: string; allocation?: number; trailPct?: number | null; days?: number;
  };

  if (!wallet?.trim() || !/^0x[0-9a-fA-F]{40}$/.test(wallet.trim()))
    return NextResponse.json({ error: 'valid wallet required' }, { status: 400 });
  const alloc = Number(allocation);
  if (!alloc || isNaN(alloc) || alloc < 1 || alloc > 100000)
    return NextResponse.json({ error: 'allocation must be $1–$100,000' }, { status: 400 });
  const trail = trailPct == null ? null : Number(trailPct);
  if (trail !== null && (isNaN(trail) || trail < 1 || trail > 50))
    return NextResponse.json({ error: 'trailPct must be 1–50' }, { status: 400 });
  const windowDays = Math.min(Math.max(Number(days) || 90, 7), 180);

  try {
    const result = await runTraderBacktest({
      wallet: wallet.trim().toLowerCase(),
      allocation: alloc,
      trailPct: trail,
      days: windowDays,
    });
    await ensureSchema();
    await sql`
      INSERT INTO backtests (username, kind, subject, params, result)
      VALUES (${username ?? null}, 'trader', ${wallet.trim().toLowerCase()},
              ${JSON.stringify({ allocation: alloc, trailPct: trail, days: windowDays })},
              ${JSON.stringify({ ...result, curve: undefined, curveLength: result.curve.length })})
    `.catch(() => {}); // audit record is best-effort; the result still returns
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'backtest failed' }, { status: 502 });
  }
}
