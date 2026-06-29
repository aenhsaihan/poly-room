import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet');
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
  }

  const res = await fetch(
    `https://clob.polymarket.com/positions?user_address=${wallet}&size_threshold=0.01`,
    { headers: { 'Accept': 'application/json' }, next: { revalidate: 30 } }
  );

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to fetch positions' }, { status: 502 });
  }

  const data = await res.json();
  return NextResponse.json(data);
}
