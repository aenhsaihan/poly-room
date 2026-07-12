// Copy-trading sync engine.
// For each follow, replay the followed wallet's real Polymarket trades (Data API,
// the same per-user feed polybot ingests) into the follower's paper portfolio:
//   - their BUY  → paper BUY of `copy_amount` dollars at THEIR fill price
//   - their SELL → liquidate our whole mirrored position in that market+outcome
// Trades are mirrored at the followed trader's historical fill price, so syncing
// lazily (on page loads) is fair — timing of the sync doesn't change the result.

import { sql, db } from './db';
import { getWalletTrades, getMarketByConditionId, getWalletPositionsValue } from './polymarket';
import { getCopyCashflows } from './traderstops';

interface FollowRow {
  id: number;
  user_id: number;
  wallet: string;
  trader_name: string;
  copy_amount: number;
  copy_pct: number;
  mode: string;
  allocation: number;
  last_synced_ts: number;
  created_at: string;
}

// Sleeve mode: never let a single copied trade consume more than half the
// sleeve, even when the trader's visible portfolio is tiny (denominator noise)
const MAX_SLEEVE_FRACTION = 0.5;

export interface SyncResult {
  follows: number;
  copied: number;
}

async function syncOneFollow(
  follow: FollowRow,
  marketCache: Map<string, { id: string; question: string } | null>,
  valueCache: Map<string, number>,
): Promise<number> {
  const all = await getWalletTrades(follow.wallet, 40);
  const since = Math.max(follow.last_synced_ts, Math.floor(new Date(follow.created_at).getTime() / 1000));
  const fresh = all.filter(t => t.timestamp > since).sort((a, b) => a.timestamp - b.timestamp);
  if (fresh.length === 0) {
    await sql`UPDATE follows SET last_synced_at = NOW() WHERE id = ${follow.id}`;
    return 0;
  }

  // resolve condition IDs → our market ids (gamma), cached across follows
  for (const t of fresh) {
    if (!marketCache.has(t.conditionId)) {
      const m = await getMarketByConditionId(t.conditionId).catch(() => null);
      marketCache.set(t.conditionId, m ? { id: m.id, question: m.question } : null);
    }
  }

  // Sleeve mode prep: remaining sleeve cash + the trader's portfolio value
  // (denominator for proportional sizing), cached per wallet across follows
  const isSleeve = follow.mode === 'sleeve' && follow.allocation > 0;
  let sleeveCash = 0;
  let traderValue = 0;
  if (isSleeve) {
    const { cost, proceeds } = await getCopyCashflows(follow.user_id, follow.trader_name);
    sleeveCash = Math.max(0, follow.allocation - cost + proceeds);
    if (!valueCache.has(follow.wallet)) {
      valueCache.set(follow.wallet, await getWalletPositionsValue(follow.wallet).catch(() => 0));
    }
    traderValue = valueCache.get(follow.wallet) ?? 0;
  }

  let copied = 0;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: users } = await client.query(`SELECT id, balance FROM users WHERE id = $1 FOR UPDATE`, [follow.user_id]);
    if (!users[0]) throw new Error('follower gone');
    let balance = Number(users[0].balance);
    let maxTs = follow.last_synced_ts;

    for (const t of fresh) {
      maxTs = Math.max(maxTs, t.timestamp);
      const market = marketCache.get(t.conditionId);
      if (!market || t.price <= 0 || t.price >= 1) continue;
      const question = market.question || t.title;

      if (t.side === 'BUY') {
        const traderAmount = t.size * t.price;
        let amount: number;
        if (isSleeve) {
          // they bet X% of their portfolio → you bet X% of your sleeve
          const denom = Math.max(traderValue, traderAmount);
          const frac = Math.min(denom > 0 ? traderAmount / denom : 0, MAX_SLEEVE_FRACTION);
          amount = Math.min(frac * follow.allocation, sleeveCash, balance);
        } else {
          amount = Math.min(traderAmount * (follow.copy_pct / 100), balance);
        }
        if (amount < 0.01) continue; // too small, sleeve exhausted, or out of cash
        if (isSleeve) sleeveCash -= amount;
        const shares = amount / t.price;
        await client.query(`UPDATE users SET balance = balance - $1 WHERE id = $2`, [amount, follow.user_id]);
        balance -= amount;
        await client.query(`
          INSERT INTO positions (user_id, market_id, market_question, outcome, shares, avg_price)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (user_id, market_id, outcome) DO UPDATE SET
            avg_price = (positions.shares * positions.avg_price + excluded.shares * excluded.avg_price)
                        / (positions.shares + excluded.shares),
            shares = positions.shares + excluded.shares
        `, [follow.user_id, market.id, question, t.outcome, shares, t.price]);
        await client.query(`
          INSERT INTO trades (user_id, market_id, market_question, outcome, shares, price, side, amount, copied_from)
          VALUES ($1, $2, $3, $4, $5, $6, 'BUY', $7, $8)
        `, [follow.user_id, market.id, question, t.outcome, shares, t.price, amount, follow.trader_name]);
        copied++;
      } else {
        // they sold → exit our whole mirrored position in that market+outcome
        const { rows: pos } = await client.query(
          `SELECT shares FROM positions WHERE user_id = $1 AND market_id = $2 AND outcome = $3`,
          [follow.user_id, market.id, t.outcome]
        );
        const held = pos[0] ? Number(pos[0].shares) : 0;
        if (held <= 0.0001) continue;
        const proceeds = held * t.price;
        await client.query(`UPDATE users SET balance = balance + $1 WHERE id = $2`, [proceeds, follow.user_id]);
        balance += proceeds;
        if (isSleeve) sleeveCash += proceeds;
        await client.query(
          `DELETE FROM positions WHERE user_id = $1 AND market_id = $2 AND outcome = $3`,
          [follow.user_id, market.id, t.outcome]
        );
        await client.query(`
          INSERT INTO trades (user_id, market_id, market_question, outcome, shares, price, side, amount, copied_from)
          VALUES ($1, $2, $3, $4, $5, $6, 'SELL', $7, $8)
        `, [follow.user_id, market.id, question, t.outcome, held, t.price, proceeds, follow.trader_name]);
        copied++;
      }
    }

    await client.query(
      `UPDATE follows SET last_synced_ts = $1, last_synced_at = NOW() WHERE id = $2`,
      [maxTs, follow.id]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return copied;
}

