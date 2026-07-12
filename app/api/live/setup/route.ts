import { NextRequest, NextResponse } from 'next/server';
import { isLiveConfigured, isLiveOperator, setupAllowances, getBotStatus } from '@/lib/clob';

export const maxDuration = 60;

// One-time allowance setup for the bot wallet. Idempotent — safe to re-run.
// GET so the operator can trigger it from a logged-in browser:
//   /api/live/setup?username=<operator>
export async function GET(req: NextRequest) {
  const username = req.nextUrl.searchParams.get('username');
  if (!isLiveConfigured())
    return NextResponse.json({ error: 'Live trading not configured (POLY_BOT_PRIVATE_KEY missing)' }, { status: 503 });
  if (!username || !isLiveOperator(username))
    return NextResponse.json({ error: 'Restricted to the configured operator (?username=...)' }, { status: 403 });

  try {
    const { txs } = await setupAllowances();
    const status = await getBotStatus();
    return NextResponse.json({ ok: true, approvalsSent: txs, status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'setup failed' }, { status: 502 });
  }
}
