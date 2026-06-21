import { NextResponse } from 'next/server';
import { getWorstTraders, getWalletTrades } from '@/lib/polymarket';

export async function GET() {
  const traders = await getWorstTraders(20);

  const enriched = await Promise.all(
    traders.map(async t => {
      try {
        const trades = await getWalletTrades(t.wallet, 30);
        const buys = trades.filter(x => x.side === 'BUY');
        const avgBuySize = buys.length > 0
          ? buys.reduce((s, x) => s + x.size * x.price, 0) / buys.length
          : null;
        return { ...t, avgBuySize };
      } catch {
        return { ...t, avgBuySize: null };
      }
    })
  );

  return NextResponse.json(enriched);
}
