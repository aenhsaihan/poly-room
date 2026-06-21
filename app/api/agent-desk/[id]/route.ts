import { NextRequest, NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';
import { getMarket, getPriceHistory, getRealTrades } from '@/lib/polymarket';
import { runDesk, type CommunityPosition } from '@/lib/agents';
import { narrateDesk } from '@/lib/llm';

export const maxDuration = 30;

function rowToRun(r: Record<string, unknown>) {
  return {
    id: Number(r.id),
    username: r.username as string,
    action: r.action as string,
    rating: r.rating as string,
    conviction: Number(r.conviction),
    yesPrice: Number(r.yes_price),
    report: r.report,
    createdAt: r.created_at as string,
  };
}

// Latest stored desk run for this market
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await ensureSchema();
  const { rows } = await sql`
    SELECT id, username, action, rating, conviction, yes_price, report, created_at
    FROM agent_runs WHERE market_id = ${id}
    ORDER BY created_at DESC LIMIT 1
  `;
  return NextResponse.json(rows.length ? rowToRun(rows[0]) : null);
}

// Convene the desk: gather live evidence, run the pipeline, store the verdict
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { username } = await req.json().catch(() => ({})) as { username?: string };
  await ensureSchema();

  const market = await getMarket(id);
  const [history, trades, posRes, comRes] = await Promise.all([
    market.clobTokenIds[0] ? getPriceHistory(market.clobTokenIds[0], '1m') : Promise.resolve([]),
    market.conditionId ? getRealTrades(market.conditionId, 30) : Promise.resolve([]),
    sql`
      SELECT outcome,
             COUNT(DISTINCT user_id)::int AS holder_count,
             AVG(avg_price) AS avg_price,
             SUM(shares * avg_price) AS total_value
      FROM positions WHERE market_id = ${id} AND shares > 0.001
      GROUP BY outcome
    `,
    sql`SELECT COUNT(*)::int AS n FROM comments WHERE market_id = ${id}`,
  ]);

  const positions: CommunityPosition[] = posRes.rows.map(r => ({
    outcome: r.outcome as string,
    holderCount: Number(r.holder_count),
    avgPrice: Number(r.avg_price),
    totalValue: Number(r.total_value),
  }));
  const commentCount = Number(comRes.rows[0]?.n ?? 0);

  const report = await narrateDesk(
    runDesk(market, history, trades, positions, commentCount),
    market
  );

  const { rows } = await sql`
    INSERT INTO agent_runs (market_id, market_question, username, action, rating, conviction, yes_price, report)
    VALUES (${id}, ${market.question}, ${(username || 'guest').trim()}, ${report.decision.action},
            ${report.decision.rating}, ${report.decision.conviction}, ${report.yesPrice}, ${JSON.stringify(report)})
    RETURNING id, username, action, rating, conviction, yes_price, report, created_at
  `;
  return NextResponse.json(rowToRun(rows[0]));
}
