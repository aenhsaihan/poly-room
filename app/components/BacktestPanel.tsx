'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  runBacktest, STRATEGY_DEFAULTS,
  type StrategyId, type StrategyParams, type PricePoint, type BtResult,
} from '@/lib/backtest';

type Interval = '1w' | '1m' | 'max';
const INTERVALS: { key: Interval; label: string }[] = [
  { key: '1w', label: '1 Week' },
  { key: '1m', label: '1 Month' },
  { key: 'max', label: 'All Time' },
];

const STRATEGIES: { id: StrategyId; emoji: string; name: string; desc: string }[] = [
  { id: 'buyhold', emoji: '💎', name: 'Buy & Hold', desc: 'Buy on day one, never sell. The baseline every strategy has to beat.' },
  { id: 'meanrev', emoji: '🔄', name: 'Mean Reversion', desc: 'Buy when price dips below its recent average, sell when it bounces back.' },
  { id: 'rsi', emoji: '⚡', name: 'RSI Reversion', desc: 'Buy when the market looks oversold (RSI low), sell when it recovers.' },
  { id: 'emacross', emoji: '🚀', name: 'EMA Crossover', desc: 'Buy when short-term momentum crosses above the long-term trend, sell when it crosses back.' },
  { id: 'breakout', emoji: '💥', name: 'Breakout', desc: 'Buy when price spikes above its normal range, sell when it falls back to average.' },
];

// One or two tunable knobs per strategy, with plain labels
const SLIDERS: Record<StrategyId, { key: keyof StrategyParams; label: string; min: number; max: number; step: number; fmt: (v: number) => string }[]> = {
  buyhold: [],
  meanrev: [
    { key: 'threshold', label: 'Buy the dip when price is below average by', min: 0.01, max: 0.10, step: 0.01, fmt: v => `${(v * 100).toFixed(0)}¢` },
    { key: 'window', label: 'Average over the last', min: 6, max: 48, step: 2, fmt: v => `${v} bars` },
  ],
  rsi: [
    { key: 'rsiBuy', label: 'Buy when RSI drops below', min: 15, max: 45, step: 5, fmt: v => `${v}` },
    { key: 'rsiSell', label: 'Sell when RSI rises above', min: 50, max: 80, step: 5, fmt: v => `${v}` },
  ],
  emacross: [
    { key: 'emaFast', label: 'Fast trend length', min: 4, max: 16, step: 1, fmt: v => `${v} bars` },
    { key: 'emaSlow', label: 'Slow trend length', min: 18, max: 60, step: 3, fmt: v => `${v} bars` },
  ],
  breakout: [
    { key: 'breakoutStd', label: 'Spike sensitivity (higher = rarer trades)', min: 0.5, max: 3, step: 0.25, fmt: v => `${v}σ` },
    { key: 'breakoutWindow', label: 'Normal range measured over', min: 10, max: 40, step: 5, fmt: v => `${v} bars` },
  ],
};

const W = 600, PH = 150, EH = 90, PAD = 4;

