import { NextResponse } from 'next/server';
import { sql, db, ensureSchema } from '@/lib/db';
import { getMarket } from '@/lib/polymarket';
import { checkTraderStops } from '@/lib/traderstops';
import { syncAiTrader } from '@/lib/aitrader';

export const maxDuration = 60;

async function runSync() {
  await ensureSchema();

  const { rows: stops } = await sql`
    SELECT sl.id, sl.user_id, sl.market_id, sl.market_question, sl.outcome,
           sl.trail_pct, sl.peak_price, u.username
    FROM stop_losses sl
    JOIN users u ON u.id = sl.user_id
    WHERE sl.active = true
  `;

  let triggered = 0;
  let peaksUpdated = 0;

  // Deduplicate market fetches
  const marketCache = new Map<string, Awaited<ReturnType<typeof getMarket>>>();
  for (const s of stops) {
    if (!marketCache.has(s.market_id)) {
      try { marketCache.set(s.market_id, await getMarket(s.market_id)); } catch { /* skip */ }
    }
  }

  for (const s of stops) {
    const market = marketCache.get(s.market_id);
    if (!market) continue;
    if (market.closed) {
      // Market resolved — deactivate stop without executing sell (leaderboard sync handles settlement)
      await sql`UPDATE stop_losses SET active = false, updated_at = NOW() WHERE id = ${s.id}`;
      continue;
    }

    const outcomeIdx = market.outcomes.findIndex(
      (o: string) => o.toLowerCase() === String(s.outcome).toLowerCase()
    );
    if (outcomeIdx === -1) continue;
    const currentPrice = market.outcomePrices[outcomeIdx];
    const peakPrice = Number(s.peak_price);
    const trailPct = Number(s.trail_pct);

    // Update peak if price has risen
    if (currentPrice > peakPrice) {
      await sql`UPDATE stop_losses SET peak_price = ${currentPrice}, updated_at = NOW() WHERE id = ${s.id}`;
      peaksUpdated++;
      continue; // Re-check next cycle — don't trigger on the same cycle peak updates
    }

    const stopLevel = peakPrice * (1 - trailPct / 100);
    if (currentPrice <= stopLevel) {
      // Trigger: sell all shares at current price
      const { rows: positions } = await sql`
        SELECT shares FROM positions
        WHERE user_id = ${s.user_id} AND market_id = ${s.market_id} AND outcome = ${s.outcome}
      `;
      const shares = positions[0] ? Number(positions[0].shares) : 0;

      if (shares > 0.0001) {
        const proceeds = shares * currentPrice;
        const client = await db.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            `UPDATE users SET balance = balance + $1 WHERE id = $2`, [proceeds, s.user_id]
          );
          await client.query(
            `UPDATE positions SET shares = shares - $1 WHERE user_id = $2 AND market_id = $3 AND outcome = $4`,
            [shares, s.user_id, s.market_id, s.outcome]
          );
          await client.query(
            `DELETE FROM positions WHERE user_id = $1 AND market_id = $2 AND outcome = $3 AND shares <= 0.0001`,
            [s.user_id, s.market_id, s.outcome]
          );
          await client.query(
            `INSERT INTO trades (user_id, market_id, market_question, outcome, shares, price, side, amount)
             VALUES ($1, $2, $3, $4, $5, $6, 'SELL', $7)`,
            [s.user_id, s.market_id, s.market_question, s.outcome, shares, currentPrice, proceeds]
          );
          await client.query('COMMIT');
          triggered++;
        } catch {
          await client.query('ROLLBACK');
        } finally {
          client.release();
        }
      }

      await sql`
        UPDATE stop_losses SET active = false, triggered_at = NOW(), updated_at = NOW()
        WHERE id = ${s.id}
      `;
    }
  }

  return { checked: stops.length, triggered, peaksUpdated };
}

// Page loads piggyback on this endpoint, so throttle: at most one full
// sync per 2 minutes globally. Concurrent full syncs are also unsafe —
// the position-stop sell path doesn't row-lock like the trader-stop one.
async function throttledSync() {
  await ensureSchema();
  const { rows } = await sql`SELECT value FROM meta WHERE key = 'last_stop_sync'`;
  const last = rows[0] ? Number(rows[0].value) : 0;
  if (Date.now() - last < 2 * 60_000) return { skipped: true };
  await sql`
    INSERT INTO meta (key, value) VALUES ('last_stop_sync', ${String(Date.now())})
    ON CONFLICT (key) DO UPDATE SET value = ${String(Date.now())}
  `;
  const result = await runSync();
  const traderStops = await checkTraderStops().catch(() => ({ checked: 0, triggered: [] }));
  // ClaudeBot heartbeat: ideate + act on fresh desk runs (self-throttled to 10 min)
  const bot = await syncAiTrader().catch(() => null);
  return {
    ...result,
    traderStops: { checked: traderStops.checked, triggered: traderStops.triggered.length },
    aiTrader: bot,
  };
}

// Vercel cron hits GET — one endpoint covers both position stops and trader stops
export async function GET() {
  return NextResponse.json(await throttledSync());
}

export async function POST() {
  return NextResponse.json(await throttledSync());
}
