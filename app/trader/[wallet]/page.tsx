'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useUser } from '../../components/UserProvider';
import FollowModal from '../../components/FollowModal';
import type { WalletTrade } from '@/lib/polymarket';

interface Stats {
  totalTrades: number;
  buyCount: number;
  sellCount: number;
  yesBuyPct: number | null;
  avgBuySize: number;
  avgBuyPrice: number;
  topMarkets: { title: string; count: number }[];
  mostRecentAt: number | null;
}

interface TraderData {
  wallet: string;
  name: string | null;
  rank: number | null;
  pnl: number | null;
  volume: number | null;
  profileImage: string | null;
  trades: WalletTrade[];
  stats: Stats;
}

interface Intel {
  style: string;
  patterns: string[];
  watchouts: string[];
  verdict: string;
  narrator: string;
}

function timeAgo(unix: number) {
  const s = Math.floor(Date.now() / 1000 - unix);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fmtUsd(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export default function TraderPage({ params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = use(params);
  const { username } = useUser();

  const [data, setData] = useState<TraderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [intel, setIntel] = useState<Intel | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [intelError, setIntelError] = useState<string | null>(null);
  const [modal, setModal] = useState(false);

  useEffect(() => {
    fetch(`/api/trader/${wallet}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [wallet]);

  async function runIntel() {
    if (!data) return;
    setAnalyzing(true);
    setIntelError(null);
    try {
      const res = await fetch(`/api/trader/${wallet}/intel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trades: data.trades, stats: data.stats, name: data.name }),
      });
      if (!res.ok) throw new Error('failed');
      setIntel(await res.json());
    } catch {
      setIntelError('Analysis failed — try again in a moment.');
    }
    setAnalyzing(false);
  }

  const shortWallet = `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
  const displayName = data?.name || shortWallet;

  if (loading) return (
    <main className="max-w-3xl mx-auto px-4 py-8 space-y-4">
      <div className="h-6 bg-zinc-800 rounded animate-pulse w-32" />
      <div className="h-24 bg-zinc-900 rounded-2xl animate-pulse" />
      <div className="h-64 bg-zinc-900 rounded-2xl animate-pulse" />
    </main>
  );

  if (!data) return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/copy" className="text-zinc-500 hover:text-white text-sm transition">← Copy Trading</Link>
      <p className="text-zinc-400 mt-4">Trader not found.</p>
    </main>
  );

  const { stats, trades } = data;

  return (
    <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <Link href="/copy" className="text-zinc-500 hover:text-white text-sm transition inline-block">← Copy Trading</Link>

      {/* Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            {data.profileImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.profileImage} alt="" className="w-12 h-12 rounded-full object-cover bg-zinc-800 flex-shrink-0"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            ) : (
              <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 text-lg flex-shrink-0">
                {displayName[0]?.toUpperCase() ?? '?'}
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-white">{displayName}</h1>
                {data.rank && (
                  <span className="text-xs bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded-full font-mono">#{data.rank}</span>
                )}
              </div>
              <p className="text-zinc-600 text-xs font-mono mt-0.5">{shortWallet}</p>
            </div>
          </div>
          {username && (
            <button
              onClick={() => setModal(true)}
              className="text-sm bg-blue-600 hover:bg-blue-500 text-white font-semibold px-4 py-2 rounded-xl transition"
            >
              ⧉ Copy Trader
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          {data.pnl != null && (
            <StatChip label="Real P&L" value={`+${fmtUsd(data.pnl)}`} color="text-green-400" />
          )}
          {data.volume != null && (
            <StatChip label="Volume" value={fmtUsd(data.volume)} />
          )}
          <StatChip label="Trades (sample)" value={String(stats.totalTrades)} />
          {stats.yesBuyPct != null && (
            <StatChip
              label="YES bet rate"
              value={`${stats.yesBuyPct.toFixed(0)}%`}
              color={stats.yesBuyPct > 60 ? 'text-green-400' : stats.yesBuyPct < 40 ? 'text-red-400' : 'text-white'}
            />
          )}
          <StatChip label="Avg buy size" value={`$${stats.avgBuySize.toFixed(0)}`} />
          <StatChip
            label="Avg entry price"
            value={`${(stats.avgBuyPrice * 100).toFixed(0)}¢`}
            sub="lower = more contrarian"
          />
          {stats.mostRecentAt && (
            <StatChip label="Last active" value={timeAgo(stats.mostRecentAt)} />
          )}
        </div>
      </div>

      {/* Trader Intel */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <span className="text-white font-semibold">🤖 Trader Intel</span>
          <button
            onClick={runIntel}
            disabled={analyzing}
            className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold px-4 py-1.5 rounded-lg transition"
          >
            {analyzing ? 'Analyzing…' : intel ? 'Re-analyze' : 'Analyze'}
          </button>
        </div>

        <div className="p-5">
          {!intel && !analyzing && !intelError && (
            <p className="text-zinc-400 text-sm leading-relaxed">
              Analyze this trader&apos;s last {stats.totalTrades} trades to understand their style, patterns, and what to watch out for when copying them.
            </p>
          )}
          {analyzing && (
            <div className="flex items-center gap-2 text-sm text-blue-300">
              <span className="inline-block h-3 w-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
              Reading their trading patterns…
            </div>
          )}
          {intelError && <p className="text-red-400 text-sm">{intelError}</p>}

          {intel && (
            <div className="space-y-5">
              <div>
                <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-2">Trading Style</p>
                <p className="text-zinc-200 text-sm leading-relaxed">{intel.style}</p>
              </div>

              <div>
                <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-3">Patterns</p>
                <ul className="space-y-2">
                  {intel.patterns?.map((p, i) => (
                    <li key={i} className="flex gap-2 text-sm text-zinc-300 leading-relaxed">
                      <span className="text-blue-400 flex-shrink-0">▸</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-3">Watch Out For</p>
                <ul className="space-y-2">
                  {intel.watchouts?.map((w, i) => (
                    <li key={i} className="flex gap-2 text-sm text-zinc-300 leading-relaxed">
                      <span className="text-yellow-400 flex-shrink-0">⚠</span>
                      {w}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="bg-zinc-800 rounded-xl p-4 border-l-2 border-blue-500">
                <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-1">Verdict</p>
                <p className="text-white text-sm font-medium">{intel.verdict}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent Trades */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800">
          <span className="text-white font-semibold">
            Recent Activity{' '}
            <span className="text-zinc-500 text-sm font-normal">({trades.length} trades)</span>
          </span>
        </div>

        {trades.length === 0 ? (
          <div className="p-6 text-center text-zinc-600 text-sm">No recent trades found.</div>
        ) : (
          <div className="max-h-[500px] overflow-y-auto divide-y divide-zinc-800/60">
            {trades.map((t, i) => {
              const usd = t.size * t.price;
              const isYes = t.outcome.toLowerCase() === 'yes';
              const isWhale = usd >= 1000;
              return (
                <div key={i} className={`px-5 py-3 flex items-center gap-3 text-xs ${isWhale ? 'bg-blue-500/5' : ''}`}>
                  <span className={`font-bold px-1.5 py-0.5 rounded flex-shrink-0 w-10 text-center ${
                    t.side === 'BUY' ? 'bg-green-900/80 text-green-300' : 'bg-red-900/80 text-red-300'
                  }`}>
                    {t.side}
                  </span>
                  <span className={`font-semibold flex-shrink-0 w-8 ${isYes ? 'text-green-400' : 'text-red-400'}`}>
                    {t.outcome}
                  </span>
                  <span className="text-zinc-300 flex-1 truncate" title={t.title}>{t.title || '—'}</span>
                  <span className="text-zinc-500 font-mono flex-shrink-0">
                    {t.size >= 1000 ? `${(t.size / 1000).toFixed(1)}K` : t.size.toFixed(0)} @ {(t.price * 100).toFixed(0)}¢
                  </span>
                  <span className={`font-mono font-semibold flex-shrink-0 w-14 text-right ${isWhale ? 'text-blue-300' : 'text-white'}`}>
                    {isWhale && '🐋 '}${usd >= 1000 ? `${(usd / 1000).toFixed(1)}K` : usd.toFixed(0)}
                  </span>
                  <span className="text-zinc-600 flex-shrink-0 w-14 text-right">{timeAgo(t.timestamp)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {modal && data && (
        <FollowModal
          wallet={wallet}
          traderName={displayName}
          onClose={() => setModal(false)}
        />
      )}
    </main>
  );
}

function StatChip({ label, value, color = 'text-white', sub }: {
  label: string; value: string; color?: string; sub?: string;
}) {
  return (
    <div className="bg-zinc-800 rounded-xl px-3 py-2.5">
      <p className="text-zinc-500 text-xs mb-0.5">{label}</p>
      <p className={`font-mono font-bold text-sm ${color}`}>{value}</p>
      {sub && <p className="text-zinc-600 text-xs mt-0.5">{sub}</p>}
    </div>
  );
}
