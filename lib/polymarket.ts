const GAMMA = 'https://gamma-api.polymarket.com';

function getHeaders(): HeadersInit {
  const headers: Record<string, string> = {};
  if (process.env.POLYMARKET_API_KEY) headers['Authorization'] = `Bearer ${process.env.POLYMARKET_API_KEY}`;
  if (process.env.POLYMARKET_BUILDER_ID) headers['x-builder-id'] = process.env.POLYMARKET_BUILDER_ID;
  return headers;
}

export interface Market {
  id: string;
  question: string;
  outcomes: string[];
  outcomePrices: number[];
  volume: number;
  volume24hr: number;
  liquidity: number;
  endDate: string;
  active: boolean;
  closed: boolean;
  image?: string;
  description?: string;
  conditionId?: string;
  clobTokenIds: string[];
  eventId?: string;
  eventSlug?: string;
}

function parse(raw: Record<string, unknown>): Market {
  let outcomes: string[] = ['Yes', 'No'];
  let prices: number[] = [0.5, 0.5];
  let clobTokenIds: string[] = [];
  try { outcomes = JSON.parse(raw.outcomes as string); } catch {}
  try { prices = (JSON.parse(raw.outcomePrices as string) as string[]).map(Number); } catch {}
  try { clobTokenIds = JSON.parse(raw.clobTokenIds as string); } catch {}
  return {
    id: raw.id as string,
    question: raw.question as string,
    outcomes,
    outcomePrices: prices,
    volume: Number(raw.volume ?? 0),
    volume24hr: Number(raw.volume24hr ?? 0),
    liquidity: Number(raw.liquidity ?? 0),
    endDate: raw.endDate as string,
    active: Boolean(raw.active),
    closed: Boolean(raw.closed),
    image: raw.image as string | undefined,
    description: raw.description as string | undefined,
    conditionId: raw.conditionId as string | undefined,
    clobTokenIds,
    eventId: Array.isArray(raw.events) && raw.events[0] ? String((raw.events[0] as Record<string, unknown>).id) : undefined,
    eventSlug: Array.isArray(raw.events) && raw.events[0] ? String((raw.events[0] as Record<string, unknown>).slug) : undefined,
  };
}

// All market ids belonging to one event — used to detect same-event overlap
// (e.g. holding YES on two mutually exclusive tournament winners)
export async function getEventMarketIds(eventId: string): Promise<string[]> {
  const res = await fetch(`${GAMMA}/events/${eventId}`, { headers: getHeaders(), next: { revalidate: 300 } });
  if (!res.ok) return [];
  const data = await res.json() as { markets?: { id?: unknown }[] };
  if (!Array.isArray(data.markets)) return [];
  return data.markets.map(m => String(m.id)).filter(Boolean);
}

export interface MarketsQuery {
  q?: string;
  limit?: number;
  offset?: number;
  order?: 'volume' | 'volume24hr' | 'liquidity' | 'endDate' | 'startDate';
  ascending?: boolean;
  tagSlug?: string;
}

