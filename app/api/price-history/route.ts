import { NextRequest, NextResponse } from 'next/server';
import { getPriceHistory } from '@/lib/polymarket';

export async function GET(req: NextRequest) {
  const tokenId = req.nextUrl.searchParams.get('tokenId');
  const interval = (req.nextUrl.searchParams.get('interval') ?? '1w') as '1d' | '1w' | '1m' | 'max';
  if (!tokenId) return NextResponse.json({ error: 'tokenId required' }, { status: 400 });
  if (!['1d', '1w', '1m', 'max'].includes(interval))
    return NextResponse.json({ error: 'invalid interval' }, { status: 400 });
  return NextResponse.json(await getPriceHistory(tokenId, interval));
}
