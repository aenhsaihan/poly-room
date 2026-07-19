'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export type TradingMode = 'paper' | 'live';

interface UserCtx {
  username: string | null;
  balance: number;
  setUsername: (u: string) => void;
  refreshBalance: () => void;
  tradingMode: TradingMode;
  setTradingMode: (m: TradingMode) => void;
  liveWallet: string | null;
  setLiveWallet: (w: string) => void;
}

const Ctx = createContext<UserCtx>({
  username: null, balance: 100000, setUsername: () => {}, refreshBalance: () => {},
  tradingMode: 'paper', setTradingMode: () => {},
  liveWallet: null, setLiveWallet: () => {},
});

export function useUser() { return useContext(Ctx); }

export default function UserProvider({ children }: { children: ReactNode }) {
  const [username, setUsernameState] = useState<string | null>(null);
  const [balance, setBalance] = useState(100000);
  const [showModal, setShowModal] = useState(false);
  const [tradingMode, setTradingModeState] = useState<TradingMode>('paper');
  const [liveWallet, setLiveWalletState] = useState<string | null>(null);

  async function loadUser(name: string) {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: name }),
    });
    const u = await res.json();
    setBalance(u.balance ?? 100000);
    fetch('/api/copy/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: name }),
    }).then(r => r.json()).then(d => {
      if (d?.copied > 0) {
        return fetch(`/api/users?username=${encodeURIComponent(name)}`)
          .then(r => r.ok ? r.json() : null)
          .then(u2 => { if (u2) setBalance(u2.balance); });
      }
    }).catch(() => {});
  }

  async function refreshBalance() {
    if (!username) return;
    const res = await fetch(`/api/users?username=${encodeURIComponent(username)}`);
    if (res.ok) { const u = await res.json(); setBalance(u.balance); }
  }

  useEffect(() => {
    const stored = localStorage.getItem('poly_username');
    if (stored) { setUsernameState(stored); loadUser(stored); }
    else setShowModal(true);

    const storedMode = localStorage.getItem('poly_trading_mode') as TradingMode | null;
    if (storedMode === 'live') setTradingModeState('live');

    const storedWallet = localStorage.getItem('poly_live_wallet');
    if (storedWallet) setLiveWalletState(storedWallet);
  }, []);

  function setUsername(name: string) {
    localStorage.setItem('poly_username', name);
    setUsernameState(name);
    setShowModal(false);
    loadUser(name);
  }

  function setTradingMode(m: TradingMode) {
    localStorage.setItem('poly_trading_mode', m);
    setTradingModeState(m);
  }

  function setLiveWallet(w: string) {
    localStorage.setItem('poly_live_wallet', w);
    setLiveWalletState(w);
  }

  return (
    <Ctx.Provider value={{ username, balance, setUsername, refreshBalance, tradingMode, setTradingMode, liveWallet, setLiveWallet }}>
      {children}
      {showModal && <UsernameModal onSubmit={setUsername} />}
    </Ctx.Provider>
  );
}

function UsernameModal({ onSubmit }: { onSubmit: (u: string) => void }) {
  const [val, setVal] = useState('');
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-8 w-full max-w-sm shadow-2xl">
        <h2 className="text-xl font-bold text-white mb-1">Welcome to Poly Trader</h2>
        <p className="text-zinc-400 text-sm mb-6">Pick a username to start with $100,000 in play money.</p>
        <input
          autoFocus
          className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 mb-4"
          placeholder="Your username"
          value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && val.trim() && onSubmit(val.trim())}
        />
        <button
          disabled={!val.trim()}
          onClick={() => onSubmit(val.trim())}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold py-2 rounded-lg transition"
        >
          Start Trading
        </button>
      </div>
    </div>
  );
}
