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
  { label: 'All',            keywords: [] as string[] },
  { label: '🗳️ Politics',    keywords: ['election', 'president', 'congress', 'senate', 'vote', 'democrat', 'republican', 'trump', 'biden', 'harris', 'legislation', 'impeach', 'primary', 'candidate', 'governor', 'mayor', 'ballot', 'approval rating', 'cabinet', 'veto', 'executive order', 'supreme court', 'justice', 'white house', 'parliament', 'prime minister'] },
  { label: '🌍 Geopolitics',  keywords: ['nato', 'united nations', 'sanctions', 'treaty', 'diplomatic', 'foreign policy', 'g7', 'g20', 'trade deal', 'tariff', 'taiwan', 'china', 'russia', 'north korea', 'iran', 'israel', 'middle east', 'european union', 'alliance', 'nuclear', 'embargo', 'annexation', 'geopolit', 'world leader', 'summit', 'strait', 'hormuz', 'persian gulf', 'red sea', 'south china sea', 'territorial', 'sovereignty', 'regime'] },
  { label: '⚔️ War',          keywords: ['war', 'invasion', 'military', 'troops', 'ceasefire', 'peace deal', 'conflict', 'offensive', 'missile', 'strike', 'bomb', 'combat', 'soldiers', 'army', 'navy', 'air force', 'occupation', 'resistance', 'rebel', 'siege', 'frontline', 'armistice', 'drone', 'weapons', 'ukraine', 'gaza', 'hamas', 'hezbollah', 'isis', 'insurgent', 'shelling', 'warship'] },
  { label: '💰 Economy',      keywords: ['federal reserve', 'interest rate', 'inflation', 'recession', 'gdp', 'unemployment', 'fed rate', 'fed cut', 'fed hike', 'fed increase', 'fed decrease', 'bps', 'basis point', 'tariff', 'trade war', 'debt ceiling', 'budget', 'deficit', 'dow jones', 'nasdaq', 's&p 500', 'stock market', 'ipo', 'central bank', 'imf', 'oil price', 'supply chain', 'layoffs'] },
  { label: '🔬 Science & AI', keywords: ['openai', 'gpt', 'claude', 'gemini', 'llm', 'artificial intelligence', 'nasa', 'spacex', 'space launch', 'climate change', 'global warming', 'fda approval', 'vaccine', 'cancer', 'crispr', 'quantum', 'nuclear fusion', 'elon musk', 'apple', 'google', 'microsoft', 'antitrust', 'aliens', 'extraterrestrial', 'pandemic', 'breakthrough'] },
  { label: '₿ Crypto',        keywords: ['bitcoin', 'ethereum', 'btc', 'eth', 'sol', 'crypto', 'blockchain', 'defi', 'nft', 'coinbase', 'binance', 'dogecoin', 'xrp', 'stablecoin', 'crypto regulation', 'sec crypto', 'halving', 'altcoin'] },
  { label: '🏆 Sports',       keywords: ['nba', 'nfl', 'mlb', 'nhl', 'fifa', 'world cup', 'premier league', 'champions league', 'serie a', 'bundesliga', 'la liga', 'soccer', 'basketball', 'baseball', 'tennis', 'golf', 'mma', 'ufc', 'boxing', 'olympics', 'super bowl', 'playoffs', 'grand slam', 'formula 1', 'f1', 'wimbledon', 'masters', 'open championship'] },
  { label: '🎮 Esports',      keywords: ['counter-strike', 'cs2', 'dota', 'league of legends', 'valorant', 'fortnite', 'starcraft', 'overwatch', 'esport', 'bo1', 'bo3', 'bo5', 'iem', 'esl', 'major ', 'blast', 'faceit', 'map veto'] },
  { label: '🎬 Pop Culture',   keywords: ['oscar', 'academy award', 'grammy', 'emmy', 'golden globe', 'album', 'box office', 'billboard', 'celebrity', 'taylor swift', 'beyoncé', 'beyonce', 'kanye', 'drake', 'rihanna', 'kardashian', 'netflix series', 'disney', 'marvel', 'viral', 'met gala', 'music video', 'tour', 'concert', 'award show', 'reality tv', 'super bowl halftime'] },
];

type SortValue = typeof SORT_OPTIONS[number]['value'];

function matchesCategory(market: Market, cat: typeof CATEGORIES[number]): boolean {
  if (cat.keywords.length === 0) return true;
  const text = market.question.toLowerCase();
  return cat.keywords.some(k => text.includes(k));
}

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

  const buildUrl = useCallback((query: string, sortVal: SortValue, off: number) => {
    const sortOpt = SORT_OPTIONS.find(s => s.value === sortVal)!;
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(off),
      order: sortVal,
      ascending: String(sortOpt.ascending),
    });
    if (query.trim()) params.set('q', query.trim());
    return `/api/markets?${params}`;
  }, []);

  const load = useCallback(async (query: string, sortVal: SortValue, off: number, reset: boolean) => {
    if (reset) { setLoading(true); setMarkets([]); }
    else setLoadingMore(true);

    const res = await fetch(buildUrl(query, sortVal, off));
    const incoming: Market[] = await res.json();

    if (reset) setMarkets(incoming);
    else setMarkets(prev => {
      // Deduplicate by id in case of overlap
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
    debounceRef.current = setTimeout(() => load(q, sort, 0, true), 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q, sort, load]);

  const sortOpt = SORT_OPTIONS.find(s => s.value === sort)!;
  const cat = CATEGORIES[category];
  const visible = markets.filter(m => matchesCategory(m, cat));

  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex flex-col gap-3 mb-6">
        <div className="flex flex-wrap gap-2 items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Markets</h1>
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
              onChange={e => { setSort(e.target.value as SortValue); setCategory(0); }}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map((c, i) => (
            <button
              key={c.label}
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
          {visible.length}{cat.label !== 'All' ? ` in ${cat.label}` : ''} of {markets.length} loaded
          {q ? ` · matching "${q}"` : ''} · {sortOpt.label}
        </p>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl h-52 animate-pulse" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-zinc-400 mb-2">No markets found</p>
          <p className="text-zinc-600 text-sm">Try a different search or category, or load more below</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {visible.map(m => <MarketCard key={m.id} market={m} />)}
        </div>
      )}

      {hasMore && !q && (
        <div className="flex flex-col items-center gap-2 mt-8">
          <button
            onClick={() => load(q, sort, offset, false)}
            disabled={loadingMore}
            className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 border border-zinc-700 text-white text-sm px-6 py-2.5 rounded-lg transition"
          >
            {loadingMore ? 'Loading…' : `Load more markets (${offset} loaded so far)`}
          </button>
          <p className="text-zinc-600 text-xs">Keep loading to access all available markets</p>
        </div>
      )}
    </main>
  );
}
