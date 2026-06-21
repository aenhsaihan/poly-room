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
interface Trade {
  market_id: string;
  market_question: string;
  outcome: string;
  shares: number;
  price: number;
  side: string;
  amount: number;
  created_at: string;
  copied_from?: string | null;
}
interface User { username: string; balance: number }

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export default function PortfolioPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = use(params);
  const { username: me } = useUser();
  const [data, setData] = useState<{ user: User; positions: Position[]; trades: Trade[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/portfolio/${encodeURIComponent(username)}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); });
  }, [username]);

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

  const { user, positions, trades } = data;
  const isMe = user.username.toLowerCase() === me?.toLowerCase();
  const positionValue = positions.reduce((s, p) => s + p.shares * p.avg_price, 0);
  const total = user.balance + positionValue;
  const pnl = total - 1000;

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
          <Stat label="In Positions" value={`$${positionValue.toFixed(2)}`} color="text-zinc-300" />
          <Stat
            label="P&L"
            value={`${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`}
            color={pnl >= 0 ? 'text-green-400' : 'text-red-400'}
          />
        </div>
      </div>

      {positions.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-3">
            Open Positions <span className="text-zinc-500 text-sm font-normal">({positions.length})</span>
          </h2>
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
                  <p className="text-zinc-600 text-xs mt-1">{pct.toFixed(0)}% of position value</p>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {trades.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-3">
            Trade History <span className="text-zinc-500 text-sm font-normal">({trades.length})</span>
          </h2>
          <div className="space-y-1.5">
            {trades.map((t, i) => (
              <Link key={i} href={`/market/${t.market_id}`} className="block bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 hover:border-zinc-600 transition group">
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded flex-shrink-0 ${
                    t.side === 'BUY' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
                  }`}>
                    {t.side}
                  </span>
                  <span className={`text-xs font-semibold flex-shrink-0 ${
                    t.outcome.toLowerCase() === 'yes' ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {t.outcome}
                  </span>
                  <span className="text-zinc-300 text-xs flex-1 truncate group-hover:text-blue-300 transition">{t.market_question}</span>
                  {t.copied_from && (
                    <span className="text-xs text-blue-400/80 flex-shrink-0" title={`Copied from ${t.copied_from}`}>
                      ⧉ {t.copied_from}
                    </span>
                  )}
                  <span className="text-white font-mono text-xs flex-shrink-0">${t.amount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between mt-1.5 text-zinc-600 text-xs">
                  <span>{t.shares.toFixed(2)} shares @ {(t.price * 100).toFixed(0)}¢</span>
                  <span>{fmtDate(t.created_at)}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {positions.length === 0 && trades.length === 0 && (
        <p className="text-zinc-500 text-center py-8">
          No trades yet.{isMe && <> Head to <Link href="/" className="text-blue-400 underline">Markets</Link> to start!</>}
        </p>
      )}
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
