'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUser } from '../components/UserProvider';

interface Row {
  username: string;
  balance: number;
  position_value: number;
}

const STARTING_BALANCE = 1000;

export default function LeaderboardPage() {
  const { username } = useUser();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const loadLeaderboard = () =>
    fetch('/api/leaderboard')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setRows(d); setLoading(false); })
      .catch(() => setLoading(false));

  useEffect(() => { loadLeaderboard(); }, []);

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch('/api/leaderboard/sync', { method: 'POST' });
      const d = await res.json();
      setSyncMsg(
        d.settled === 0
          ? 'All positions up to date — no closed markets found.'
          : `Settled ${d.settled} position${d.settled !== 1 ? 's' : ''} across ${d.users} user${d.users !== 1 ? 's' : ''} · +$${d.payout.toFixed(2)} paid out`
      );
      setLoading(true);
      loadLeaderboard();
    } catch {
      setSyncMsg('Sync failed — try again.');
    }
    setSyncing(false);
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">🏆 Leaderboard</h1>
          <p className="text-zinc-400 text-sm">App users ranked by total paper portfolio value. Everyone starts with $1,000.</p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white disabled:opacity-50 transition"
        >
          {syncing ? 'Syncing…' : '⟳ Sync all'}
        </button>
      </div>

      {syncMsg && (
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-xs text-zinc-300">
          {syncMsg}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-zinc-900 h-16 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-center text-zinc-500 text-sm">
          No users yet — be the first to sign up and trade.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => {
            const total = r.balance + r.position_value;
            const gain = total - STARTING_BALANCE;
            const gainPct = (gain / STARTING_BALANCE) * 100;
            const isMe = username?.toLowerCase() === r.username.toLowerCase();
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null;

            return (
              <Link
                key={r.username}
                href={`/portfolio/${r.username}`}
                className={`flex items-center gap-4 px-4 py-3 rounded-xl border transition hover:border-zinc-600 ${
                  isMe
                    ? 'bg-blue-950/30 border-blue-800'
                    : 'bg-zinc-900 border-zinc-800'
                }`}
              >
                <span className="text-zinc-500 font-mono text-sm w-8 flex-shrink-0 text-center">
                  {medal ?? `#${i + 1}`}
                </span>

                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold truncate ${isMe ? 'text-blue-300' : 'text-white'}`}>
                    {r.username}{isMe && <span className="text-zinc-500 font-normal text-xs ml-1">(you)</span>}
                  </p>
                  <p className="text-zinc-600 text-xs">
                    ${r.balance.toFixed(0)} cash · ${r.position_value.toFixed(0)} positions
                  </p>
                </div>

                <div className="text-right flex-shrink-0">
                  <p className="text-white font-mono font-bold text-sm">${total.toFixed(0)}</p>
                  <p className={`text-xs font-mono ${gain >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {gain >= 0 ? '+' : ''}{gain.toFixed(0)} ({gainPct >= 0 ? '+' : ''}{gainPct.toFixed(1)}%)
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {!username && (
        <p className="text-zinc-600 text-xs text-center">
          <Link href="/" className="text-blue-400 underline">Sign up</Link> to join the leaderboard.
        </p>
      )}
    </main>
  );
}
