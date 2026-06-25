'use client';
import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useUser } from '../../components/UserProvider';

interface Position {
  market_id: string;
  market_question: string;
  outcome: string;
  shares: number;
  avg_price: number;
}
interface ClosedPosition {
  market_id: string;
  market_question: string;
  outcome: string;
  cost: number;
  proceeds: number;
  pnl: number;
  closed_at: string;
  copied_from: string | null;
}
interface User { username: string; balance: number }

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function PortfolioPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = use(params);
  const { username: me } = useUser();
  const [data, setData] = useState<{ user: User; positions: Position[]; closed: ClosedPosition[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ settled: number; payout: number } | null>(null);

  const loadPortfolio = () =>
    fetch(`/api/portfolio/${encodeURIComponent(username)}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); });

  useEffect(() => { loadPortfolio(); }, [username]);

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    const res = await fetch(`/api/portfolio/${encodeURIComponent(username)}/sync`, { method: 'POST' });
    const result = await res.json();
    setSyncResult(result);
    setSyncing(false);
    setLoading(true);
    loadPortfolio();
  }

  if (loading) return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-zinc-900 h-16 rounded-xl animate-pulse" />
        ))}
      </div>
    </main>
  );

  if (!data?.user) return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/leaderboard" className="text-zinc-500 hover:text-white text-sm transition mb-4 inline-block">← Leaderboard</Link>
      <p className="text-zinc-500">User not found.</p>
    </main>
  );

  const { user, positions, closed } = data;
  const isMe = user.username.toLowerCase() === me?.toLowerCase();
  const positionValue = positions.reduce((s, p) => s + p.shares * p.avg_price, 0);
  const total = user.balance + positionValue;
  const pnl = total - 1000;
  const realizedPnl = closed.reduce((s, c) => s + c.pnl, 0);

  return (
    <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">
      <div>
        <Link href="/leaderboard" className="text-zinc-500 hover:text-white text-sm transition mb-4 inline-block">
          ← Leaderboard
        </Link>
        <div className="flex items-baseline gap-3 mb-4">
          <h1 className="text-2xl font-bold text-white">{user.username}</h1>
          {isMe && <span className="text-xs text-blue-400 font-medium">you</span>}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Total Value" value={`$${total.toFixed(2)}`} />
          <Stat label="Cash" value={`$${user.balance.toFixed(2)}`} color="text-zinc-300" />
          <Stat label="Unrealized" value={`$${positionValue.toFixed(2)}`} color="text-zinc-300" />
          <Stat
            label="Total P&L"
            value={`${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`}
            color={pnl >= 0 ? 'text-green-400' : 'text-red-400'}
          />
        </div>
      </div>

      {/* Open Positions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-white">
            Open Positions <span className="text-zinc-500 text-sm font-normal">({positions.length})</span>
          </h2>
          <div className="flex items-center gap-2">
            {syncResult && (
              <span className="text-xs text-zinc-400">
                {syncResult.settled === 0
                  ? 'No closed positions found'
                  : `Settled ${syncResult.settled} · +$${syncResult.payout.toFixed(2)}`}
              </span>
            )}
            <button
              onClick={handleSync}
              disabled={syncing}
              className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white disabled:opacity-50 transition"
            >
              {syncing ? 'Syncing…' : '⟳ Sync'}
            </button>
          </div>
        </div>

        {positions.length === 0 ? (
          <p className="text-zinc-600 text-sm bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            No open positions.{isMe && <> Head to <Link href="/" className="text-blue-400 underline">Markets</Link> to start trading.</>}
          </p>
        ) : (
          <div className="space-y-2">
            {positions.map((p, i) => {
              const value = p.shares * p.avg_price;
              const pct = positionValue > 0 ? (value / positionValue) * 100 : 0;
              const isYes = p.outcome.toLowerCase() === 'yes';
              return (
                <Link key={i} href={`/market/${p.market_id}`} className="block bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-600 transition group">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <p className="text-white text-sm leading-snug flex-1 group-hover:text-blue-300 transition">{p.market_question}</p>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded flex-shrink-0 ${
                      isYes ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
                    }`}>
                      {p.outcome}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>{p.shares.toFixed(2)} shares @ <span className="font-mono">{(p.avg_price * 100).toFixed(0)}¢</span></span>
                    <span className="font-mono text-white font-medium">${value.toFixed(2)}</span>
                  </div>
                  <div className="mt-2 h-1 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${isYes ? 'bg-green-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <p className="text-zinc-600 text-xs mt-1">{pct.toFixed(0)}% of open portfolio</p>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Closed Positions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-white">
            Closed Positions <span className="text-zinc-500 text-sm font-normal">({closed.length})</span>
          </h2>
          {closed.length > 0 && (
            <span className={`text-sm font-mono font-semibold ${realizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {realizedPnl >= 0 ? '+' : ''}${realizedPnl.toFixed(2)} realized
            </span>
          )}
        </div>

        {closed.length === 0 ? (
          <p className="text-zinc-600 text-sm bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            No closed positions yet — they show up here after a market resolves or you sell.
          </p>
        ) : (
          <div className="space-y-2">
            {closed.map((c, i) => {
              const won = c.pnl >= 0;
              const isYes = c.outcome.toLowerCase() === 'yes';
              return (
                <Link key={i} href={`/market/${c.market_id}`} className={`block rounded-xl p-4 border transition hover:border-zinc-600 group ${
                  won ? 'bg-green-950/20 border-green-900/40' : 'bg-red-950/20 border-red-900/40'
                }`}>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <p className="text-white text-sm leading-snug flex-1 group-hover:text-blue-300 transition">{c.market_question}</p>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                        isYes ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
                      }`}>
                        {c.outcome}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-3 text-zinc-400">
                      <span>Paid <span className="font-mono text-zinc-300">${c.cost.toFixed(2)}</span></span>
                      <span>→</span>
                      <span>Got back <span className="font-mono text-zinc-300">${c.proceeds.toFixed(2)}</span></span>
                      {c.copied_from && (
                        <span className="text-blue-400/70">⧉ {c.copied_from}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-zinc-600">{fmtDate(c.closed_at)}</span>
                      <span className={`font-mono font-bold text-sm ${won ? 'text-green-400' : 'text-red-400'}`}>
                        {won ? '+' : ''}${c.pnl.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value, color = 'text-white' }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <p className="text-zinc-500 text-xs mb-1">{label}</p>
      <p className={`font-mono font-bold text-base ${color}`}>{value}</p>
    </div>
  );
}
