import { NextRequest, NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';
import { syncAiTrader, BOT_USERNAME } from '@/lib/aitrader';

export const maxDuration = 60;

// ClaudeBot status + diagnostics. ?force=1 runs a sync cycle immediately
// (bypassing the 10-min throttle) — handy for kicking the bot from a browser.
export async function GET(req: NextRequest) {
  await ensureSchema();

  const forced = req.nextUrl.searchParams.get('force') === '1';
  const syncResult = forced ? await syncAiTrader(true).catch(e => ({ error: String(e) })) : null;

  const [{ rows: bot }, { rows: meta }, { rows: runStats }, { rows: botTrades }] = await Promise.all([
    sql`
      SELECT u.id, u.balance,
        (SELECT COUNT(*)::int FROM positions p WHERE p.user_id = u.id AND p.shares > 0.001) AS positions,
        (SELECT COUNT(*)::int FROM trades t WHERE t.user_id = u.id) AS trades
      FROM users u WHERE u.username = ${BOT_USERNAME}
    `,
    sql`SELECT key, value FROM meta WHERE key IN ('last_ai_trader_sync', 'ai_trader_last_run_id', 'ai_trader_last_result')`,
    sql`
      SELECT
        COUNT(*)::int AS total_48h,
        COUNT(*) FILTER (WHERE action <> 'HOLD')::int AS non_hold_48h,
        COUNT(*) FILTER (WHERE action <> 'HOLD' AND conviction >= 15)::int AS actionable_48h,
        COUNT(*) FILTER (WHERE username = ${BOT_USERNAME})::int AS by_bot_48h
      FROM agent_runs WHERE created_at > NOW() - INTERVAL '48 hours'
    `,
    sql`
      SELECT t.market_question, t.outcome, t.side, t.amount, t.price, t.created_at
      FROM trades t JOIN users u ON u.id = t.user_id
      WHERE u.username = ${BOT_USERNAME}
      ORDER BY t.created_at DESC LIMIT 10
    `,
  ]);

  const metaMap = Object.fromEntries(meta.map(r => [String(r.key), String(r.value)]));
  let lastResult: unknown = null;
  try { lastResult = metaMap['ai_trader_last_result'] ? JSON.parse(metaMap['ai_trader_last_result']) : null; } catch {}

  return NextResponse.json({
    bot: bot[0] ? {
      balance: Number(bot[0].balance),
      openPositions: Number(bot[0].positions),
      totalTrades: Number(bot[0].trades),
    } : null,
    lastSyncAt: metaMap['last_ai_trader_sync'] ? new Date(Number(metaMap['last_ai_trader_sync'])).toISOString() : null,
    highWaterRunId: metaMap['ai_trader_last_run_id'] ? Number(metaMap['ai_trader_last_run_id']) : 0,
    lastResult,
    runsLast48h: {
      total: Number(runStats[0]?.total_48h ?? 0),
      nonHold: Number(runStats[0]?.non_hold_48h ?? 0),
      actionable: Number(runStats[0]?.actionable_48h ?? 0),
      byBot: Number(runStats[0]?.by_bot_48h ?? 0),
    },
    recentBotTrades: botTrades.map(t => ({
      question: String(t.market_question),
      outcome: String(t.outcome),
      side: String(t.side),
      amount: Number(t.amount),
      price: Number(t.price),
      at: t.created_at,
    })),
    ...(syncResult ? { forcedSync: syncResult } : {}),
  });
}
