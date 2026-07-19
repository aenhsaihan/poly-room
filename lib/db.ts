import { sql, db } from '@vercel/postgres';

export async function ensureSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      balance NUMERIC(12,4) NOT NULL DEFAULT 100000.0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS positions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      market_id TEXT NOT NULL,
      market_question TEXT NOT NULL,
      outcome TEXT NOT NULL,
      shares NUMERIC(16,6) NOT NULL DEFAULT 0,
      avg_price NUMERIC(10,6) NOT NULL DEFAULT 0,
      UNIQUE(user_id, market_id, outcome)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS trades (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      market_id TEXT NOT NULL,
      market_question TEXT NOT NULL,
      outcome TEXT NOT NULL,
      shares NUMERIC(16,6) NOT NULL,
      price NUMERIC(10,6) NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('BUY','SELL')),
      amount NUMERIC(12,4) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      market_id TEXT NOT NULL,
      username TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS comments_market_id_idx ON comments(market_id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id SERIAL PRIMARY KEY,
      market_id TEXT NOT NULL,
      market_question TEXT NOT NULL,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      rating TEXT NOT NULL,
      conviction INTEGER NOT NULL,
      yes_price NUMERIC(10,6) NOT NULL,
      report JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS agent_runs_market_idx ON agent_runs(market_id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS follows (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      wallet TEXT NOT NULL,
      trader_name TEXT NOT NULL,
      copy_amount NUMERIC(10,2) NOT NULL DEFAULT 10,
      last_synced_ts BIGINT NOT NULL DEFAULT 0,
      last_synced_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, wallet)
    )
  `;
  await sql`ALTER TABLE trades ADD COLUMN IF NOT EXISTS copied_from TEXT`;
  await sql`ALTER TABLE follows ADD COLUMN IF NOT EXISTS copy_pct NUMERIC(5,2) NOT NULL DEFAULT 100`;
  await sql`ALTER TABLE follows ADD COLUMN IF NOT EXISTS trail_pct NUMERIC(5,2)`;
  await sql`ALTER TABLE follows ADD COLUMN IF NOT EXISTS peak_pnl NUMERIC(14,4) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE follows ADD COLUMN IF NOT EXISTS last_pnl NUMERIC(14,4)`;
  await sql`ALTER TABLE follows ADD COLUMN IF NOT EXISTS stopped_at TIMESTAMPTZ`;
  await sql`ALTER TABLE follows ADD COLUMN IF NOT EXISTS stopped_pnl NUMERIC(14,4)`;
  await sql`ALTER TABLE follows ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'pct'`;
  await sql`ALTER TABLE follows ADD COLUMN IF NOT EXISTS allocation NUMERIC(12,4)`;
  await sql`
    CREATE TABLE IF NOT EXISTS tickets (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'bug',
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      ai_response TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS stop_losses (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      market_id TEXT NOT NULL,
      market_question TEXT NOT NULL,
      outcome TEXT NOT NULL,
      trail_pct NUMERIC(5,2) NOT NULL DEFAULT 10,
      peak_price NUMERIC(10,6) NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      triggered_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, market_id, outcome)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS strategies (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      rules TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT false,
      status TEXT NOT NULL DEFAULT 'pending',
      ai_review TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS live_trades (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      market_id TEXT NOT NULL,
      market_question TEXT NOT NULL,
      outcome TEXT NOT NULL,
      token_id TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('BUY','SELL')),
      amount NUMERIC(12,4) NOT NULL,
      price NUMERIC(10,6),
      order_id TEXT,
      status TEXT NOT NULL,
      raw JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS backtests (
      id SERIAL PRIMARY KEY,
      username TEXT,
      kind TEXT NOT NULL DEFAULT 'trader',
      subject TEXT NOT NULL,
      params JSONB NOT NULL,
      result JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `;

  // One-time migration to $100k books (ticket #9): the CREATE above only
  // sets the default for fresh databases, and existing accounts need the
  // uniform +$99k top-up that preserves everyone's P&L exactly
  // (new total − 100000 ≡ old total − 1000). Transaction + meta guard so
  // concurrent requests can't double-credit.
  await sql`ALTER TABLE users ALTER COLUMN balance SET DEFAULT 100000.0`;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO meta (key, value) VALUES ('balance_migration_100k', 'applied')
       ON CONFLICT (key) DO NOTHING RETURNING key`
    );
    if (rows.length > 0) {
      await client.query(`UPDATE users SET balance = balance + 99000`);
    }
    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
}

export { sql, db };
