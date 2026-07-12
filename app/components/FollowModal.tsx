'use client';
import { useState } from 'react';
import { useUser } from './UserProvider';

interface Props {
  wallet: string;
  traderName: string;
  onClose: () => void;
  onFollowed?: () => void;
}

export default function FollowModal({ wallet, traderName, onClose, onFollowed }: Props) {
  const { username, balance } = useUser();
  const [mode, setMode] = useState<'sleeve' | 'pct'>('sleeve');
  const [alloc, setAlloc] = useState(100);
  const [pct, setPct] = useState(100);
  const [trailOn, setTrailOn] = useState(false);
  const [trailPct, setTrailPct] = useState(15);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function follow() {
    if (!username) return;
    setLoading(true); setError(null);
    const res = await fetch('/api/follows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username, wallet, traderName, mode,
        copyPct: pct,
        allocation: mode === 'sleeve' ? alloc : null,
        trailPct: trailOn ? trailPct : null,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { setError(data.error ?? 'Failed'); return; }
    setDone(true);
    onFollowed?.();
  }

  const examples = [5, 50, 200, 1000].map(traderBet => ({
    traderBet,
    yourCopy: (traderBet * pct / 100).toFixed(2),
  }));

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md shadow-2xl max-h-[90dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-zinc-800">
          <p className="text-zinc-400 text-xs mb-1">Copy-trade a real Polymarket trader</p>
          <h3 className="text-white font-semibold">⧉ {traderName}</h3>
          <p className="text-zinc-600 text-xs font-mono mt-1">{wallet}</p>
        </div>

        {done ? (
          <div className="p-5 space-y-4">
            <p className="text-green-400 text-sm font-medium">
              ✓ You&apos;re now copying {traderName} {mode === 'sleeve' ? `with a $${alloc} sleeve` : `at ${pct}%`}{trailOn ? ` and a ${trailPct}% trailing stop` : ''}.
            </p>
            <p className="text-zinc-400 text-xs leading-relaxed">
              Every real trade they make gets mirrored into your paper portfolio at their actual fill price —
              {mode === 'sleeve'
                ? ' sized by the fraction of their portfolio they bet, applied to your sleeve. When they sell, you exit at their price and the cash returns to the sleeve.'
                : ` you copy ${pct}% of each dollar they spend. When they sell, you exit at their price.`}
              {trailOn && ' If your P&L on them falls off its peak by your trail %, copying stops and your copied positions are sold automatically.'}
            </p>
            <button onClick={onClose} className="w-full bg-zinc-700 hover:bg-zinc-600 text-white font-semibold py-2.5 rounded-lg transition text-sm">
              Done
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-5">
            {/* Sizing mode */}
            <div className="flex bg-zinc-800 rounded-lg p-0.5">
              {([
                { value: 'sleeve' as const, label: 'Proportional sleeve' },
                { value: 'pct' as const, label: '% of each trade' },
              ]).map(m => (
                <button
                  key={m.value}
                  onClick={() => setMode(m.value)}
                  className={`flex-1 text-xs py-1.5 rounded-md font-medium transition ${
                    mode === m.value ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="bg-zinc-800/60 rounded-lg p-3 text-xs text-zinc-400 leading-relaxed space-y-1">
              {mode === 'sleeve' ? (
                <>
                  <p>• You set aside a <span className="text-white">sleeve</span> of paper money for this trader.</p>
                  <p>• When they <span className="text-green-400 font-semibold">buy</span> with 10% of their portfolio, you buy the same outcome with <span className="text-white">10% of your sleeve</span> — their conviction becomes yours.</p>
                  <p>• When they <span className="text-red-400 font-semibold">sell</span>, you exit at their price and the cash returns to the sleeve.</p>
                  <p>• The sleeve caps your exposure — copy many traders without overextending.</p>
                </>
              ) : (
                <>
                  <p>• When they <span className="text-green-400 font-semibold">buy</span>, you copy the same outcome at their price for your chosen % of their bet.</p>
                  <p>• When they <span className="text-red-400 font-semibold">sell</span>, you exit your mirrored position at their price.</p>
                </>
              )}
              <p>• Only trades made <span className="text-white">after you follow</span> are copied.</p>
            </div>

            {mode === 'sleeve' ? (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-zinc-400 text-xs">Sleeve allocation</label>
                  <span className="text-zinc-500 text-xs">Balance: <span className="text-white font-mono">${balance.toFixed(2)}</span></span>
                </div>
                <div className="flex gap-2 items-center">
                  <span className="text-zinc-400 text-lg">$</span>
                  <input
                    type="number" min="1" step="1"
                    value={alloc}
                    onChange={e => setAlloc(Number(e.target.value))}
                    className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex gap-2 mt-3">
                  {[50, 100, 250, 500].map(n => (
                    <button key={n} onClick={() => setAlloc(Math.min(n, Math.floor(balance)))}
                      className={`flex-1 text-xs py-1.5 rounded-lg transition font-medium ${
                        alloc === n ? 'bg-blue-600 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'
                      }`}>
                      ${n}
                    </button>
                  ))}
                </div>
                <div className="bg-zinc-800/40 rounded-lg p-3 mt-3">
                  <p className="text-zinc-500 text-xs mb-2">If they bet this % of their portfolio…  you bet</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[2, 5, 10, 25].map(p => (
                      <div key={p} className="text-center">
                        <p className="text-zinc-500 text-xs">{p}%</p>
                        <p className="text-white font-mono text-xs font-semibold">${(alloc * p / 100).toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-zinc-400 text-xs">Copy percentage</label>
                  <span className="text-white font-mono font-bold text-lg">{pct}%</span>
                </div>
                <input
                  type="range" min="1" max="100" step="1"
                  value={pct}
                  onChange={e => setPct(Number(e.target.value))}
                  className="w-full accent-blue-500"
                />
                <div className="flex justify-between text-zinc-600 text-xs mt-1">
                  <span>1%</span>
                  <span>50%</span>
                  <span>100%</span>
                </div>
                <div className="flex gap-2 mt-3">
                  {[10, 25, 50, 100].map(n => (
                    <button key={n} onClick={() => setPct(n)}
                      className={`flex-1 text-xs py-1.5 rounded-lg transition font-medium ${
                        pct === n ? 'bg-blue-600 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'
                      }`}>
                      {n}%
                    </button>
                  ))}
                </div>
                <div className="bg-zinc-800/40 rounded-lg p-3 mt-3">
                  <p className="text-zinc-500 text-xs mb-2">If they bet…  you copy</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {examples.map(ex => (
                      <div key={ex.traderBet} className="text-center">
                        <p className="text-zinc-500 text-xs">${ex.traderBet}</p>
                        <p className="text-white font-mono text-xs font-semibold">${ex.yourCopy}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Trader trailing stop */}
            <div className="border border-zinc-800 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={trailOn}
                    onChange={e => setTrailOn(e.target.checked)}
                    className="accent-orange-500 w-4 h-4"
                  />
                  <span className="text-zinc-300 text-xs font-medium">Trailing stop on this trader</span>
                </label>
                {trailOn && (
                  <div className="flex items-center gap-1.5 ml-auto">
                    <input
                      type="number"
                      min={1} max={50} step={1}
                      value={trailPct}
                      onChange={e => setTrailPct(Number(e.target.value))}
                      className="w-14 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-white text-xs text-center focus:outline-none focus:border-orange-500"
                    />
                    <span className="text-zinc-500 text-xs">%</span>
                  </div>
                )}
              </div>
              <p className="text-zinc-600 text-xs leading-relaxed">
                {trailOn
                  ? `If your P&L from copying them falls ${trailPct}% of your deployed capital below its peak, you stop copying and your copied positions are sold — locking gains near the top or capping the damage.`
                  : 'Optional: auto-exit this trader when your copy P&L falls off its peak.'}
              </p>
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            {username ? (
              <button
                onClick={follow}
                disabled={loading || (mode === 'sleeve' && (!alloc || alloc < 1))}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-lg transition text-sm"
              >
                {loading ? 'Following…' : mode === 'sleeve' ? `Copy ${traderName} with $${alloc || 0} sleeve` : `Copy ${traderName} at ${pct}%`}
              </button>
            ) : (
              <p className="text-zinc-500 text-sm text-center">Set a username via the nav bar first.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
