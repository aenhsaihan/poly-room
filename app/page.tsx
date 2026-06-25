'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import type { Market } from '@/lib/polymarket';
import MarketCard from './components/MarketCard';

const SORT_OPTIONS = [
  { value: 'volume24hr', label: '🔥 Trending', ascending: false },
  { value: 'volume',     label: '💰 Top Volume', ascending: false },
  { value: 'liquidity',  label: '💧 Most Liquid', ascending: false },
  { value: 'endDate',    label: '⏰ Ending Soon', ascending: true },
  { value: 'startDate',  label: '🆕 Newest', ascending: false },
] as const;

const CATEGORIES = [
  { label: 'All',           tagSlug: '' },
  { label: '🗳️ Politics',   tagSlug: 'politics' },
  { label: '🌍 Geopolitics', tagSlug: 'geopolitics' },
  { label: '⚔️ War',         tagSlug: 'war' },
  { label: '💰 Economy',     tagSlug: 'economy' },
  { label: '🔬 Science',     tagSlug: 'science' },
  { label: '💻 Tech',        tagSlug: 'technology' },
  { label: '₿ Crypto',       tagSlug: 'crypto' },
  { label: '🏆 Sports',      tagSlug: 'sports' },
  { label: '⚽ Soccer',      tagSlug: 'soccer' },
  { label: '🏀 NBA',         tagSlug: 'nba' },
  { label: '🏈 NFL',         tagSlug: 'nfl' },
  { label: '⚾ MLB',         tagSlug: 'mlb' },
  { label: '🏒 NHL',         tagSlug: 'nhl' },
  { label: '🎮 Esports',     tagSlug: 'esports' },
  { label: '🎬 Pop Culture', tagSlug: 'pop-culture' },
];

type SortValue = typeof SORT_OPTIONS[number]['value'];

const PAGE_SIZE = 40;

export default function MarketsPage() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortValue>('volume24hr');
  const [category, setCategory] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildUrl = useCallback((query: string, sortVal: SortValue, off: number, catIdx: number) => {
    const sortOpt = SORT_OPTIONS.find(s => s.value === sortVal)!;
    const cat = CATEGORIES[catIdx];
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(off),
      order: sortVal,
      ascending: String(sortOpt.ascending),
    });
    if (query.trim()) params.set('q', query.trim());
    if (cat.tagSlug) params.set('tagSlug', cat.tagSlug);
    return `/api/markets?${params}`;
  }, []);

  const load = useCallback(async (query: string, sortVal: SortValue, off: number, catIdx: number, reset: boolean) => {
    if (reset) { setLoading(true); setMarkets([]); }
    else setLoadingMore(true);

    const res = await fetch(buildUrl(query, sortVal, off, catIdx));
    const incoming: Market[] = await res.json();

    if (reset) setMarkets(incoming);
    else setMarkets(prev => {
      const seen = new Set(prev.map(m => m.id));
      return [...prev, ...incoming.filter(m => !seen.has(m.id))];
    });

    const nextOffset = off + incoming.length;
    setOffset(nextOffset);
    setHasMore(incoming.length === PAGE_SIZE);
    setLoading(false);
    setLoadingMore(false);
  }, [buildUrl]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(q, sort, 0, category, true), 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q, sort, category, load]);

  const sortOpt = SORT_OPTIONS.find(s => s.value === sort)!;
  const cat = CATEGORIES[category];

  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex flex-col gap-3 mb-6">
        <div className="flex flex-wrap gap-2 items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Markets 🚀</h1>
          <div className="flex gap-2 items-center">
            <div className="relative">
              <input
                className="bg-zinc-800 border border-zinc-700 rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 w-56"
                placeholder="Search markets..."
                value={q}
                onChange={e => setQ(e.target.value)}
              />
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 text-xs">🔍</span>
              {q && <button onClick={() => setQ('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white text-xs">✕</button>}
            </div>
            <select
              value={sort}
              onChange={e => setSort(e.target.value as SortValue)}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map((c, i) => (
            <button
              key={c.tagSlug || 'all'}
              onClick={() => setCategory(i)}
              className={`text-xs px-3 py-1 rounded-full border transition font-medium ${
                category === i
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {!loading && (
        <p className="text-zinc-500 text-xs mb-4">
          {markets.length}{cat.label !== 'All' ? ` in ${cat.label}` : ''} loaded
          {q ? ` · matching "${q}"` : ''} · {sortOpt.label}
        </p>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl h-52 animate-pulse" />
          ))}
        </div>
      ) : markets.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-zinc-400 mb-2">No markets found</p>
          <p className="text-zinc-600 text-sm">Try a different search or category</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {markets.map(m => <MarketCard key={m.id} market={m} />)}
        </div>
      )}

      {hasMore && (
        <div className="flex flex-col items-center gap-2 mt-8">
          <button
            onClick={() => load(q, sort, offset, category, false)}
            disabled={loadingMore}
            className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 border border-zinc-700 text-white text-sm px-6 py-2.5 rounded-lg transition"
          >
            {loadingMore ? 'Loading…' : `Load more (${markets.length} loaded so far)`}
          </button>
        </div>
      )}
    </main>
  );
}
