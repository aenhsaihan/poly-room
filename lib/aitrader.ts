// ClaudeBot: the agent desk's convictions, given a book of their own.
//
// A house user ('ClaudeBot', normal $1,000 start) that:
//  1. generates ideas — each sync pass it convenes the desk on one trending
//     market nobody has analyzed recently, storing a normal agent_runs row
//  2. acts on conviction — fresh desk runs (anyone's) with a non-HOLD action
//     and conviction ≥ MIN_CONVICTION become paper buys, sized by the desk's
//     own risk manager (suggestedStakePct of the bot's balance, capped)
//  3. protects itself — every entry gets a 15% trailing stop via the same
//     stop_losses machinery users get
//
// The bot is copyable like any trader: follows use the sentinel wallet
// 'claude-bot' and copy-sync feeds them from our trades table instead of
// the on-chain Data API (see getInternalTradeFeed).

import { sql, db } from './db';
import { getMarket, getMarkets, getPriceHistory, getRealTrades } from './polymarket';
import { runDesk, type CommunityPosition } from './agents';
import { narrateDesk } from './llm';

export const BOT_USERNAME = 'ClaudeBot';
export const BOT_WALLET = 'claude-bot'; // sentinel: follows of this "wallet" mirror our DB, not the chain

const MIN_CONVICTION = 25;      // desk scale is 0–100; 25+ ≈ solid OVERWEIGHT or better
const MAX_PER_MARKET = 100;     // $ cap per market
const MIN_BET = 5;              // skip dust
const MAX_RUN_AGE_SEC = 48 * 3600;
const MAX_ADVERSE_MOVE = 0.10;  // skip if price ran >10¢ against the call since the run
const BOT_TRAIL_PCT = 15;
const THROTTLE_MS = 10 * 60_000;

export interface AiTraderSummary {
  skipped?: boolean;
  ideated: string | null;
  runsConsidered: number;
  betsPlaced: number;
}

async function getBotId(): Promise<number> {
  await sql`INSERT INTO users (username) VALUES (${BOT_USERNAME}) ON CONFLICT (username) DO NOTHING`;
  const { rows } = await sql`SELECT id FROM users WHERE username = ${BOT_USERNAME}`;
  return Number(rows[0].id);
}

// Convene the desk on one trending market with no recent analysis.
// One per sync pass keeps latency and Groq usage bounded.
async function ideateOne(): Promise<string | null> {
  const markets = await getMarkets({ limit: 12 }).catch(() => []);
  if (markets.length === 0) return null;

  const { rows: recent } = await sql`
    SELECT DISTINCT market_id FROM agent_runs
    WHERE created_at > NOW() - INTERVAL '24 hours'
  `;
  const analyzed = new Set(recent.map(r => String(r.market_id)));
  const target = markets.find(m =>
    !analyzed.has(m.id) && !m.closed &&
    m.outcomes.some(o => o.toLowerCase() === 'yes')
  );
  if (!target) return null;

  const [history, trades, posRes, comRes] = await Promise.all([
    target.clobTokenIds[0] ? getPriceHistory(target.clobTokenIds[0], '1m').catch(() => []) : Promise.resolve([]),
    target.conditionId ? getRealTrades(target.conditionId, 30).catch(() => []) : Promise.resolve([]),
    sql`
      SELECT outcome,
             COUNT(DISTINCT user_id)::int AS holder_count,
             AVG(avg_price) AS avg_price,
             SUM(shares * avg_price) AS total_value
      FROM positions WHERE market_id = ${target.id} AND shares > 0.001
      GROUP BY outcome
    `,
    sql`SELECT COUNT(*)::int AS n FROM comments WHERE market_id = ${target.id}`,
  ]);

  const positions: CommunityPosition[] = posRes.rows.map(r => ({
    outcome: r.outcome as string,
    holderCount: Number(r.holder_count),
    avgPrice: Number(r.avg_price),
    totalValue: Number(r.total_value),
  }));

  const report = await narrateDesk(
    runDesk(target, history, trades, positions, Number(comRes.rows[0]?.n ?? 0)),
    target
  );

  await sql`
    INSERT INTO agent_runs (market_id, market_question, username, action, rating, conviction, yes_price, report)
    VALUES (${target.id}, ${target.question}, ${BOT_USERNAME}, ${report.decision.action},
            ${report.decision.rating}, ${report.decision.conviction}, ${report.yesPrice}, ${JSON.stringify(report)})
  `;
  return target.id;
}

