'use client';
import { useState } from 'react';
import { useUser } from './UserProvider';
import type { Market } from '@/lib/polymarket';

interface Props {
  market: Market;
  onClose: () => void;
  defaultOutcome?: string;
}

export default function BetModal({ market, onClose, defaultOutcome }: Props) {
  const { username, balance, refreshBalance, tradingMode } = useUser();
  const [outcome, setOutcome] = useState(
    defaultOutcome && market.outcomes.includes(defaultOutcome) ? defaultOutcome : market.outcomes[0]
  );
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trailStop, setTrailStop] = useState(false);
  const [trailPct, setTrailPct] = useState(10);

  const outcomeIdx = market.outcomes.indexOf(outcome);
  const price = market.outcomePrices[outcomeIdx] ?? 0.5;
  const shares = amount && !isNaN(Number(amount)) ? (Number(amount) / price) : 0;

  async function submit() {
    if (!username || !amount || isNaN(Number(amount))) return;
    setLoading(true); setError(null); setResult(null);
    const res = await fetch('/api/bet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username, marketId: market.id, marketQuestion: market.question,
        outcome, side: 'BUY', amount: Number(amount), price,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { setError(data.error); return; }
    refreshBalance();
    if (trailStop) {
      await fetch('/api/stop-losses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username, marketId: market.id, marketQuestion: market.question,
          outcome, trailPct, currentPrice: price,
        }),
      });
    }
    setResult(`Bought ${data.shares.toFixed(2)} ${outcome} shares. New balance: $${data.newBalance.toFixed(2)}`);
    setAmount('');
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-zinc-800">
          <p className="text-zinc-400 text-xs mb-1">Market</p>
          <h3 className="text-white font-semibold text-sm leading-snug">{market.question}</h3>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <p className="text-zinc-400 text-xs mb-2">Pick outcome</p>
            <div className="flex gap-2">
              {market.outcomes.map((o, i) => {
                const p = market.outcomePrices[i];
                const isYes = o.toLowerCase() === 'yes';
                const active = outcome === o;
                return (
                  <button
                    key={o}
                    onClick={() => setOutcome(o)}
                    className={`flex-1 py-2.5 rounded-lg border text-sm font-semibold transition ${
                      active
                        ? isYes ? 'bg-green-600 border-green-500 text-white' : 'bg-red-600 border-red-500 text-white'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500'
                    }`}
                  >
                    {o} <span className="font-mono">{(p * 100).toFixed(0)}¢</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-zinc-400 text-xs mb-1 block">Amount (USD)</label>
            <div className="flex gap-2 items-center">
              <span className="text-zinc-400 text-lg">$</span>
              <input
                type="number" min="1" step="1"
                className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-blue-500"
                placeholder="0"
                value={amount}
                onChange={e => setAmount(e.target.value)}
              />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-zinc-500 text-xs">Balance: <span className="text-white">${balance.toFixed(2)}</span></span>
              {shares > 0 && <span className="text-zinc-500 text-xs">≈ <span className="text-white">{shares.toFixed(2)} shares</span></span>}
            </div>
            <div className="flex gap-1.5 mt-2">
              {[10, 25, 50, 100].map(n => (
                <button key={n} onClick={() => setAmount(String(Math.min(n, balance)))}
                  className="text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 px-2 py-1 rounded transition">
                  ${n}
                </button>
              ))}
            </div>
          </div>

          {tradingMode === 'paper' && (
          <div className="flex items-center gap-3 py-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={trailStop}
                onChange={e => setTrailStop(e.target.checked)}
                className="accent-orange-500 w-4 h-4"
              />
              <span className="text-zinc-400 text-xs">Set trailing stop loss</span>
            </label>
            {trailStop && (
              <div className="flex items-center gap-1.5 ml-auto">
                <input
                  type="number"
                  min={1} max={50} step={1}
                  value={trailPct}
                  onChange={e => setTrailPct(Number(e.target.value))}
                  className="w-14 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-white text-xs text-center focus:outline-none focus:border-orange-500"
                />
                <span className="text-zinc-500 text-xs">% below peak</span>
              </div>
            )}
          </div>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}
          {result && <p className="text-green-400 text-sm">{result}</p>}

          {tradingMode === 'live' ? (
            <div className="space-y-2">
              <div className="text-xs text-green-400/80 bg-green-950/30 border border-green-900/40 rounded-lg px-3 py-2">
                ● Live mode — this will execute a real trade on Polymarket
              </div>
              <a
                href={`https://polymarket.com/search?q=${encodeURIComponent(market.question)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 bg-green-700 hover:bg-green-600 text-white font-semibold py-2.5 rounded-lg transition"
              >
                Trade on Polymarket →
              </a>
            </div>
          ) : (
            <button
              onClick={submit}
              disabled={loading || !amount || isNaN(Number(amount)) || Number(amount) <= 0}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-lg transition"
            >
              {loading ? 'Placing...' : `Buy ${outcome}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