async function syncFollowRows(rows: FollowRow[]): Promise<SyncResult> {
  const marketCache = new Map<string, { id: string; question: string } | null>();
  const valueCache = new Map<string, number>();
  let copied = 0;
  const results = await Promise.allSettled(rows.map(f => syncOneFollow(f, marketCache, valueCache)));
  for (const r of results) if (r.status === 'fulfilled') copied += r.value;
  return { follows: rows.length, copied };
}

// Sync all follows of one user (throttled per follow)
export async function syncUserFollows(username: string): Promise<SyncResult> {
  const { rows } = await sql`
    SELECT f.id, f.user_id, f.wallet, f.trader_name, f.copy_amount, f.copy_pct, f.mode, f.allocation, f.last_synced_ts, f.created_at
    FROM follows f JOIN users u ON u.id = f.user_id
    WHERE LOWER(u.username) = LOWER(${username})
      AND f.stopped_at IS NULL
      AND f.last_synced_at < NOW() - INTERVAL '60 seconds'
  `;
  return syncFollowRows(rows.map(r => ({ ...r, copy_amount: Number(r.copy_amount), copy_pct: Number(r.copy_pct ?? 100), mode: String(r.mode ?? 'pct'), allocation: Number(r.allocation ?? 0), last_synced_ts: Number(r.last_synced_ts) }) as FollowRow));
}

// Sync everyone's follows, at most once per 5 minutes globally
// (called from the leaderboard so rankings include copied trades of inactive users)
export async function syncAllFollows(): Promise<SyncResult | null> {
  const { rows: meta } = await sql`SELECT value FROM meta WHERE key = 'last_global_copy_sync'`;
  const last = meta[0] ? Number(meta[0].value) : 0;
  if (Date.now() - last < 5 * 60_000) return null;
  await sql`
    INSERT INTO meta (key, value) VALUES ('last_global_copy_sync', ${String(Date.now())})
    ON CONFLICT (key) DO UPDATE SET value = ${String(Date.now())}
  `;
  const { rows } = await sql`
    SELECT id, user_id, wallet, trader_name, copy_amount, copy_pct, mode, allocation, last_synced_ts, created_at
    FROM follows
    WHERE stopped_at IS NULL
    ORDER BY last_synced_at ASC
    LIMIT 40
  `;
  return syncFollowRows(rows.map(r => ({ ...r, copy_amount: Number(r.copy_amount), copy_pct: Number(r.copy_pct ?? 100), mode: String(r.mode ?? 'pct'), allocation: Number(r.allocation ?? 0), last_synced_ts: Number(r.last_synced_ts) }) as FollowRow));
}