export async function getMarkets(opts: MarketsQuery = {}): Promise<Market[]> {
  const { q, limit = 40, offset = 0, order = 'volume24hr', ascending = false, tagSlug } = opts;

  if (tagSlug) {
    return getMarketsByTag(tagSlug, { limit, offset, order, ascending, q });
  }

  // Polymarket stores volume/liquidity as strings; use the numeric variants for correct sort
  const apiOrder = order === 'volume' ? 'volumeNum'
    : order === 'liquidity' ? 'liquidityNum'
    : order;

  const params = new URLSearchParams({
    active: 'true', closed: 'false',
    limit: String(Math.min(limit, 100)),
    offset: String(offset),
    order: apiOrder, ascending: String(ascending),
  });
  if (q) params.set('q', q);
  // For "Ending Soon", exclude markets whose end date has already passed but aren't resolved yet
  if (order === 'endDate' && ascending) {
    params.set('end_date_min', new Date().toISOString().slice(0, 10));
  }
  const res = await fetch(`${GAMMA}/markets?${params}`, {
    headers: getHeaders(),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Gamma API ${res.status}`);
  const data = await res.json() as Record<string, unknown>[];
  return data.map(parse);
}

async function getMarketsByTag(tagSlug: string, opts: {
  limit: number; offset: number; order: string; ascending: boolean; q?: string;
}): Promise<Market[]> {
  const { limit, offset, order, ascending, q } = opts;

  // Map our sort options to event-level equivalents
  const eventOrder = order === 'endDate' ? 'endDate'
    : order === 'startDate' ? 'startDate'
    : order === 'volume24hr' ? 'volume24hr'
    : 'volume';

  // Fetch enough events to cover offset+limit (events average ~10 active markets each)
  const eventLimit = Math.min(100, Math.max(30, Math.ceil((offset + limit) / 8)));
  const params = new URLSearchParams({
    active: 'true', closed: 'false',
    tag_slug: tagSlug,
    limit: String(eventLimit),
    order: eventOrder,
    ascending: String(ascending),
  });

  const res = await fetch(`${GAMMA}/events?${params}`, {
    headers: getHeaders(),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Gamma events API ${res.status}`);
  const events = await res.json() as Record<string, unknown>[];

  // Flatten active markets from all events
  const all: Market[] = [];
  for (const event of events) {
    const markets = (event.markets as Record<string, unknown>[]) ?? [];
    for (const m of markets) {
      if (!m.active || m.closed || m.archived) continue;
      if (q && !String(m.question ?? '').toLowerCase().includes(q.toLowerCase())) continue;
      all.push(parse(m));
    }
  }

  // Sort within the flattened pool
  all.sort((a, b) => {
    let va = 0, vb = 0;
    if (order === 'endDate') { va = new Date(a.endDate).getTime(); vb = new Date(b.endDate).getTime(); }
    else if (order === 'startDate') { va = new Date(a.endDate).getTime(); vb = new Date(b.endDate).getTime(); }
    else if (order === 'liquidity') { va = a.liquidity; vb = b.liquidity; }
    else if (order === 'volume24hr') { va = a.volume24hr; vb = b.volume24hr; }
    else { va = a.volume; vb = b.volume; }
    return ascending ? va - vb : vb - va;
  });

  return all.slice(offset, offset + limit);
}

export interface PricePoint { t: number; p: number }

// CLOB price history — same data poly_data reconstructs from chain, served hosted
export async function getPriceHistory(clobTokenId: string, interval: '1d' | '1w' | '1m' | 'max' = '1w'): Promise<PricePoint[]> {
  const fidelity = { '1d': 5, '1w': 60, '1m': 180, 'max': 720 }[interval];
  const res = await fetch(
    `https://clob.polymarket.com/prices-history?market=${clobTokenId}&interval=${interval}&fidelity=${fidelity}`,
    { next: { revalidate: 60 } }
  );
  if (!res.ok) return [];
  const data = await res.json() as { history?: PricePoint[] };
  return data.history ?? [];
}

export interface RealTrade {
  side: 'BUY' | 'SELL';
  outcome: string;
  size: number;
  price: number;
  timestamp: number;
  name: string;
  pseudonym: string;
  proxyWallet: string;
  transactionHash: string;
}

// Data API trade feed — the per-market equivalent of poly_data's processed/trades.csv
export async function getRealTrades(conditionId: string, limit = 30): Promise<RealTrade[]> {
  const res = await fetch(
    `https://data-api.polymarket.com/trades?market=${conditionId}&limit=${limit}`,
    { cache: 'no-store' }
  );
  if (!res.ok) return [];
  const data = await res.json() as Record<string, unknown>[];
  if (!Array.isArray(data)) return [];
  return data.map(t => ({
    side: t.side as 'BUY' | 'SELL',
    outcome: t.outcome as string,
    size: Number(t.size ?? 0),
    price: Number(t.price ?? 0),
    timestamp: Number(t.timestamp ?? 0),
    name: (t.name as string) || (t.pseudonym as string) || 'anon',
    pseudonym: (t.pseudonym as string) || '',
    proxyWallet: (t.proxyWallet as string) || '',
    transactionHash: t.transactionHash as string,
  }));
}

export interface WalletTrade {
  conditionId: string;
  title: string;
  side: 'BUY' | 'SELL';
  outcome: string;
  size: number;
  price: number;
  timestamp: number;
}

export interface TraderSearchResult {
  name: string;
  wallet: string;
}

// Find any Polymarket account by (partial) username — the escape hatch for
// traders who aren't in the fixed top-N leaderboard snapshot.
export async function searchTraders(query: string, limit = 8): Promise<TraderSearchResult[]> {
  const res = await fetch(
    `${GAMMA}/public-search?q=${encodeURIComponent(query)}&search_profiles=1`,
    { headers: getHeaders(), cache: 'no-store' }
  );
  if (!res.ok) return [];
  const data = await res.json() as { profiles?: Record<string, unknown>[] };
  if (!Array.isArray(data.profiles)) return [];
  return data.profiles
    .filter(p => typeof p.proxyWallet === 'string' && /^0x[0-9a-fA-F]{40}$/.test(p.proxyWallet as string))
    .slice(0, limit)
    .map(p => ({
      name: String(p.name || p.pseudonym || shortWallet(String(p.proxyWallet))),
      wallet: String(p.proxyWallet).toLowerCase(),
    }));
}

// Current value of a wallet's open Polymarket positions.
// Note: this is at-risk capital only — idle USDC cash isn't visible on the
// Data API, so proportional copy sizing uses positions value as the denominator.
export async function getWalletPositionsValue(wallet: string): Promise<number> {
  const res = await fetch(`https://data-api.polymarket.com/value?user=${wallet}`, { cache: 'no-store' });
  if (!res.ok) return 0;
  const data = await res.json() as { value?: number }[];
  return Number(data?.[0]?.value ?? 0);
}

// All recent trades by one wallet — the primitive copy-trading is built on
// (same Data API surface polybot's PolymarketDataApiClient wraps)
export async function getWalletTrades(wallet: string, limit = 40): Promise<WalletTrade[]> {
  const res = await fetch(
    `https://data-api.polymarket.com/trades?user=${wallet}&limit=${limit}`,
    { cache: 'no-store' }
  );
  if (!res.ok) return [];
  const data = await res.json() as Record<string, unknown>[];
  if (!Array.isArray(data)) return [];
  return data.map(t => ({
    conditionId: t.conditionId as string,
    title: (t.title as string) || '',
    side: t.side as 'BUY' | 'SELL',
    outcome: t.outcome as string,
    size: Number(t.size ?? 0),
    price: Number(t.price ?? 0),
    timestamp: Number(t.timestamp ?? 0),
  }));
}

export interface TopTrader {
  rank: number;
  wallet: string;
  name: string;
  pnl: number;
  volume: number;
  profileImage: string;
}

export function shortWallet(w: string) {
  return w.length > 10 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w;
}

export async function getWorstTraders(limit = 20): Promise<TopTrader[]> {
  // Mine recently resolved markets: find wallets that bought the losing outcome
  const closedRes = await fetch(
    `${GAMMA}/markets?closed=true&active=false&limit=50&order=volumeNum&ascending=false`,
    { headers: getHeaders(), next: { revalidate: 300 } }
  );
  if (!closedRes.ok) return [];
  let closedData: Record<string, unknown>[];
  try { closedData = await closedRes.json() as Record<string, unknown>[]; } catch { return []; }
  if (!Array.isArray(closedData)) return [];

  // Find definitively resolved markets (one outcome at 1, other at 0) with a conditionId
  const resolved = closedData
    .map(raw => {
      try {
        const m = parse(raw);
        const loserIdx = m.outcomePrices.findIndex(p => p <= 0.01);
        const winnerIdx = m.outcomePrices.findIndex(p => p >= 0.99);
        if (loserIdx < 0 || winnerIdx < 0 || !m.conditionId) return null;
        return { conditionId: m.conditionId, losingOutcome: m.outcomes[loserIdx] };
      } catch { return null; }
    })
    .filter((x): x is { conditionId: string; losingOutcome: string } => x !== null)
    .slice(0, 20);

  if (resolved.length === 0) return [];

  // Fetch trades from each resolved market in parallel, collect wallets on losing side
  const tradeSets = await Promise.all(
    resolved.map(async ({ conditionId, losingOutcome }) => {
      const trades = await getRealTrades(conditionId, 100);
      return trades
        .filter(t => t.side === 'BUY' && t.outcome.toLowerCase() === losingOutcome.toLowerCase())
        .map(t => ({ wallet: t.proxyWallet, loss: t.size * t.price }));
    })
  );

  // Aggregate total losses by wallet
  const lossMap = new Map<string, number>();
  for (const set of tradeSets) {
    for (const { wallet, loss } of set) {
      if (!wallet) continue;
      lossMap.set(wallet, (lossMap.get(wallet) ?? 0) + loss);
    }
  }

  return [...lossMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([wallet, totalLoss], i) => ({
      rank: i + 1,
      wallet,
      name: shortWallet(wallet),
      pnl: -totalLoss,
      volume: totalLoss,
      profileImage: '',
    }));
}

export async function getTopTraders(limit = 20): Promise<TopTrader[]> {
  const res = await fetch(
    `https://data-api.polymarket.com/v1/leaderboard?rankType=pnl&limit=${limit}`,
    { next: { revalidate: 300 } }
  );
  if (!res.ok) return [];
  const data = await res.json() as Record<string, unknown>[];
  if (!Array.isArray(data)) return [];
  return data.map(t => {
    const wallet = (t.proxyWallet as string) || '';
    const raw = (t.userName as string) || '';
    // some accounts have no username or a wallet-derived one — show a short wallet instead
    const name = raw && !raw.startsWith('0x') ? raw : shortWallet(wallet);
    return {
      rank: Number(t.rank ?? 0),
      wallet,
      name,
      pnl: Number(t.pnl ?? 0),
      volume: Number(t.vol ?? 0),
      profileImage: (t.profileImage as string) || '',
    };
  });
}

export async function getMarketByConditionId(conditionId: string): Promise<Market | null> {
  const res = await fetch(`${GAMMA}/markets?condition_ids=${conditionId}`, {
    headers: getHeaders(),
    next: { revalidate: 300 },
  });
  if (!res.ok) return null;
  const data = await res.json() as Record<string, unknown>[];
  return Array.isArray(data) && data[0] ? parse(data[0]) : null;
}

export async function getMarket(id: string): Promise<Market> {
  const res = await fetch(`${GAMMA}/markets/${id}`, {
    headers: getHeaders(),
    next: { revalidate: 30 },
  });
  if (!res.ok) throw new Error(`Market not found: ${id}`);
  return parse(await res.json() as Record<string, unknown>);
}
