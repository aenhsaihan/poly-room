import { NextRequest, NextResponse } from 'next/server';
import { getWalletTrades } from '@/lib/polymarket';

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet');
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
  }

  const [posRes, valRes, trades] = await Promise.all([
    fetch(
      `https://data-api.polymarket.com/positions?user=${wallet}&sizeThreshold=0.1&limit=100&sortBy=CURRENT&sortDirection=DESC`,
      { headers: { Accept: 'application/json' }, next: { revalidate: 30 } }
    ),
    fetch(`https://data-api.polymarket.com/value?user=${wallet}`, {
      headers: { Accept: 'application/json' }, next: { revalidate: 30 },
    }),
    getWalletTrades(wallet, 25).catch(() => []),
  ]);

  if (!posRes.ok) {
    return NextResponse.json({ error: 'Failed to fetch positions' }, { status: 502 });
  }

  const raw = (await posRes.json()) as Record<string, unknown>[];
  const positions = (Array.isArray(raw) ? raw : []).map(p => ({
    title: String(p.title ?? ''),
    outcome: String(p.outcome ?? 'Yes'),
    size: Number(p.size ?? 0),
    avgPrice: Number(p.avgPrice ?? 0),
    curPrice: Number(p.curPrice ?? 0),
    currentValue: Number(p.currentValue ?? 0),
    initialValue: Number(p.initialValue ?? 0),
    cashPnl: Number(p.cashPnl ?? 0),
    percentPnl: Number(p.percentPnl ?? 0),
    realizedPnl: Number(p.realizedPnl ?? 0),
    redeemable: Boolean(p.redeemable),
    eventSlug: String(p.eventSlug ?? ''),
    icon: p.icon ? String(p.icon) : null,
  }));

  let value = 0;
  if (valRes.ok) {
    try {
      const v = (await valRes.json()) as { value?: number }[];
      value = Number(v?.[0]?.value ?? 0);
    } catch { /* keep 0 */ }
  }

  return NextResponse.json({ value, positions, trades });
}