// Act on desk runs newer than the high-water mark.
async function actOnRuns(botId: number): Promise<{ considered: number; placed: number }> {
  const { rows: meta } = await sql`SELECT value FROM meta WHERE key = 'ai_trader_last_run_id'`;
  const lastId = meta[0] ? Number(meta[0].value) : 0;

  const { rows: runs } = await sql`
    SELECT id, market_id, market_question, action, conviction, yes_price, created_at,
           report->'decision'->>'suggestedStakePct' AS stake_pct
    FROM agent_runs
    WHERE id > ${lastId}
    ORDER BY id ASC
    LIMIT 10
  `;
  if (runs.length === 0) return { considered: 0, placed: 0 };

  let placed = 0;
  let maxId = lastId;

  for (const run of runs) {
    maxId = Math.max(maxId, Number(run.id));
    const action = String(run.action);
    const conviction = Number(run.conviction);
    const ageSec = (Date.now() - new Date(run.created_at as string).getTime()) / 1000;

    if (action === 'HOLD' || conviction < MIN_CONVICTION || ageSec > MAX_RUN_AGE_SEC) continue;

    const market = await getMarket(String(run.market_id)).catch(() => null);
    if (!market || market.closed) continue;

    const wantOutcome = action === 'BUY YES' ? 'yes' : 'no';
    const idx = market.outcomes.findIndex(o => o.toLowerCase() === wantOutcome);
    if (idx === -1) continue;
    const price = market.outcomePrices[idx];
    if (!price || price <= 0.02 || price >= 0.98) continue;

    // Edge staleness: if YES ran >10¢ against the call since the run, pass
    const yesAtRun = Number(run.yes_price);
    const yesNow = market.outcomePrices[market.outcomes.findIndex(o => o.toLowerCase() === 'yes')] ?? yesAtRun;
    const adverse = action === 'BUY YES' ? yesNow - yesAtRun : yesAtRun - yesNow;
    if (adverse > MAX_ADVERSE_MOVE) continue;

    // Already positioned in this market+outcome? One entry per call.
    const { rows: existing } = await sql`
      SELECT 1 FROM positions
      WHERE user_id = ${botId} AND market_id = ${market.id} AND outcome = ${market.outcomes[idx]}
        AND shares > 0.001
    `;
    if (existing.length > 0) continue;

    // Size by the desk's own risk manager, fall back to conviction/4 %
    const stakePct = Math.min(25, Math.max(2, Number(run.stake_pct) || Math.round(conviction / 4)));

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows: users } = await client.query(`SELECT balance FROM users WHERE id = $1 FOR UPDATE`, [botId]);
      const balance = Number(users[0]?.balance ?? 0);
      const amount = Math.min(balance * (stakePct / 100), MAX_PER_MARKET, balance);
      if (amount < MIN_BET) { await client.query('ROLLBACK'); continue; }

      const shares = amount / price;
      await client.query(`UPDATE users SET balance = balance - $1 WHERE id = $2`, [amount, botId]);
      await client.query(`
        INSERT INTO positions (user_id, market_id, market_question, outcome, shares, avg_price)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id, market_id, outcome) DO UPDATE SET
          avg_price = (positions.shares * positions.avg_price + excluded.shares * excluded.avg_price)
                      / (positions.shares + excluded.shares),
          shares = positions.shares + excluded.shares
      `, [botId, market.id, market.question, market.outcomes[idx], shares, price]);
      await client.query(`
        INSERT INTO trades (user_id, market_id, market_question, outcome, shares, price, side, amount)
        VALUES ($1, $2, $3, $4, $5, $6, 'BUY', $7)
      `, [botId, market.id, market.question, market.outcomes[idx], shares, price, amount]);
      await client.query(`
        INSERT INTO stop_losses (user_id, market_id, market_question, outcome, trail_pct, peak_price)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id, market_id, outcome) DO UPDATE SET
          trail_pct = $5, peak_price = $6, active = true, triggered_at = NULL, updated_at = NOW()
      `, [botId, market.id, market.question, market.outcomes[idx], BOT_TRAIL_PCT, price]);
      await client.query('COMMIT');
      placed++;
    } catch {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }

  await sql`
    INSERT INTO meta (key, value) VALUES ('ai_trader_last_run_id', ${String(maxId)})
    ON CONFLICT (key) DO UPDATE SET value = ${String(maxId)}
  `;
  return { considered: runs.length, placed };
}

export async function syncAiTrader(): Promise<AiTraderSummary> {
  const { rows: meta } = await sql`SELECT value FROM meta WHERE key = 'last_ai_trader_sync'`;
  const last = meta[0] ? Number(meta[0].value) : 0;
  if (Date.now() - last < THROTTLE_MS) return { skipped: true, ideated: null, runsConsidered: 0, betsPlaced: 0 };
  await sql`
    INSERT INTO meta (key, value) VALUES ('last_ai_trader_sync', ${String(Date.now())})
    ON CONFLICT (key) DO UPDATE SET value = ${String(Date.now())}
  `;

  const botId = await getBotId();
  const ideated = await ideateOne().catch(() => null);
  const { considered, placed } = await actOnRuns(botId);
  return { ideated, runsConsidered: considered, betsPlaced: placed };
}
