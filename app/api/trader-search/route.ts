import { NextRequest, NextResponse } from 'next/server';
import { searchTraders } from '@/lib/polymarket';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q || q.length < 2) return NextResponse.json([]);

  // Pasting a wallet address directly also works
  if (/^0x[0-9a-fA-F]{40}$/.test(q)) {
    return NextResponse.json([{ name: `${q.slice(0, 6)}…${q.slice(-4)}`, wallet: q.toLowerCase() }]);
  }

  const results = await searchTraders(q).catch(() => []);
  return NextResponse.json(results);
}
