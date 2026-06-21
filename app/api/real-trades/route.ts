import { NextRequest, NextResponse } from 'next/server';
import { getRealTrades } from '@/lib/polymarket';

export async function GET(req: NextRequest) {
  const conditionId = req.nextUrl.searchParams.get('conditionId');
  if (!conditionId) return NextResponse.json({ error: 'conditionId required' }, { status: 400 });
  return NextResponse.json(await getRealTrades(conditionId, 30));
}
