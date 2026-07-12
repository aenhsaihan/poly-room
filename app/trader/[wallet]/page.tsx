'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useUser } from '../../components/UserProvider';
import FollowModal from '../../components/FollowModal';
import type { WalletTrade } from '@/lib/polymarket';
import type { TraderBacktestResult } from '@/lib/traderbacktest';

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

      {/* Copy Backtest */}
      <BacktestSection wallet={wallet} traderName={displayName} />

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

function fmtPnl(n: number) {
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}`;
}

function BacktestSection({ wallet, traderName }: { wallet: string; traderName: string }) {
  const [alloc, setAlloc] = useState(200);
  const [trailOn, setTrailOn] = useState(true);
  const [trailPct, setTrailPct] = useState(15);
  const [days, setDays] = useState(90);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TraderBacktestResult | null>(null);

  async function run() {
    setRunning(true); setError(null); setResult(null);
    try {
      const res = await fetch('/api/backtest/trader', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, allocation: alloc, trailPct: trailOn ? trailPct : null, days }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'backtest failed');
      setResult(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backtest failed — try again.');
    }
    setRunning(false);
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between flex-wrap gap-2">
        <div>
          <span className="text-white font-semibold">⏪ Copy Backtest</span>
          <p className="text-zinc-600 text-xs mt-0.5">What if you had copied {traderName} with these settings?</p>
        </div>
        <button
          onClick={run}
          disabled={running}
          className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold px-4 py-1.5 rounded-lg transition"
        >
          {running ? 'Replaying…' : 'Run backtest'}
        </button>
      </div>

      <div className="p-5 space-y-4">
        {/* Params */}
        <div className="flex items-center gap-x-5 gap-y-3 flex-wrap text-xs">
          <label className="flex items-center gap-2 text-zinc-400">
            Sleeve $
            <input
              type="number" min={1} step={1}
              value={alloc}
              onChange={e => setAlloc(Number(e.target.value))}
              className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white font-mono text-center focus:outline-none focus:border-blue-500"
            />
          </label>
          <label className="flex items-center gap-2 text-zinc-400 cursor-pointer select-none">
            <input type="checkbox" checked={trailOn} onChange={e => setTrailOn(e.target.checked)} className="accent-orange-500 w-4 h-4" />
            Trailing stop
            {trailOn && (
              <>
                <input
                  type="number" min={1} max={50} step={1}
                  value={trailPct}
                  onChange={e => setTrailPct(Number(e.target.value))}
                  className="w-14 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white font-mono text-center focus:outline-none focus:border-orange-500"
                />
                <span className="text-zinc-500">%</span>
              </>
            )}
          </label>
          <div className="flex items-center gap-1.5">
            {[30, 90, 180].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-2.5 py-1 rounded-full border transition ${
                  days === d ? 'bg-blue-600 border-blue-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        {result && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatChip
                label={result.trailPct != null ? `P&L (${result.trailPct}% trail)` : 'P&L'}
                value={fmtPnl(result.finalPnl)}
                color={result.finalPnl >= 0 ? 'text-green-400' : 'text-red-400'}
              />
              {result.trailPct != null && (
                <StatChip
                  label="P&L (no stop)"
                  value={fmtPnl(result.finalPnlNoStop)}
                  color={result.finalPnlNoStop >= 0 ? 'text-green-400' : 'text-red-400'}
                />
              )}
              <StatChip label="Max drawdown" value={`-$${result.maxDrawdown.toFixed(2)}`} color="text-orange-400" />
              <StatChip
                label="Deployed"
                value={`$${result.totalDeployed.toFixed(0)} of $${result.allocation}`}
                sub={`${result.buysCopied} copied · ${result.buysSkipped} skipped`}
              />
              <StatChip
                label={result.stopOut ? 'Stopped out' : 'Stop status'}
                value={result.stopOut ? fmtPnl(result.stopOut.pnl) : result.trailPct != null ? 'never fired' : 'no stop'}
                color={result.stopOut ? 'text-red-400' : 'text-zinc-300'}
                sub={result.stopOut ? new Date(result.stopOut.t * 1000).toLocaleDateString() : undefined}
              />
            </div>

            <PnlChart curve={result.curve} stopOut={result.stopOut} showNoStop={result.trailPct != null} />

            <div className="text-zinc-600 text-xs leading-relaxed space-y-1">
              {result.notes.map((n, i) => <p key={i}>⚠ {n}</p>)}
            </div>
          </div>
        )}

        {!result && !error && !running && (
          <p className="text-zinc-500 text-xs">
            Replays their last {days} days of real trades through the exact sleeve + trailing-stop
            engine that powers copying, at their actual fill prices.
          </p>
        )}
      </div>
    </div>
  );
}

function PnlChart({ curve, stopOut, showNoStop }: {
  curve: { t: number; pnl: number; pnlNoStop: number }[];
  stopOut: { t: number; pnl: number } | null;
  showNoStop: boolean;
}) {
  if (curve.length < 2) return null;
  const W = 600, H = 160, PAD = 6;
  const t0 = curve[0].t, t1 = curve[curve.length - 1].t;
  const values = curve.flatMap(p => showNoStop ? [p.pnl, p.pnlNoStop] : [p.pnl]);
  const vMin = Math.min(0, ...values), vMax = Math.max(0, ...values);
  const span = vMax - vMin || 1;
  const x = (t: number) => PAD + ((t - t0) / (t1 - t0 || 1)) * (W - 2 * PAD);
  const y = (v: number) => PAD + (1 - (v - vMin) / span) * (H - 2 * PAD);
  const line = (get: (p: { pnl: number; pnlNoStop: number }) => number) =>
    curve.map(p => `${x(p.t).toFixed(1)},${y(get(p)).toFixed(1)}`).join(' ');

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40 bg-zinc-950/60 rounded-xl border border-zinc-800">
        <line x1={PAD} x2={W - PAD} y1={y(0)} y2={y(0)} stroke="#3f3f46" strokeDasharray="4 4" strokeWidth="1" />
        {showNoStop && (
          <polyline points={line(p => p.pnlNoStop)} fill="none" stroke="#71717a" strokeWidth="1.5" strokeDasharray="5 4" />
        )}
        <polyline points={line(p => p.pnl)} fill="none" stroke="#3b82f6" strokeWidth="2" />
        {stopOut && <circle cx={x(stopOut.t)} cy={y(stopOut.pnl)} r="4" fill="#ef4444" />}
      </svg>
      <div className="flex items-center gap-4 mt-1.5 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-0.5 bg-blue-500" /> with your settings</span>
        {showNoStop && <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-0.5 bg-zinc-500" style={{ borderTop: '2px dashed' }} /> no stop</span>}
        {stopOut && <span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-full bg-red-500" /> stop fired</span>}
      </div>
    </div>
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
