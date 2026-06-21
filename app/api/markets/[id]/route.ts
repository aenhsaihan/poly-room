import { NextRequest, NextResponse } from 'next/server';
import { getMarket } from '@/lib/polymarket';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const market = await getMarket(id);
    return NextResponse.json(market);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 404 });
  }
}
