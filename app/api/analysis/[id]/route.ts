import { NextRequest, NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await ensureSchema();

  const { rows } = await sql`
    SELECT
      outcome,
      COUNT(DISTINCT user_id)::int        AS holder_count,
      SUM(shares)                         AS total_shares,
      AVG(avg_price)                      AS avg_price,
      SUM(shares * avg_price)             AS total_value
    FROM positions
    WHERE market_id = ${id} AND shares > 0.001
    GROUP BY outcome
    ORDER BY total_value DESC
  `;

  return NextResponse.json(
    rows.map(r => ({
      outcome: r.outcome,
      holderCount: Number(r.holder_count),
      totalShares: Number(r.total_shares),
      avgPrice: Number(r.avg_price),
      totalValue: Number(r.total_value),
    }))
  );
}
