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
  const { username } = useUser();
  const [amount, setAmount] = useState('10');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function follow() {
    if (!username) return;
    setLoading(true); setError(null);
    const res = await fetch('/api/follows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, wallet, traderName, copyAmount: Number(amount) }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { setError(data.error ?? 'Failed'); return; }
    setDone(true);
    onFollowed?.();
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-zinc-800">
          <p className="text-zinc-400 text-xs mb-1">Copy-trade a real Polymarket trader</p>
          <h3 className="text-white font-semibold">⧉ {traderName}</h3>
          <p className="text-zinc-600 text-xs font-mono mt-1">{wallet}</p>
        </div>

        {done ? (
          <div className="p-5 space-y-4">
            <p className="text-green-400 text-sm font-medium">
              ✓ You&apos;re now copying {traderName}.
            </p>
            <p className="text-zinc-400 text-xs leading-relaxed">
              From now on, every real trade they make on Polymarket gets mirrored into your paper
              portfolio at their actual fill price — ${amount} per buy, full exit when they sell.
              Mirrored trades land automatically as you use the app.
            </p>
            <button onClick={onClose} className="w-full bg-zinc-700 hover:bg-zinc-600 text-white font-semibold py-2.5 rounded-lg transition text-sm">
              Done
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div className="bg-zinc-800/60 rounded-lg p-3 text-xs text-zinc-400 leading-relaxed space-y-1">
              <p>• When they <span className="text-green-400 font-semibold">buy</span>, you buy the same outcome at their price with a fixed amount.</p>
              <p>• When they <span className="text-red-400 font-semibold">sell</span> a market you copied, you exit that position at their price.</p>
              <p>• Only trades made <span className="text-white">after you follow</span> are copied.</p>
            </div>

            <div>
              <label className="text-zinc-400 text-xs mb-1 block">Paper dollars per copied buy</label>
              <div className="flex gap-2 items-center">
                <span className="text-zinc-400 text-lg">$</span>
                <input
                  type="number" min="1" max="250" step="1"
                  className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-blue-500"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                />
              </div>
              <div className="flex gap-1.5 mt-2">
                {[5, 10, 25, 50].map(n => (
                  <button key={n} onClick={() => setAmount(String(n))}
                    className={`text-xs px-2.5 py-1 rounded transition ${
                      amount === String(n) ? 'bg-blue-600 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'
                    }`}>
                    ${n}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            {username ? (
              <button
                onClick={follow}
                disabled={loading || !amount || Number(amount) < 1}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-lg transition text-sm"
              >
                {loading ? 'Following…' : `Copy ${traderName} at $${amount || '?'} per trade`}
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
