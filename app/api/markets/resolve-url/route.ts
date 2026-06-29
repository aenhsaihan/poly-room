import { NextRequest, NextResponse } from 'next/server';
import { getMarket } from '@/lib/polymarket';

const GAMMA = 'https://gamma-api.polymarket.com';

function parsePolymarketUrl(raw: string): { eventSlug: string | null; marketSlug: string | null } {
  try {
    const url = new URL(raw.trim());
    const parts = url.pathname.replace(/^\/|\/$/g, '').split('/');
    // /event/{eventSlug}/{marketSlug}  or  /event/{eventSlug}
    if (parts[0] === 'event' && parts.length >= 3) {
      return { eventSlug: parts[1], marketSlug: parts[2] };
    }
    if (parts[0] === 'event' && parts.length === 2) {
      return { eventSlug: parts[1], marketSlug: null };
    }
    // /market/{slug}
    if (parts[0] === 'market' && parts.length >= 2) {
      return { eventSlug: null, marketSlug: parts[1] };
    }
    // fallback: treat last segment as market slug
    return { eventSlug: null, marketSlug: parts[parts.length - 1] };
  } catch {
    return { eventSlug: null, marketSlug: null };
  }
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'url param required' }, { status: 400 });

  const { eventSlug, marketSlug } = parsePolymarketUrl(url);
  if (!marketSlug && !eventSlug) {
    return NextResponse.json({ error: 'Could not parse Polymarket URL' }, { status: 400 });
  }

  // Strategy 1: exact slug match
  if (marketSlug) {
    const r1 = await fetch(`${GAMMA}/markets?slug=${encodeURIComponent(marketSlug)}`);
    if (r1.ok) {
      const d1 = await r1.json() as { id: string }[];
      if (d1.length) {
        const market = await getMarket(d1[0].id);
        return NextResponse.json(market);
      }
    }
  }

  // Strategy 2: fetch event, prefix-match the market slug within it
  if (eventSlug) {
    const r2 = await fetch(`${GAMMA}/events?slug=${encodeURIComponent(eventSlug)}`);
    if (r2.ok) {
      const events = await r2.json() as { markets?: { id: string; slug: string }[] }[];
      const event = events[0];
      if (event?.markets?.length) {
        // If we have a marketSlug, prefix-match; otherwise return the first active market
        const match = marketSlug
          ? event.markets.find(m => m.slug.startsWith(marketSlug))
          : event.markets[0];
        if (match) {
          const market = await getMarket(match.id);
          return NextResponse.json(market);
        }
      }
    }
  }

  return NextResponse.json({ error: 'Market not found for this URL' }, { status: 404 });
}
