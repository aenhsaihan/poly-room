'use client';
import { useEffect, useState } from 'react';
import { useUser } from './UserProvider';
import FollowModal from './FollowModal';

interface RealTrade {
  side: 'BUY' | 'SELL';
  outcome: string;
  size: number;
  price: number;
  timestamp: number;
  name: string;
  proxyWallet: string;
  transactionHash: string;
}

function timeAgo(unix: number) {
  const s = Math.floor(Date.now() / 1000 - unix);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function TradeTape({ conditionId }: { conditionId: string }) {
  const { username } = useUser();
  const [trades, setTrades] = useState<RealTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ wallet: string; name: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`/api/real-trades?conditionId=${conditionId}`);
        const d = await r.json();
        if (!cancelled && Array.isArray(d)) setTrades(d);
      } catch {}
      if (!cancelled) setLoading(false);
    }
    load();
    const iv = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [conditionId]);

  if (loading) return <div className="h-48 bg-zinc-800/50 rounded-xl animate-pulse" />;
  if (trades.length === 0) return (
    <div className="bg-zinc-800 rounded-xl p-6 text-center text-zinc-600 text-sm">
      No recent real-money trades on this market.
    </div>
  );

  return (
    <div className="bg-zinc-800 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 flex items-center justify-between border-b border-zinc-700">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
          <span className="text-zinc-300 text-xs font-semibold">Live · real Polymarket trades</span>
        </div>
        <span className="text-zinc-600 text-xs">updates every 15s</span>
      </div>
      <div className="max-h-72 overflow-y-auto divide-y divide-zinc-700/50">
        {trades.map(t => {
          const usd = t.size * t.price;
          const isWhale = usd >= 1000;
          const isYes = t.outcome.toLowerCase() === 'yes';
          return (
            <div key={t.transactionHash + t.timestamp} className={`px-4 py-2 flex items-center gap-3 text-xs ${isWhale ? 'bg-blue-500/5' : ''}`}>
              <span className={`font-bold px-1.5 py-0.5 rounded flex-shrink-0 w-11 text-center ${
                t.side === 'BUY' ? 'bg-green-900/80 text-green-300' : 'bg-red-900/80 text-red-300'
              }`}>
                {t.side}
              </span>
              <span className={`font-semibold flex-shrink-0 w-16 truncate ${isYes ? 'text-green-400' : 'text-red-400'}`}>
                {t.outcome}
              </span>
              <span className="text-zinc-400 flex-1 truncate flex items-center gap-1.5 min-w-0" title={t.name}>
                <span className="truncate">{t.name}</span>
                {username && t.proxyWallet && (
                  <button
                    onClick={() => setModal({ wallet: t.proxyWallet, name: t.name })}
                    className="text-blue-500 hover:text-blue-300 transition flex-shrink-0"
                    title={`Copy-trade ${t.name}`}
                  >
                    ⧉
                  </button>
                )}
              </span>
              <span className="text-zinc-500 font-mono flex-shrink-0">
                {t.size >= 1000 ? `${(t.size / 1000).toFixed(1)}K` : t.size.toFixed(0)} @ {(t.price * 100).toFixed(1)}¢
              </span>
              <span className={`font-mono font-semibold flex-shrink-0 w-16 text-right ${isWhale ? 'text-blue-300' : 'text-white'}`}>
                {isWhale && '🐋 '}${usd >= 1000 ? `${(usd / 1000).toFixed(1)}K` : usd.toFixed(0)}
              </span>
              <span className="text-zinc-600 flex-shrink-0 w-14 text-right">{timeAgo(t.timestamp)}</span>
            </div>
          );
        })}
      </div>
      {modal && (
        <FollowModal wallet={modal.wallet} traderName={modal.name} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
