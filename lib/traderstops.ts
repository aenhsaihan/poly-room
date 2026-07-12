// Trader trailing stops: treat a copied trader like an asset you hold.
//
// Metric: your copy P&L for that trader, in dollars =
//   (current value of the copied share of open positions
//    + sell proceeds attributed to their copies)
//   − dollars you spent copying them.
// The P&L peak ratchets up on each check. When P&L falls more than
// trail_pct% OF DEPLOYED COST below the peak, the stop fires:
// copying pauses and the copied share of open positions is sold at
// current prices. P&L (not raw equity) is trailed so that deploying
// more capital never counts as a gain.
//
// Attribution: BUY trades carry copied_from = trader_name. When a
// position mixes copied and manual buys, the copied fraction is
// copied_buy_shares / total_buy_shares, applied proportionally to
// current holdings and to sell proceeds.

import { sql, db } from './db';
import { getMarket } from './polymarket';
import type { Market } from './polymarket';

export interface TriggeredStop {
  trader: string;
  wallet: string;
  userId: number;
  pnl: number;
  sold: number;
}
export interface TraderStopSummary {
  checked: number;
  triggered: TriggeredStop[];
}

// Every market+outcome a user has copied from a trader, with copied vs
// total buy shares (for proportional attribution) and total sell proceeds
export async function getCopyLegs(userId: number, trader: string) {
  const { rows } = await sql`
    SELECT t.market_id, t.outcome, MAX(t.market_question) AS question,
           SUM(CASE WHEN t.side = 'BUY' AND t.copied_from = ${trader} THEN t.shares ELSE 0 END) AS copied_shares,
           SUM(CASE WHEN t.side = 'BUY' AND t.copied_from = ${trader} THEN t.amount ELSE 0 END) AS copied_cost,
           SUM(CASE WHEN t.side = 'BUY' THEN t.shares ELSE 0 END) AS total_buy_shares,
           SUM(CASE WHEN t.side = 'SELL' THEN t.amount ELSE 0 END) AS sell_proceeds
    FROM trades t
    WHERE t.user_id = ${userId}
      AND EXISTS (
        SELECT 1 FROM trades c
        WHERE c.user_id = t.user_id AND c.market_id = t.market_id AND c.outcome = t.outcome
          AND c.side = 'BUY' AND c.copied_from = ${trader}
      )
    GROUP BY t.market_id, t.outcome
  `;
  return rows;
}

// Dollars spent copying a trader and sell proceeds attributed back to those
// copies — the cashflow half of copy equity (no market prices needed).
// Sleeve mode uses this: remaining sleeve cash = allocation − cost + proceeds.
export async function getCopyCashflows(userId: number, trader: string): Promise<{ cost: number; proceeds: number }> {
  const legs = await getCopyLegs(userId, trader);
  let cost = 0;
  let proceeds = 0;
  for (const leg of legs) {
    const copiedShares = Number(leg.copied_shares);
    const totalBuyShares = Number(leg.total_buy_shares);
    if (copiedShares <= 0 || totalBuyShares <= 0) continue;
    const frac = Math.min(1, copiedShares / totalBuyShares);
    cost += Number(leg.copied_cost);
    proceeds += Number(leg.sell_proceeds) * frac;
  }
  return { cost, proceeds };
}

