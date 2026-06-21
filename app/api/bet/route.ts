import { NextRequest, NextResponse } from 'next/server';
import { db, ensureSchema } from '@/lib/db';

interface BetRequest {
  username: string;
  marketId: string;
  marketQuestion: string;
  outcome: string;
  side: 'BUY' | 'SELL';
  amount: number;
  price: number;
}

export async function POST(req: NextRequest) {
  const body = await req.json() as BetRequest;
  const { username, marketId, marketQuestion, outcome, side, amount, price } = body;
  if (!username || !marketId || !outcome || !side || !amount || price == null)
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

  await ensureSchema();
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows: users } = await client.query(
      `SELECT * FROM users WHERE LOWER(username) = LOWER($1)`, [username]
    );
    const user = users[0] as { id: number; balance: number } | undefined;
    if (!user) { await client.query('ROLLBACK'); return NextResponse.json({ error: 'User not found' }, { status: 404 }); }

    if (side === 'BUY') {
      if (Number(user.balance) < amount) throw new Error('Insufficient balance');
      const shares = amount / price;

      await client.query(`UPDATE users SET balance = balance - $1 WHERE id = $2`, [amount, user.id]);
      await client.query(`
        INSERT INTO positions (user_id, market_id, market_question, outcome, shares, avg_price)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id, market_id, outcome) DO UPDATE SET
          avg_price = (positions.shares * positions.avg_price + excluded.shares * excluded.avg_price)
                      / (positions.shares + excluded.shares),
          shares = positions.shares + excluded.shares
      `, [user.id, marketId, marketQuestion, outcome, shares, price]);
      await client.query(`
        INSERT INTO trades (user_id, market_id, market_question, outcome, shares, price, side, amount)
        VALUES ($1, $2, $3, $4, $5, $6, 'BUY', $7)
      `, [user.id, marketId, marketQuestion, outcome, shares, price, amount]);

      await client.query('COMMIT');
      const { rows } = await client.query(`SELECT balance FROM users WHERE id = $1`, [user.id]);
      return NextResponse.json({ shares, cost: amount, newBalance: Number(rows[0].balance) });

    } else {
      const { rows: pos } = await client.query(
        `SELECT * FROM positions WHERE user_id = $1 AND market_id = $2 AND outcome = $3`,
        [user.id, marketId, outcome]
      );
      if (!pos[0] || Number(pos[0].shares) < amount) throw new Error('Not enough shares');
      const proceeds = amount * price;

      await client.query(`UPDATE users SET balance = balance + $1 WHERE id = $2`, [proceeds, user.id]);
      await client.query(
        `UPDATE positions SET shares = shares - $1 WHERE user_id = $2 AND market_id = $3 AND outcome = $4`,
        [amount, user.id, marketId, outcome]
      );
      await client.query(
        `DELETE FROM positions WHERE user_id = $1 AND market_id = $2 AND outcome = $3 AND shares <= 0.0001`,
        [user.id, marketId, outcome]
      );
      await client.query(`
        INSERT INTO trades (user_id, market_id, market_question, outcome, shares, price, side, amount)
        VALUES ($1, $2, $3, $4, $5, $6, 'SELL', $7)
      `, [user.id, marketId, marketQuestion, outcome, amount, price, proceeds]);

      await client.query('COMMIT');
      const { rows } = await client.query(`SELECT balance FROM users WHERE id = $1`, [user.id]);
      return NextResponse.json({ shares: amount, proceeds, newBalance: Number(rows[0].balance) });
    }
  } catch (e) {
    await client.query('ROLLBACK');
    return NextResponse.json({ error: String(e) }, { status: 400 });
  } finally {
    client.release();
  }
}
