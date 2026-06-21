'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { Market } from '@/lib/polymarket';
import BetModal from './BetModal';
import { useUser } from './UserProvider';

function fmtVol(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtDate(iso: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const days = Math.ceil((d.getTime() - now.getTime()) / 86400000);
  if (days < 0) return 'Ended';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days <= 30) return `${days}d`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function MarketCard({ market }: { market: Market }) {
  const [open, setOpen] = useState(false);
  const { username } = useUser();

  const yes = market.outcomePrices[0] ?? 0.5;
  const isBinary = market.outcomes.length === 2 &&
    market.outcomes[0].toLowerCase() === 'yes' &&
    market.outcomes[1].toLowerCase() === 'no';
  const timeLeft = fmtDate(market.endDate);
  const isEndingSoon = market.endDate && new Date(market.endDate).getTime() - Date.now() < 86400000 * 3;

  return (
    <>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl flex flex-col hover:border-zinc-600 transition group overflow-hidden">
        {/* Image */}
        {market.image && (
          <div className="h-28 overflow-hidden flex-shrink-0 bg-zinc-800">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={market.image}
              alt=""
              className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>
        )}

        <div className="p-4 flex flex-col gap-3 flex-1">
          <Link href={`/market/${market.id}`} className="text-white text-sm font-medium leading-snug line-clamp-2 flex-1 hover:text-blue-300 transition">
            {market.question}
          </Link>

          {/* Probability */}
          {isBinary ? (
            <div className="space-y-1">
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-green-400">YES {(yes * 100).toFixed(0)}%</span>
                <span className="text-red-400">NO {((1 - yes) * 100).toFixed(0)}%</span>
              </div>
              <div className="h-2 bg-zinc-800 rounded-full overflow-hidden flex">
                <div className="h-full bg-green-500" style={{ width: `${yes * 100}%` }} />
                <div className="h-full bg-red-500 flex-1" />
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {market.outcomes.slice(0, 3).map((o, i) => (
                <div key={o} className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-400 truncate flex-1">{o}</span>
                  <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(market.outcomePrices[i] ?? 0) * 100}%` }} />
                  </div>
                  <span className="text-zinc-300 font-mono w-8 text-right">{((market.outcomePrices[i] ?? 0) * 100).toFixed(0)}%</span>
                </div>
              ))}
              {market.outcomes.length > 3 && (
                <p className="text-zinc-600 text-xs">+{market.outcomes.length - 3} more outcomes</p>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-1 border-t border-zinc-800">
            <div className="flex gap-2.5 text-xs text-zinc-500">
              <span title="24h volume">🔥 {fmtVol(market.volume24hr)}</span>
              <span className={isEndingSoon ? 'text-orange-400 font-medium' : ''} title="Time left">
                ⏱ {timeLeft}
              </span>
            </div>
            {username ? (
              <button
                onClick={() => setOpen(true)}
                className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded-lg font-medium transition"
              >
                Trade
              </button>
            ) : (
              <span className="text-xs text-zinc-600">Log in to trade</span>
            )}
          </div>
        </div>
      </div>

      {open && <BetModal market={market} onClose={() => setOpen(false)} />}
    </>
  );
}
