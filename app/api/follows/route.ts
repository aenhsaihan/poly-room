import { NextRequest, NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';
import { getCopyCashflows, getSleeveBudget } from '@/lib/traderstops';

export async function GET(req: NextRequest) {
  const username = req.nextUrl.searchParams.get('username');
  if (!username) return NextResponse.json({ error: 'username required' }, { status: 400 });
  await ensureSchema();
  const { rows } = await sql`
    SELECT f.id, f.user_id, f.wallet, f.trader_name, f.copy_pct, f.mode, f.allocation, f.created_at, f.last_synced_at,
           f.trail_pct, f.peak_pnl, f.last_pnl, f.stopped_at, f.stopped_pnl,
           COUNT(t.id)::int AS copied_trades,
           COALESCE(SUM(CASE WHEN t.side = 'BUY' THEN t.amount ELSE 0 END), 0) AS copied_spent
    FROM follows f
    JOIN users u ON u.id = f.user_id
    LEFT JOIN trades t ON t.user_id = f.user_id AND t.copied_from = f.trader_name
    WHERE LOWER(u.username) = LOWER(${username})
    GROUP BY f.id
    ORDER BY f.created_at DESC
  `;
  const result = [];
  for (const r of rows) {
    const mode = String(r.mode ?? 'pct');
    const allocation = r.allocation == null ? null : Number(r.allocation);
    let sleeveCash: number | null = null;
    if (mode === 'sleeve' && allocation != null) {
      const { cost, proceeds } = await getCopyCashflows(Number(r.user_id), String(r.trader_name));
      sleeveCash = Math.max(0, allocation - cost + proceeds);
    }
    result.push({
      id: Number(r.id),
      wallet: r.wallet as string,
      traderName: r.trader_name as string,
      copyPct: Number(r.copy_pct ?? 100),
      mode,
      allocation,
      sleeveCash,
      createdAt: r.created_at as string,
      lastSyncedAt: r.last_synced_at as string,
      copiedTrades: Number(r.copied_trades),
      copiedSpent: Number(r.copied_spent),
      trailPct: r.trail_pct == null ? null : Number(r.trail_pct),
      peakPnl: Number(r.peak_pnl ?? 0),
      lastPnl: r.last_pnl == null ? null : Number(r.last_pnl),
      stoppedAt: (r.stopped_at as string) ?? null,
      stoppedPnl: r.stopped_pnl == null ? null : Number(r.stopped_pnl),
    });
  }
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const { username, wallet, traderName, copyPct, trailPct, mode, allocation } = await req.json() as {
    username: string; wallet: string; traderName: string; copyPct?: number;
    trailPct?: number | null; mode?: string; allocation?: number | null;
  };
  if (!username?.trim() || !wallet?.trim() || !traderName?.trim())
    return NextResponse.json({ error: 'username, wallet, traderName required' }, { status: 400 });

  const followMode = mode === 'sleeve' ? 'sleeve' : 'pct';
  const pct = Number(copyPct ?? 100);
  if (followMode === 'pct' && (!pct || pct < 1 || pct > 100))
    return NextResponse.json({ error: 'copyPct must be 1–100' }, { status: 400 });
  const alloc = followMode === 'sleeve' ? Number(allocation) : null;
  if (followMode === 'sleeve' && (!alloc || isNaN(alloc) || alloc < 1 || alloc > 100000))
    return NextResponse.json({ error: 'allocation must be $1–$100,000' }, { status: 400 });
  const trail = trailPct == null ? null : Number(trailPct);
  if (trail !== null && (isNaN(trail) || trail < 1 || trail > 50))
    return NextResponse.json({ error: 'trailPct must be 1–50' }, { status: 400 });

  await ensureSchema();
  const { rows: users } = await sql`SELECT id FROM users WHERE LOWER(username) = LOWER(${username})`;
  if (!users[0]) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // A sleeve reserves cash — it has to fit in what other sleeves haven't claimed
  if (followMode === 'sleeve' && alloc) {
    const budget = await getSleeveBudget(Number(users[0].id), wallet.trim().toLowerCase());
    if (alloc > budget.unallocated + 0.01) {
      return NextResponse.json({
        error: `Sleeve doesn't fit: $${budget.unallocated.toFixed(2)} unallocated (balance $${budget.balance.toFixed(2)} minus $${budget.totalRemaining.toFixed(2)} reserved by other sleeves)`,
      }, { status: 400 });
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const { rows } = await sql`
    INSERT INTO follows (user_id, wallet, trader_name, copy_amount, copy_pct, mode, allocation, trail_pct, last_synced_ts)
    VALUES (${users[0].id as number}, ${wallet.trim().toLowerCase()}, ${traderName.trim()}, 0, ${pct}, ${followMode}, ${alloc}, ${trail}, ${now})
    ON CONFLICT (user_id, wallet) DO UPDATE SET
      copy_pct = ${pct},
      trader_name = ${traderName.trim()},
      mode = ${followMode},
      allocation = ${alloc},
      trail_pct = ${trail},
      peak_pnl = COALESCE(follows.last_pnl, 0)
    RETURNING id
  `;
  return NextResponse.json({ ok: true, id: Number(rows[0].id) });
}

export async function PATCH(req: NextRequest) {
  const { username, wallet, trailPct, resume } = await req.json() as {
    username: string; wallet: string; trailPct?: number | null; resume?: boolean;
  };
  if (!username?.trim() || !wallet?.trim())
    return NextResponse.json({ error: 'username and wallet required' }, { status: 400 });
  await ensureSchema();

  const { rows: found } = await sql`
    SELECT f.id FROM follows f JOIN users u ON u.id = f.user_id
    WHERE LOWER(u.username) = LOWER(${username}) AND f.wallet = ${wallet.trim().toLowerCase()}
  `;
  if (!found[0]) return NextResponse.json({ error: 'Follow not found' }, { status: 404 });
  const id = Number(found[0].id);

  if (resume) {
    // Restart copying from now: skip trades made while stopped, and
    // trail from the current P&L rather than the pre-stop peak
    const now = Math.floor(Date.now() / 1000);
    await sql`
      UPDATE follows
      SET stopped_at = NULL, stopped_pnl = NULL,
          peak_pnl = COALESCE(last_pnl, 0),
          last_synced_ts = ${now}, last_synced_at = NOW()
      WHERE id = ${id}
    `;
    return NextResponse.json({ ok: true });
  }

  if (trailPct !== undefined) {
    if (trailPct === null) {
      await sql`UPDATE follows SET trail_pct = NULL WHERE id = ${id}`;
    } else {
      const trail = Number(trailPct);
      if (isNaN(trail) || trail < 1 || trail > 50)
        return NextResponse.json({ error: 'trailPct must be 1–50' }, { status: 400 });
      // (Re)arming trails from the current P&L, not a stale historical peak
      await sql`UPDATE follows SET trail_pct = ${trail}, peak_pnl = COALESCE(last_pnl, 0) WHERE id = ${id}`;
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const { username, wallet } = await req.json() as { username: string; wallet: string };
  if (!username?.trim() || !wallet?.trim())
    return NextResponse.json({ error: 'username and wallet required' }, { status: 400 });
  await ensureSchema();
  await sql`
    DELETE FROM follows f USING users u
    WHERE f.user_id = u.id AND LOWER(u.username) = LOWER(${username}) AND f.wallet = ${wallet.trim().toLowerCase()}
  `;
  return NextResponse.json({ ok: true });
}
