import { NextRequest, NextResponse } from 'next/server';
import { getWalletTrades, getTopTraders } from '@/lib/polymarket';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;

  const [trades, topTraders] = await Promise.all([
    getWalletTrades(wallet, 50).catch(() => []),
    getTopTraders(100).catch(() => []),
  ]);

  const info = topTraders.find(t => t.wallet.toLowerCase() === wallet.toLowerCase());

  const buys = trades.filter(t => t.side === 'BUY');
  const sells = trades.filter(t => t.side === 'SELL');
  const yesBuys = buys.filter(t => t.outcome.toLowerCase() === 'yes');

  const avgBuySize = buys.length > 0
    ? buys.reduce((s, t) => s + t.size * t.price, 0) / buys.length
    : 0;

  const avgBuyPrice = buys.length > 0
    ? buys.reduce((s, t) => s + t.price, 0) / buys.length
    : 0;

  const marketCounts: Record<string, { title: string; count: number }> = {};
  for (const t of trades) {
    if (!marketCounts[t.conditionId]) marketCounts[t.conditionId] = { title: t.title, count: 0 };
    marketCounts[t.conditionId].count++;
  }
  const topMarkets = Object.values(marketCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const mostRecentAt = trades.length > 0 ? Math.max(...trades.map(t => t.timestamp)) : null;

  return NextResponse.json({
    wallet,
    name: info?.name ?? null,
    rank: info?.rank ?? null,
    pnl: info?.pnl ?? null,
    volume: info?.volume ?? null,
    profileImage: info?.profileImage ?? null,
    trades,
    stats: {
      totalTrades: trades.length,
      buyCount: buys.length,
      sellCount: sells.length,
      yesBuyPct: buys.length > 0 ? (yesBuys.length / buys.length) * 100 : null,
      avgBuySize,
      avgBuyPrice,
      topMarkets,
      mostRecentAt,
    },
  });
}
