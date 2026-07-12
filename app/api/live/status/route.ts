import { NextResponse } from 'next/server';
import { getBotStatus } from '@/lib/clob';

export const maxDuration = 30;

export async function GET() {
  try {
    const status = await getBotStatus();
    return NextResponse.json(status);
  } catch (e) {
    return NextResponse.json({
      configured: false,
      error: e instanceof Error ? e.message : 'status check failed',
    }, { status: 500 });
  }
}
