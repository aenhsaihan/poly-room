import { sql, db } from '@vercel/postgres';

export async function ensureSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      balance NUMERIC(12,4) NOT NULL DEFAULT 1000.0,
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
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `;
}

export { sql, db };