function fmtTime(unix: number) {
  return new Date(unix * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function BacktestPanel({ tokenId, outcomeLabel }: { tokenId: string; outcomeLabel: string }) {
  const [interval, setIntervalKey] = useState<Interval>('1m');
  const [points, setPoints] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [strategy, setStrategy] = useState<StrategyId>('meanrev');
  const [params, setParams] = useState<StrategyParams>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/price-history?tokenId=${tokenId}&interval=${interval}`)
      .then(r => r.json())
      .then(d => { if (!cancelled && Array.isArray(d)) { setPoints(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tokenId, interval]);

  // reset knobs to defaults when switching strategy
  useEffect(() => { setParams({}); }, [strategy]);

  const result: BtResult | null = useMemo(
    () => runBacktest(points, strategy, params),
    [points, strategy, params]
  );

  const merged = { ...STRATEGY_DEFAULTS[strategy], ...params };

  // chart geometry
  const prices = points.map(p => p.p);
  const pMin = Math.min(...prices), pMax = Math.max(...prices);
  const pSpan = Math.max(pMax - pMin, 0.02);
  const pLo = Math.max(0, pMin - pSpan * 0.15), pHi = Math.min(1, pMax + pSpan * 0.15);
  const px = (i: number) => PAD + (i / Math.max(points.length - 1, 1)) * (W - PAD * 2);
  const py = (v: number) => PH - PAD - ((v - pLo) / (pHi - pLo)) * (PH - PAD * 2);
  const priceLine = points.map((pt, i) => `${px(i).toFixed(1)},${py(pt.p).toFixed(1)}`).join(' ');

  const eq = result?.equity ?? [];
  const eMin = eq.length ? Math.min(...eq.map(e => e.v)) : 0;
  const eMax = eq.length ? Math.max(...eq.map(e => e.v)) : 1;
  const eSpan = Math.max(eMax - eMin, 1);
  const ey = (v: number) => EH - PAD - ((v - (eMin - eSpan * 0.1)) / (eSpan * 1.2)) * (EH - PAD * 2);
  const eqLine = eq.map((e, i) => `${px(i).toFixed(1)},${ey(e.v).toFixed(1)}`).join(' ');
  const profit = (result?.totalReturnPct ?? 0) >= 0;
  const eqColor = profit ? '#4ade80' : '#f87171';

  // map trade timestamps to point indices for markers
  const tIndex = useMemo(() => {
    const m = new Map<number, number>();
    points.forEach((pt, i) => m.set(pt.t, i));
    return m;
  }, [points]);

  const beatHold = result ? result.totalReturnPct > result.buyHoldReturnPct : false;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
        <span className="text-white font-semibold">Strategy Lab</span>
        <span className="text-xs text-zinc-600">backtest on real price history</span>
      </div>

      <div className="p-5 space-y-5">
        <p className="text-zinc-400 text-sm leading-relaxed">
          What if you&apos;d traded <span className="text-white font-medium">{outcomeLabel}</span> on this market
          with <span className="text-white font-mono">$1,000</span> and a rule-based strategy?
          Pick one and see — it runs against the market&apos;s actual price history.
        </p>

        {/* Period */}
        <div className="flex gap-1.5">
          {INTERVALS.map(iv => (
            <button
              key={iv.key}
              onClick={() => setIntervalKey(iv.key)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition ${
                interval === iv.key ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'
              }`}
            >
              {iv.label}
            </button>
          ))}
        </div>

        {/* Strategy cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {STRATEGIES.map(s => (
            <button
              key={s.id}
              onClick={() => setStrategy(s.id)}
              className={`text-left p-3 rounded-xl border transition ${
                strategy === s.id
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-zinc-800 bg-zinc-800/50 hover:border-zinc-600'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span>{s.emoji}</span>
                <span className={`text-sm font-semibold ${strategy === s.id ? 'text-blue-300' : 'text-white'}`}>{s.name}</span>
              </div>
              <p className="text-zinc-500 text-xs leading-snug">{s.desc}</p>
            </button>
          ))}
        </div>

        {/* Knobs */}
        {SLIDERS[strategy].length > 0 && (
          <div className="bg-zinc-800/50 rounded-xl p-4 space-y-3">
            {SLIDERS[strategy].map(s => {
              const val = (merged[s.key] as number) ?? s.min;
              return (
                <div key={s.key}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-zinc-400">{s.label}</span>
                    <span className="text-white font-mono font-semibold">{s.fmt(val)}</span>
                  </div>
                  <input
                    type="range"
                    min={s.min} max={s.max} step={s.step} value={val}
                    onChange={e => setParams(prev => ({ ...prev, [s.key]: Number(e.target.value) }))}
                    className="w-full accent-blue-500"
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* Results */}
        {loading ? (
          <div className="h-64 bg-zinc-800/50 rounded-xl animate-pulse" />
        ) : !result ? (
          <div className="bg-zinc-800 rounded-xl p-6 text-center text-zinc-600 text-sm">
            Not enough price history in this period to run a backtest.
          </div>
        ) : (
          <>
            {/* Headline */}
            <div className="bg-zinc-800 rounded-xl p-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-zinc-400 text-sm">$1,000 would now be</span>
                <span className={`text-3xl font-black font-mono ${profit ? 'text-green-400' : 'text-red-400'}`}>
                  ${result.finalValue.toFixed(0)}
                </span>
                <span className={`text-sm font-semibold ${profit ? 'text-green-400' : 'text-red-400'}`}>
                  {profit ? '+' : ''}{result.totalReturnPct.toFixed(1)}%
                </span>
              </div>
              {strategy !== 'buyhold' && (
                <p className="text-xs mt-1.5 text-zinc-500">
                  Buy &amp; Hold over the same period: {result.buyHoldReturnPct >= 0 ? '+' : ''}{result.buyHoldReturnPct.toFixed(1)}%
                  {' — '}
                  <span className={beatHold ? 'text-green-400 font-medium' : 'text-yellow-500 font-medium'}>
                    {beatHold ? 'your strategy beat holding 🎉' : 'just holding would have done better'}
                  </span>
                </p>
              )}
            </div>

            {/* Metric chips */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Metric label="Max Drawdown" value={`−${result.maxDrawdownPct.toFixed(1)}%`} sub="worst peak-to-trough dip" />
              <Metric label="Completed Trades" value={`${result.numRoundTrips}`} sub={result.openPosition ? '+1 still open' : 'buy→sell round trips'} />
              <Metric label="Win Rate" value={result.numRoundTrips > 0 ? `${result.winRate.toFixed(0)}%` : '—'} sub="profitable round trips" />
              <Metric label="Time in Market" value={`${result.exposurePct.toFixed(0)}%`} sub="bars holding a position" />
            </div>

            {/* Price chart with trade markers */}
            {points.length > 1 && (
              <div className="bg-zinc-800 rounded-xl p-4">
                <p className="text-zinc-500 text-xs mb-2">
                  {outcomeLabel} price · <span className="text-green-400">▲ buys</span> · <span className="text-red-400">▼ sells</span>
                </p>
                <svg viewBox={`0 0 ${W} ${PH}`} className="w-full" preserveAspectRatio="none">
                  <polyline points={priceLine} fill="none" stroke="#60a5fa" strokeWidth="1.5" strokeLinejoin="round" />
                  {result.trades.map((tr, i) => {
                    const idx = tIndex.get(tr.t);
                    if (idx === undefined) return null;
                    const x = px(idx), y = py(tr.price);
                    return tr.side === 'BUY'
                      ? <polygon key={i} points={`${x},${y - 9} ${x - 5},${y - 1} ${x + 5},${y - 1}`} fill="#4ade80" />
                      : <polygon key={i} points={`${x},${y + 9} ${x - 5},${y + 1} ${x + 5},${y + 1}`} fill="#f87171" />;
                  })}
                </svg>

                <p className="text-zinc-500 text-xs mt-3 mb-2">Portfolio value</p>
                <svg viewBox={`0 0 ${W} ${EH}`} className="w-full" preserveAspectRatio="none">
                  <line x1={PAD} x2={W - PAD} y1={ey(1000)} y2={ey(1000)} stroke="#52525b" strokeWidth="0.75" strokeDasharray="4 4" />
                  <polyline points={eqLine} fill="none" stroke={eqColor} strokeWidth="2" strokeLinejoin="round" />
                </svg>
                <div className="flex justify-between text-xs text-zinc-600 mt-1">
                  <span>{points[0] ? fmtTime(points[0].t) : ''}</span>
                  <span className="text-zinc-500">dashed line = starting $1,000</span>
                  <span>{points[points.length - 1] ? fmtTime(points[points.length - 1].t) : ''}</span>
                </div>
              </div>
            )}

            {/* Trade log */}
            {result.trades.length > 0 && (
              <div className="bg-zinc-800 rounded-xl overflow-hidden">
                <p className="text-zinc-500 text-xs px-4 pt-3 pb-2">Trade log ({result.trades.length})</p>
                <div className="max-h-44 overflow-y-auto divide-y divide-zinc-700/50">
                  {result.trades.map((tr, i) => (
                    <div key={i} className="px-4 py-1.5 flex items-center gap-3 text-xs">
                      <span className={`font-bold w-9 ${tr.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{tr.side}</span>
                      <span className="text-zinc-500 w-16">{fmtTime(tr.t)}</span>
                      <span className="text-white font-mono w-14">{(tr.price * 100).toFixed(1)}¢</span>
                      <span className="text-zinc-500 flex-1 truncate">{tr.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-zinc-600 text-xs leading-relaxed">
              Simulated: fills at historical prices with all-in sizing, no fees or slippage.
              Past performance on one market proves nothing — that&apos;s half the fun.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-zinc-800 rounded-xl p-3">
      <p className="text-zinc-500 text-xs mb-0.5">{label}</p>
      <p className="text-white font-mono font-bold text-base">{value}</p>
      <p className="text-zinc-600 text-xs mt-0.5">{sub}</p>
    </div>
  );
}
