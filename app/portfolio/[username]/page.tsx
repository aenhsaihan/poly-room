'use client';
import { useEffect, useState, use, useCallback } from 'react';
import Link from 'next/link';
import { useUser } from '../../components/UserProvider';

interface Position {
  market_id: string;
  market_question: string;
  outcome: string;
  shares: number;
  avg_price: number;
  copied_from: string | null;
}
interface ClosedPosition {
  market_id: string;
  market_question: string;
  outcome: string;
  cost: number;
  proceeds: number;
  pnl: number;
  closed_at: string;
  copied_from: string | null;
}
interface LivePosition {
  title: string;
  outcome: string;
  size: number;
  avgPrice: number;
  curPrice: number;
  currentValue: number;
  initialValue: number;
  cashPnl: number;
  percentPnl: number;
  realizedPnl: number;
  redeemable: boolean;
  eventSlug: string;
  icon: string | null;
}
interface LiveTrade {
  title: string;
  side: 'BUY' | 'SELL';
  outcome: string;
  size: number;
  price: number;
  timestamp: number;
}
interface StopLoss {
  id: number;
  market_id: string;
  outcome: string;
  trail_pct: number;
  peak_price: number;
  active: boolean;
}
interface User { username: string; balance: number }

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function timeAgo(unix: number) {
  const s = Math.floor(Date.now() / 1000 - unix);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function PortfolioPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = use(params);
  const { username: me, tradingMode, liveWallet, setLiveWallet } = useUser();
  const [data, setData] = useState<{ user: User; positions: Position[]; closed: ClosedPosition[] } | null>(null);
  const [stops, setStops] = useState<StopLoss[]>([]);
  const [loading, setLoading] = useState(true);
  const [livePositions, setLivePositions] = useState<LivePosition[]>([]);
  const [liveTrades, setLiveTrades] = useState<LiveTrade[]>([]);
  const [liveValue, setLiveValue] = useState(0);
  const [liveLoading, setLiveLoading] = useState(false);
  const [walletInput, setWalletInput] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ settled: number; payout: number } | null>(null);

  const loadPortfolio = useCallback(() =>
    fetch(`/api/portfolio/${encodeURIComponent(username)}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
  , [username]);

  const loadStops = useCallback(() => {
    if (!me || me.toLowerCase() !== username.toLowerCase()) return;
    fetch(`/api/stop-losses?username=${encodeURIComponent(username)}`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setStops(d.filter((s: StopLoss) => s.active)); });
  }, [username, me]);

  const loadLivePositions = useCallback((wallet: string) => {
    if (!wallet) return;
    setLiveLoading(true);
    fetch(`/api/live-positions?wallet=${encodeURIComponent(wallet)}`)
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d?.positions)) setLivePositions(d.positions);
        if (Array.isArray(d?.trades)) setLiveTrades(d.trades);
        setLiveValue(Number(d?.value ?? 0));
      })
      .catch(() => {})
      .finally(() => setLiveLoading(false));
  }, []);

  useEffect(() => { loadPortfolio(); loadStops(); }, [loadPortfolio, loadStops]);

  // Piggyback stop-loss checks on page visits (endpoint self-throttles);
  // refresh the view if any stop fired and changed positions
  useEffect(() => {
    fetch('/api/stop-losses/sync', { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        if ((d?.triggered ?? 0) > 0 || (d?.traderStops?.triggered ?? 0) > 0) {
          loadPortfolio();
          loadStops();
        }
      })
      .catch(() => {});
  }, [loadPortfolio, loadStops]);

  useEffect(() => {
    if (tradingMode === 'live' && liveWallet) loadLivePositions(liveWallet);
  }, [tradingMode, liveWallet, loadLivePositions]);

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    const res = await fetch(`/api/portfolio/${encodeURIComponent(username)}/sync`, { method: 'POST' });
    const result = await res.json();
    setSyncResult(result);
    setSyncing(false);
    setLoading(true);
    loadPortfolio();
  }

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

  const { user, positions, closed } = data;
  const isMe = user.username.toLowerCase() === me?.toLowerCase();
  const positionValue = positions.reduce((s, p) => s + p.shares * p.avg_price, 0);
  const total = user.balance + positionValue;
  const pnl = total - 1000;
  const realizedPnl = closed.reduce((s, c) => s + c.pnl, 0);

  const liveView = tradingMode === 'live' && isMe;
  const liveOpen = livePositions.filter(p => !p.redeemable && p.currentValue > 0.01);
  const liveRedeemable = livePositions.filter(p => p.redeemable);
  const liveUnrealized = liveOpen.reduce((s, p) => s + p.cashPnl, 0);
  const liveRealized = livePositions.reduce((s, p) => s + p.realizedPnl, 0);

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
        {!liveView && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Total Value" value={`$${total.toFixed(2)}`} />
            <Stat label="Cash" value={`$${user.balance.toFixed(2)}`} color="text-zinc-300" />
            <Stat label="Unrealized" value={`$${positionValue.toFixed(2)}`} color="text-zinc-300" />
            <Stat
              label="Total P&L"
              value={`${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`}
              color={pnl >= 0 ? 'text-green-400' : 'text-red-400'}
            />
          </div>
        )}
      </div>

      {/* Live portfolio (replaces paper view in live mode) */}
      {liveView && !liveWallet && (
        <div className="bg-green-950/20 border border-green-900/40 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <h2 className="text-green-300 font-semibold text-sm">Live Polymarket Portfolio</h2>
          </div>
          <p className="text-zinc-400 text-xs">Enter your Polymarket wallet address to see your real positions and activity.</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={walletInput}
              onChange={e => setWalletInput(e.target.value)}
              placeholder="0x..."
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-green-500"
            />
            <button
              onClick={() => {
                const w = walletInput.trim();
                if (/^0x[0-9a-fA-F]{40}$/.test(w)) {
                  setLiveWallet(w);
                  loadLivePositions(w);
                }
              }}
              disabled={!/^0x[0-9a-fA-F]{40}$/.test(walletInput.trim())}
              className="text-xs bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white px-3 py-2 rounded-lg transition font-medium"
            >
              Connect
            </button>
          </div>
        </div>
      )}

      {liveView && liveWallet && (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-green-300 font-semibold text-sm">Live</span>
              <span className="text-zinc-500 text-xs font-mono">{liveWallet.slice(0, 6)}…{liveWallet.slice(-4)}</span>
            </div>
            <button
              onClick={() => { setLiveWallet(''); setWalletInput(''); setLivePositions([]); setLiveTrades([]); setLiveValue(0); }}
              className="text-xs text-zinc-600 hover:text-zinc-400 transition"
            >
              Disconnect
            </button>
          </div>

          {liveLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-zinc-900 h-16 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Position Value" value={`$${liveValue.toFixed(2)}`} />
                <Stat
                  label="Unrealized P&L"
                  value={`${liveUnrealized >= 0 ? '+' : ''}$${liveUnrealized.toFixed(2)}`}
                  color={liveUnrealized >= 0 ? 'text-green-400' : 'text-red-400'}
                />
                <Stat
                  label="Realized P&L"
                  value={`${liveRealized >= 0 ? '+' : ''}$${liveRealized.toFixed(2)}`}
                  color={liveRealized >= 0 ? 'text-green-400' : 'text-red-400'}
                />
                <Stat label="Open Positions" value={String(liveOpen.length)} color="text-zinc-300" />
              </div>

              {/* Live open positions */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">
                  Open Positions <span className="text-zinc-500 text-sm font-normal">({liveOpen.length})</span>
                </h2>
                {liveOpen.length === 0 ? (
                  <p className="text-zinc-600 text-sm bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                    No open positions on this wallet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {liveOpen.map((p, i) => {
                      const pnlPos = p.cashPnl >= 0;
                      const isYes = p.outcome.toLowerCase() === 'yes';
                      return (
                        <a
                          key={i}
                          href={p.eventSlug ? `https://polymarket.com/event/${p.eventSlug}` : 'https://polymarket.com'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-600 transition"
                        >
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <p className="text-white text-sm leading-snug flex-1">{p.title || 'Unknown market'}</p>
                            <span className={`text-xs font-bold px-2 py-0.5 rounded flex-shrink-0 ${
                              isYes ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
                            }`}>
                              {p.outcome}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-zinc-400">
                              {p.size.toFixed(2)} shares @ <span className="font-mono">{(p.avgPrice * 100).toFixed(0)}¢</span>
                              <span className="text-zinc-600"> → </span>
                              <span className="font-mono">{(p.curPrice * 100).toFixed(0)}¢</span>
                            </span>
                            <span className="flex items-center gap-3">
                              <span className="font-mono text-white font-medium">${p.currentValue.toFixed(2)}</span>
                              <span className={`font-mono font-semibold ${pnlPos ? 'text-green-400' : 'text-red-400'}`}>
                                {pnlPos ? '+' : ''}${p.cashPnl.toFixed(2)}
                              </span>
                            </span>
                          </div>
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Resolved, awaiting redemption */}
              {liveRedeemable.length > 0 && (
                <div>
                  <h2 className="text-lg font-semibold text-white mb-3">
                    Resolved <span className="text-zinc-500 text-sm font-normal">({liveRedeemable.length} redeemable)</span>
                  </h2>
                  <div className="space-y-2">
                    {liveRedeemable.map((p, i) => {
                      const won = p.cashPnl >= 0;
                      return (
                        <div key={i} className={`rounded-xl p-4 border ${
                          won ? 'bg-green-950/20 border-green-900/40' : 'bg-red-950/20 border-red-900/40'
                        }`}>
                          <div className="flex items-start justify-between gap-3 mb-1">
                            <p className="text-white text-sm leading-snug flex-1">{p.title || 'Unknown market'}</p>
                            <span className={`font-mono font-bold text-sm flex-shrink-0 ${won ? 'text-green-400' : 'text-red-400'}`}>
                              {won ? '+' : ''}${p.cashPnl.toFixed(2)}
                            </span>
                          </div>
                          <p className="text-zinc-500 text-xs">
                            {p.outcome} · {p.size.toFixed(2)} shares @ {(p.avgPrice * 100).toFixed(0)}¢ · redeem on Polymarket
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Live activity */}
              <div>
                <h2 className="text-lg font-semibold text-white mb-3">
                  Recent Activity <span className="text-zinc-500 text-sm font-normal">({liveTrades.length} trades)</span>
                </h2>
                {liveTrades.length === 0 ? (
                  <p className="text-zinc-600 text-sm bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                    No recent trades on this wallet.
                  </p>
                ) : (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden max-h-[400px] overflow-y-auto divide-y divide-zinc-800/60">
                    {liveTrades.map((t, i) => {
                      const usd = t.size * t.price;
                      const isYes = t.outcome.toLowerCase() === 'yes';
                      return (
                        <div key={i} className="px-4 py-3 flex items-center gap-3 text-xs">
                          <span className={`font-bold px-1.5 py-0.5 rounded flex-shrink-0 w-10 text-center ${
                            t.side === 'BUY' ? 'bg-green-900/80 text-green-300' : 'bg-red-900/80 text-red-300'
                          }`}>
                            {t.side}
                          </span>
                          <span className={`font-semibold flex-shrink-0 w-8 ${isYes ? 'text-green-400' : 'text-red-400'}`}>
                            {t.outcome}
                          </span>
                          <span className="text-zinc-300 flex-1 truncate" title={t.title}>{t.title || '—'}</span>
                          <span className="text-zinc-500 font-mono flex-shrink-0">
                            {t.size.toFixed(0)} @ {(t.price * 100).toFixed(0)}¢
                          </span>
                          <span className="font-mono font-semibold text-white flex-shrink-0">${usd.toFixed(0)}</span>
                          <span className="text-zinc-600 flex-shrink-0 w-14 text-right">{timeAgo(t.timestamp)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {!liveView && (
      <>
      {/* Open Positions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-white">
            Open Positions <span className="text-zinc-500 text-sm font-normal">({positions.length})</span>
          </h2>
          <div className="flex items-center gap-2">
            {syncResult && (
              <span className="text-xs text-zinc-400">
                {syncResult.settled === 0
                  ? 'No closed positions found'
                  : `Settled ${syncResult.settled} · +$${syncResult.payout.toFixed(2)}`}
              </span>
            )}
            <button
              onClick={handleSync}
              disabled={syncing}
              className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white disabled:opacity-50 transition"
            >
              {syncing ? 'Syncing…' : '⟳ Sync'}
            </button>
          </div>
        </div>

        {positions.length === 0 ? (
          <p className="text-zinc-600 text-sm bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            No open positions.{isMe && <> Head to <Link href="/" className="text-blue-400 underline">Markets</Link> to start trading.</>}
          </p>
        ) : (
          <div className="space-y-2">
            {positions.map((p, i) => {
              const value = p.shares * p.avg_price;
              const pct = positionValue > 0 ? (value / positionValue) * 100 : 0;
              const isYes = p.outcome.toLowerCase() === 'yes';
              const stop = stops.find(s => s.market_id === p.market_id && s.outcome.toLowerCase() === p.outcome.toLowerCase());
              return (
                <PositionCard
                  key={i}
                  position={p}
                  value={value}
                  pct={pct}
                  isYes={isYes}
                  stop={stop ?? null}
                  isMe={isMe}
                  username={username}
                  onStopChange={loadStops}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Closed Positions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-white">
            Closed Positions <span className="text-zinc-500 text-sm font-normal">({closed.length})</span>
          </h2>
          {closed.length > 0 && (
            <span className={`text-sm font-mono font-semibold ${realizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {realizedPnl >= 0 ? '+' : ''}${realizedPnl.toFixed(2)} realized
            </span>
          )}
        </div>

        {closed.length === 0 ? (
          <p className="text-zinc-600 text-sm bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            No closed positions yet — they show up here after a market resolves or you sell.
          </p>
        ) : (
          <div className="space-y-2">
            {closed.map((c, i) => {
              const won = c.pnl >= 0;
              const isYes = c.outcome.toLowerCase() === 'yes';
              return (
                <Link key={i} href={`/market/${c.market_id}`} className={`block rounded-xl p-4 border transition hover:border-zinc-600 group ${
                  won ? 'bg-green-950/20 border-green-900/40' : 'bg-red-950/20 border-red-900/40'
                }`}>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <p className="text-white text-sm leading-snug flex-1 group-hover:text-blue-300 transition">{c.market_question}</p>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                        isYes ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
                      }`}>
                        {c.outcome}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-3 text-zinc-400">
                      <span>Paid <span className="font-mono text-zinc-300">${c.cost.toFixed(2)}</span></span>
                      <span>→</span>
                      <span>Got back <span className="font-mono text-zinc-300">${c.proceeds.toFixed(2)}</span></span>
                      {c.copied_from && (
                        <span className="text-blue-400/70">⧉ {c.copied_from}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-zinc-600">{fmtDate(c.closed_at)}</span>
                      <span className={`font-mono font-bold text-sm ${won ? 'text-green-400' : 'text-red-400'}`}>
                        {won ? '+' : ''}${c.pnl.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
      </>
      )}
    </main>
  );
}

function PositionCard({ position: p, value, pct, isYes, stop, isMe, username, onStopChange }: {
  position: Position;
  value: number;
  pct: number;
  isYes: boolean;
  stop: StopLoss | null;
  isMe: boolean;
  username: string;
  onStopChange: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [trailPct, setTrailPct] = useState(stop?.trail_pct ?? 10);
  const [saving, setSaving] = useState(false);

  const stopLevel = stop ? stop.peak_price * (1 - stop.trail_pct / 100) : null;

  async function saveStop() {
    setSaving(true);
    // Fetch current price from the market
    const res = await fetch(`/api/markets/${p.market_id}`);
    const market = await res.json();
    const outcomeIdx = (market.outcomes as string[]).findIndex(
      (o: string) => o.toLowerCase() === p.outcome.toLowerCase()
    );
    const currentPrice = outcomeIdx >= 0 ? market.outcomePrices[outcomeIdx] : p.avg_price;

    await fetch('/api/stop-losses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        marketId: p.market_id,
        marketQuestion: p.market_question,
        outcome: p.outcome,
        trailPct,
        currentPrice,
      }),
    });
    setSaving(false);
    setShowForm(false);
    onStopChange();
  }

  async function removeStop() {
    if (!stop) return;
    await fetch(`/api/stop-losses/${stop.id}`, { method: 'DELETE' });
    onStopChange();
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-600 transition">
      <div className="flex items-start justify-between gap-3 mb-2">
        <Link href={`/market/${p.market_id}`} className="text-white text-sm leading-snug flex-1 hover:text-blue-300 transition">
          {p.market_question}
        </Link>
        <span className={`text-xs font-bold px-2 py-0.5 rounded flex-shrink-0 ${
          isYes ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
        }`}>
          {p.outcome}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs text-zinc-400 mb-2">
        <span>
          {p.shares.toFixed(2)} shares @ <span className="font-mono">{(p.avg_price * 100).toFixed(0)}¢</span>
          {p.copied_from && (
            <span className="text-blue-400/70 ml-2">⧉ {p.copied_from}</span>
          )}
        </span>
        <span className="font-mono text-white font-medium">${value.toFixed(2)}</span>
      </div>
      <div className="h-1 bg-zinc-800 rounded-full overflow-hidden mb-1">
        <div
          className={`h-full rounded-full ${isYes ? 'bg-green-500' : 'bg-red-500'}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <div className="flex items-center justify-between mt-2">
        <p className="text-zinc-600 text-xs">{pct.toFixed(0)}% of open portfolio</p>

        {isMe && (
          <div className="flex items-center gap-2">
            {stop && stopLevel !== null && (
              <span className="text-xs text-orange-400/80 font-mono">
                🛑 stop {stop.trail_pct}% · level {(stopLevel * 100).toFixed(0)}¢
              </span>
            )}
            {isMe && !showForm && (
              <button
                onClick={() => setShowForm(true)}
                className="text-xs text-zinc-500 hover:text-orange-400 transition"
              >
                {stop ? 'Edit stop' : '+ Set stop'}
              </button>
            )}
            {stop && !showForm && (
              <button onClick={removeStop} className="text-xs text-zinc-600 hover:text-red-400 transition">✕</button>
            )}
          </div>
        )}
      </div>

      {showForm && isMe && (
        <div className="mt-3 pt-3 border-t border-zinc-800 flex items-center gap-3">
          <label className="text-xs text-zinc-400">Trailing stop</label>
          <input
            type="number"
            min={1} max={50} step={1}
            value={trailPct}
            onChange={e => setTrailPct(Number(e.target.value))}
            className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white text-xs text-center focus:outline-none focus:border-orange-500"
          />
          <span className="text-zinc-500 text-xs">% below peak</span>
          <button
            onClick={saveStop}
            disabled={saving}
            className="text-xs bg-orange-700 hover:bg-orange-600 disabled:opacity-40 text-white px-3 py-1 rounded-lg transition ml-auto"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => setShowForm(false)} className="text-xs text-zinc-600 hover:text-white transition">Cancel</button>
        </div>
      )}
    </div>
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
