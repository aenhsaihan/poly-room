'use client';
import { useEffect, useState } from 'react';

interface PricePoint { t: number; p: number }
type Interval = '1d' | '1w' | '1m' | 'max';

const INTERVALS: { key: Interval; label: string }[] = [
  { key: '1d', label: '1D' },
  { key: '1w', label: '1W' },
  { key: '1m', label: '1M' },
  { key: 'max', label: 'ALL' },
];

const W = 600;
const H = 180;
const PAD = 4;

export default function PriceChart({ tokenId, outcomeLabel }: { tokenId: string; outcomeLabel: string }) {
  const [interval, setIntervalKey] = useState<Interval>('1w');
  const [points, setPoints] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/price-history?tokenId=${tokenId}&interval=${interval}`)
      .then(r => r.json())
      .then(d => { if (!cancelled && Array.isArray(d)) { setPoints(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tokenId, interval]);

  const prices = points.map(p => p.p);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = Math.max(max - min, 0.02); // avoid flat-line collapse
  const lo = Math.max(0, min - span * 0.15);
  const hi = Math.min(1, max + span * 0.15);

  const toXY = (pt: PricePoint, i: number) => {
    const x = PAD + (i / Math.max(points.length - 1, 1)) * (W - PAD * 2);
    const y = H - PAD - ((pt.p - lo) / (hi - lo)) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };

  const line = points.map(toXY).join(' ');
  const area = points.length > 1
    ? `${PAD},${H - PAD} ${line} ${W - PAD},${H - PAD}`
    : '';

  const first = prices[0] ?? 0;
  const last = prices[prices.length - 1] ?? 0;
  const change = (last - first) * 100;
  const up = change >= 0;
  const color = up ? '#4ade80' : '#f87171';

  const startDate = points[0] ? new Date(points[0].t * 1000) : null;
  const endDate = points[points.length - 1] ? new Date(points[points.length - 1].t * 1000) : null;
  const fmtAxis = (d: Date) =>
    interval === '1d'
      ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <div className="bg-zinc-800 rounded-xl p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-zinc-500 text-xs mb-0.5">{outcomeLabel} price · real market history</p>
          <div className="flex items-baseline gap-2">
            <span className="text-white font-mono font-bold text-xl">{(last * 100).toFixed(1)}¢</span>
            {points.length > 1 && (
              <span className={`text-xs font-semibold ${up ? 'text-green-400' : 'text-red-400'}`}>
                {up ? '▲' : '▼'} {Math.abs(change).toFixed(1)} pts
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-1">
          {INTERVALS.map(iv => (
            <button
              key={iv.key}
              onClick={() => setIntervalKey(iv.key)}
              className={`text-xs px-2.5 py-1 rounded-lg font-medium transition ${
                interval === iv.key
                  ? 'bg-blue-600 text-white'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-700'
              }`}
            >
              {iv.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-[180px] bg-zinc-700/30 rounded-lg animate-pulse" />
      ) : points.length < 2 ? (
        <div className="h-[180px] flex items-center justify-center text-zinc-600 text-sm">
          No price history for this period.
        </div>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.25" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75].map(f => (
              <line
                key={f}
                x1={PAD} x2={W - PAD}
                y1={H - PAD - f * (H - PAD * 2)} y2={H - PAD - f * (H - PAD * 2)}
                stroke="#3f3f46" strokeWidth="0.5" strokeDasharray="4 4"
              />
            ))}
            <polygon points={area} fill="url(#chartFill)" />
            <polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
          </svg>
          <div className="flex justify-between text-xs text-zinc-600 mt-1">
            <span>{startDate ? fmtAxis(startDate) : ''}</span>
            <span className="text-zinc-500">
              range {(min * 100).toFixed(0)}¢ – {(max * 100).toFixed(0)}¢
            </span>
            <span>{endDate ? fmtAxis(endDate) : ''}</span>
          </div>
        </>
      )}
    </div>
  );
}