export async function checkTraderStops(username?: string): Promise<TraderStopSummary> {
  // All active follows — P&L is computed for everyone (it feeds the
  // Copy P&L stat); the stop trigger only applies where trail_pct is set
  const { rows: follows } = username
    ? await sql`
        SELECT f.id, f.user_id, f.wallet, f.trader_name, f.trail_pct, f.peak_pnl
        FROM follows f JOIN users u ON u.id = f.user_id
        WHERE f.stopped_at IS NULL
          AND LOWER(u.username) = LOWER(${username})`
    : await sql`
        SELECT id, user_id, wallet, trader_name, trail_pct, peak_pnl
        FROM follows
        WHERE stopped_at IS NULL`;

  const triggered: TriggeredStop[] = [];
  const marketCache = new Map<string, Market | null>();
  async function getMarketCached(id: string): Promise<Market | null> {
    if (!marketCache.has(id)) {
      try { marketCache.set(id, await getMarket(id)); } catch { marketCache.set(id, null); }
    }
    return marketCache.get(id) ?? null;
  }

  for (const f of follows) {
    const userId = Number(f.user_id);
    const trader = String(f.trader_name);
    const trailPct = f.trail_pct == null ? null : Number(f.trail_pct);
    const storedPeak = Number(f.peak_pnl ?? 0);

    const legs = await getCopyLegs(userId, trader);
    if (legs.length === 0) continue; // nothing copied yet — no signal

    const { rows: posRows } = await sql`
      SELECT market_id, outcome, shares FROM positions WHERE user_id = ${userId}
    `;
    const held = new Map<string, number>(
      posRows.map(p => [`${p.market_id}|${String(p.outcome).toLowerCase()}`, Number(p.shares)] as [string, number])
    );

    let cost = 0;
    let equity = 0;
    const sellTargets: { marketId: string; question: string; outcome: string; shares: number; price: number }[] = [];

    for (const leg of legs) {
      const copiedShares = Number(leg.copied_shares);
      const totalBuyShares = Number(leg.total_buy_shares);
      if (copiedShares <= 0 || totalBuyShares <= 0) continue;
      const frac = Math.min(1, copiedShares / totalBuyShares);
      cost += Number(leg.copied_cost);
      equity += Number(leg.sell_proceeds) * frac;

      const shares = held.get(`${leg.market_id}|${String(leg.outcome).toLowerCase()}`) ?? 0;
      if (shares <= 0.0001) continue;
      const market = await getMarketCached(String(leg.market_id));
      if (!market) continue;
      const idx = market.outcomes.findIndex(o => o.toLowerCase() === String(leg.outcome).toLowerCase());
      if (idx === -1) continue;
      const price = market.outcomePrices[idx] ?? 0;
      const attributedShares = shares * frac;
      equity += attributedShares * price;
      // closed markets settle via portfolio sync — don't sell them here
      if (!market.closed && price > 0) {
        sellTargets.push({
          marketId: String(leg.market_id),
          question: String(leg.question),
          outcome: String(leg.outcome),
          shares: attributedShares,
          price,
        });
      }
    }

    if (cost <= 0) continue;
    const pnl = equity - cost;
    const peak = Math.max(storedPeak, pnl);

    // No stop armed, or still above the trigger line → just record P&L
    const threshold = trailPct === null ? null : peak - (trailPct / 100) * cost;
    if (threshold === null || pnl > threshold) {
      await sql`UPDATE follows SET peak_pnl = ${peak}, last_pnl = ${pnl} WHERE id = ${Number(f.id)}`;
      continue;
    }

    // Triggered: sell the copied share of open positions, pause the follow
    let sold = 0;
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      for (const s of sellTargets) {
        const { rows: cur } = await client.query(
          `SELECT shares FROM positions WHERE user_id = $1 AND market_id = $2 AND outcome = $3 FOR UPDATE`,
          [userId, s.marketId, s.outcome]
        );
        const have = cur[0] ? Number(cur[0].shares) : 0;
        const sellShares = Math.min(have, s.shares);
        if (sellShares <= 0.0001) continue;
        const proceeds = sellShares * s.price;
        await client.query(`UPDATE users SET balance = balance + $1 WHERE id = $2`, [proceeds, userId]);
        await client.query(
          `UPDATE positions SET shares = shares - $1 WHERE user_id = $2 AND market_id = $3 AND outcome = $4`,
          [sellShares, userId, s.marketId, s.outcome]
        );
        await client.query(
          `DELETE FROM positions WHERE user_id = $1 AND market_id = $2 AND outcome = $3 AND shares <= 0.0001`,
          [userId, s.marketId, s.outcome]
        );
        await client.query(
          `INSERT INTO trades (user_id, market_id, market_question, outcome, shares, price, side, amount, copied_from)
           VALUES ($1, $2, $3, $4, $5, $6, 'SELL', $7, $8)`,
          [userId, s.marketId, s.question, s.outcome, sellShares, s.price, proceeds, trader]
        );
        sold++;
      }
      await client.query(
        `UPDATE follows SET stopped_at = NOW(), stopped_pnl = $1, peak_pnl = $2, last_pnl = $1 WHERE id = $3`,
        [pnl, peak, Number(f.id)]
      );
      await client.query('COMMIT');
      triggered.push({ trader, wallet: String(f.wallet), userId, pnl, sold });
    } catch {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }

  return { checked: follows.length, triggered };
}
