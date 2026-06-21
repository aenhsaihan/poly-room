import { NextRequest, NextResponse } from 'next/server';
import { getMarkets } from '@/lib/polymarket';
import type { MarketsQuery } from '@/lib/polymarket';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const opts: MarketsQuery = {
    q: p.get('q') ?? undefined,
    limit: Number(p.get('limit') ?? 40),
    offset: Number(p.get('offset') ?? 0),
    order: (p.get('order') ?? 'volume24hr') as MarketsQuery['order'],
    ascending: p.get('ascending') === 'true',
  };
  try {
    const markets = await getMarkets(opts);
    return NextResponse.json(markets);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
