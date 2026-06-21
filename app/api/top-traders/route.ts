import { NextResponse } from 'next/server';
import { getTopTraders } from '@/lib/polymarket';

export async function GET() {
  return NextResponse.json(await getTopTraders(20));
}
