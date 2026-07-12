'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useUser } from '../components/UserProvider';
import FollowModal from '../components/FollowModal';

interface TopTrader {
  rank: number;
  wallet: string;
  name: string;
  pnl: number;
  volume: number;
  profileImage: string;
  avgBuySize: number | null;
}
interface Follow {
  id: number;
  wallet: string;
  traderName: string;
  copyPct: number;
  createdAt: string;
  lastSyncedAt: string;
  copiedTrades: number;
  copiedSpent: number;
  trailPct: number | null;
  peakPnl: number;
  lastPnl: number | null;
  stoppedAt: string | null;
  stoppedPnl: number | null;
}

const fmtUsd = (n: number) => {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
};

const fmtPnl = (n: number) => `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}`;

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function CopyPage() {
  const { username, refreshBalance } = useUser();
  const [traders, setTraders] = useState<TopTrader[]>([]);
  const [worstTraders, setWorstTraders] = useState<TopTrader[]>([]);
  const [follows, setFollows] = useState<Follow[]>([]);
  const [loading, setLoading] = useState(true);
  const [worstLoading, setWorstLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [modal, setModal] = useState<{ wallet: string; name: string } | null>(null);
  const [stopEditor, setStopEditor] = useState<string | null>(null);
  const [stopPct, setStopPct] = useState(15);
  const [followSort, setFollowSort] = useState<'pnl' | 'volume' | 'trades' | 'deployed' | 'copyAmount' | 'since'>('pnl');
  const [traderSort, setTraderSort] = useState<'pnl' | 'volume' | 'edge' | 'avgBuySize'>('pnl');
  const [traderSortDir, setTraderSortDir] = useState<'desc' | 'asc'>('desc');
  const [worstSort, setWorstSort] = useState<'pnl' | 'volume' | 'edge' | 'avgBuySize'>('pnl');
  const [worstSortDir, setWorstSortDir] = useState<'desc' | 'asc'>('asc');

  const loadFollows = useCallback(async () => {
    if (!username) return;
    const r = await fetch(`/api/follows?username=${encodeURIComponent(username)}`);
    const d = await r.json();
    if (Array.isArray(d)) setFollows(d);
  }, [username]);

  useEffect(() => {
    fetch('/api/top-traders').then(r => r.json()).then(d => {
      if (Array.isArray(d)) setTraders(d);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch('/api/worst-traders').then(r => r.json()).then(d => {
      if (Array.isArray(d)) setWorstTraders(d);
      setWorstLoading(false);
    }).catch(() => setWorstLoading(false));
  }, []);

  useEffect(() => { loadFollows(); }, [loadFollows]);

  // mirror any new trades from followed wallets when the page opens
  useEffect(() => {
    if (!username) return;
    fetch('/api/copy/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    }).then(r => r.json()).then(d => {
      const stopMsg = d.stopsTriggered?.length
        ? ` ⛔ Trailing stop fired on ${d.stopsTriggered.map((s: { trader: string; pnl: number }) => `${s.trader} (${fmtPnl(s.pnl)})`).join(', ')} — copied positions sold.`
        : '';
      if (d.copied > 0 || stopMsg) {
        setSyncMsg(`${d.copied > 0 ? `⧉ ${d.copied} new trade${d.copied > 1 ? 's' : ''} copied into your portfolio.` : ''}${stopMsg}`);
        refreshBalance(); loadFollows();
      }
    }).catch(() => {});
  }, [username, refreshBalance, loadFollows]);

  async function syncNow() {
    if (!username || syncing) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await fetch('/api/copy/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const d = await r.json();
      const stopMsg = d.stopsTriggered?.length
        ? ` ⛔ Trailing stop fired on ${d.stopsTriggered.map((s: { trader: string; pnl: number }) => `${s.trader} (${fmtPnl(s.pnl)})`).join(', ')} — copied positions sold.`
        : '';
      setSyncMsg((d.copied > 0
        ? `⧉ ${d.copied} new trade${d.copied > 1 ? 's' : ''} copied into your portfolio.`
        : 'Up to date — no new trades from the traders you follow.') + stopMsg);
      if (d.copied > 0 || stopMsg) { refreshBalance(); loadFollows(); }
    } catch { setSyncMsg('Sync failed — try again.'); }
    setSyncing(false);
  }

  async function unfollow(wallet: string, name: string) {
    if (!username) return;
    await fetch('/api/follows', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, wallet }),
    });
    setSyncMsg(`Stopped copying ${name}. Positions you already copied stay in your portfolio.`);
    loadFollows();
  }

  async function saveTraderStop(wallet: string, pct: number | null) {
    if (!username) return;
    await fetch('/api/follows', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, wallet, trailPct: pct }),
    });
    setStopEditor(null);
    loadFollows();
  }

  async function resumeFollow(wallet: string, name: string) {
    if (!username) return;
    await fetch('/api/follows', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, wallet, resume: true }),
    });
    setSyncMsg(`Resumed copying ${name} — only their trades from now on are mirrored.`);
    loadFollows();
  }

  const followedWallets = new Set(follows.map(f => f.wallet.toLowerCase()));

  const TRADER_SORT_OPTIONS = [
    { value: 'pnl' as const,        label: 'P&L' },
    { value: 'volume' as const,     label: 'Volume' },
    { value: 'edge' as const,       label: 'Edge %' },
    { value: 'avgBuySize' as const, label: 'Avg buy' },
  ];

  function sortTraders(list: TopTrader[], sort: typeof traderSort, dir: 'desc' | 'asc') {
    return [...list].sort((a, b) => {
      const edgeA = a.volume > 0 ? a.pnl / a.volume : 0;
      const edgeB = b.volume > 0 ? b.pnl / b.volume : 0;
      const val = sort === 'pnl' ? b.pnl - a.pnl
        : sort === 'volume' ? b.volume - a.volume
        : sort === 'avgBuySize' ? (b.avgBuySize ?? -1) - (a.avgBuySize ?? -1)
        : edgeB - edgeA;
      return dir === 'desc' ? val : -val;
    });
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white mb-2">⧉ Copy Trading</h1>
        <p className="text-zinc-400 text-sm leading-relaxed">
          Follow real Polymarket traders and mirror their actual trades into your paper portfolio.
          When they buy, you buy the same outcome <span className="text-white">at their exact fill price</span> with
          a fixed paper amount you choose. When they sell a market you copied, you exit at their price.
          You can also copy anyone you spot in a market&apos;s <span className="text-white">Real Money Flow</span> tape.
        </p>
      </div>

      {syncMsg && (
        <div className="bg-blue-950/50 border border-blue-900 rounded-xl px-4 py-3 text-sm text-blue-300">{syncMsg}</div>
      )}

      {/* Your follows */}
      {username && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-white">
              You&apos;re copying <span className="text-zinc-500 text-sm font-normal">({follows.length})</span>
            </h2>
            {follows.length > 0 && (
              <button
                onClick={syncNow}
                disabled={syncing}
                className="text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 px-3 py-1.5 rounded-lg font-medium transition"
              >
                {syncing ? 'Syncing…' : '↻ Sync now'}
              </button>
            )}
          </div>
          {follows.length === 0 ? (
            <p className="text-zinc-600 text-sm bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              Not copying anyone yet — pick a trader below, or hit ⧉ next to any trade in a market&apos;s live tape.
            </p>
          ) : (() => {
            const SORT_OPTIONS: { value: typeof followSort; label: string }[] = [
              { value: 'pnl',        label: 'P&L' },
              { value: 'volume',     label: 'Volume' },
              { value: 'trades',     label: 'Trades copied' },
              { value: 'deployed',   label: 'Deployed' },
              { value: 'copyAmount', label: '$/trade' },
              { value: 'since',      label: 'Date followed' },
            ];

            const enriched = follows.map(f => {
              const lb = traders.find(t => t.wallet.toLowerCase() === f.wallet.toLowerCase());
              return { ...f, pnl: lb?.pnl ?? null, volume: lb?.volume ?? null, rank: lb?.rank ?? null };
            });

            const sorted = [...enriched].sort((a, b) => {
              switch (followSort) {
                case 'pnl':        return (b.pnl ?? -Infinity) - (a.pnl ?? -Infinity);
                case 'volume':     return (b.volume ?? -Infinity) - (a.volume ?? -Infinity);
                case 'trades':     return b.copiedTrades - a.copiedTrades;
                case 'deployed':   return b.copiedSpent - a.copiedSpent;
                case 'copyAmount': return b.copyPct - a.copyPct;
                case 'since':      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
              }
            });

            return (
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-zinc-600 text-xs">Sort by</span>
                  {SORT_OPTIONS.map(o => (
                    <button
                      key={o.value}
                      onClick={() => setFollowSort(o.value)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition ${
                        followSort === o.value
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>

                {sorted.map(f => (
                  <div key={f.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2 min-w-0">
                        {f.rank && <span className="text-zinc-600 font-mono text-xs flex-shrink-0">#{f.rank}</span>}
                        <Link href={`/trader/${f.wallet}`} className="text-white text-sm font-semibold hover:text-blue-300 transition truncate">⧉ {f.traderName}</Link>
                        <span className="text-zinc-700 font-mono text-xs flex-shrink-0">{f.wallet.slice(0, 6)}…{f.wallet.slice(-4)}</span>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-zinc-600 text-xs">since {timeAgo(f.createdAt)}</span>
                        <button
                          onClick={() => unfollow(f.wallet, f.traderName)}
                          className="text-red-400/60 hover:text-red-400 transition text-xs"
                        >
                          unfollow
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      <StatSlot label="Real P&L" value={f.pnl != null ? `+${fmtUsd(f.pnl)}` : '—'} color={f.pnl != null ? 'text-green-400' : 'text-zinc-600'} />
                      <StatSlot label="Real Vol" value={f.volume != null ? fmtUsd(f.volume) : '—'} />
                      <StatSlot label="Copy %" value={`${f.copyPct}%`} color="text-blue-400" />
                      <StatSlot label="Trades" value={String(f.copiedTrades)} />
                      <StatSlot label="Deployed" value={f.copiedSpent > 0 ? `$${f.copiedSpent.toFixed(0)}` : '$0'} />
                      <StatSlot
                        label="Copy P&L"
                        value={f.lastPnl != null ? fmtPnl(f.lastPnl) : '—'}
                        color={f.lastPnl == null ? 'text-zinc-600' : f.lastPnl >= 0 ? 'text-green-400' : 'text-red-400'}
                      />
                    </div>

                    {/* Trader trailing stop */}
                    <div className="mt-3 pt-3 border-t border-zinc-800/60">
                      {f.stoppedAt ? (
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="text-red-400">
                            ⛔ Stopped out {timeAgo(f.stoppedAt)}
                            {f.stoppedPnl != null && <> · locked <span className="font-mono font-semibold">{fmtPnl(f.stoppedPnl)}</span></>}
                            {' '}— copying paused, copied positions sold
                          </span>
                          <button
                            onClick={() => resumeFollow(f.wallet, f.traderName)}
                            className="flex-shrink-0 text-xs bg-zinc-800 hover:bg-green-900 text-zinc-300 hover:text-green-200 px-3 py-1.5 rounded-lg font-medium transition"
                          >
                            Resume copying
                          </button>
                        </div>
                      ) : stopEditor === f.wallet ? (
                        <div className="flex items-center gap-3 text-xs">
                          <label className="text-zinc-400">Trailing stop</label>
                          <input
                            type="number"
                            min={1} max={50} step={1}
                            value={stopPct}
                            onChange={e => setStopPct(Number(e.target.value))}
                            className="w-14 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-white text-center focus:outline-none focus:border-orange-500"
                          />
                          <span className="text-zinc-500">% of deployed below P&L peak</span>
                          <button
                            onClick={() => saveTraderStop(f.wallet, stopPct)}
                            className="ml-auto bg-orange-700 hover:bg-orange-600 text-white px-3 py-1 rounded-lg transition font-medium"
                          >
                            Save
                          </button>
                          <button onClick={() => setStopEditor(null)} className="text-zinc-600 hover:text-white transition">Cancel</button>
                        </div>
                      ) : f.trailPct != null ? (
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="text-orange-400/80 font-mono">
                            🛑 trail {f.trailPct}%
                            {f.lastPnl != null && <> · P&L {fmtPnl(f.lastPnl)} / peak {fmtPnl(f.peakPnl)}</>}
                          </span>
                          <span className="flex items-center gap-2 flex-shrink-0">
                            <button
                              onClick={() => { setStopPct(f.trailPct ?? 15); setStopEditor(f.wallet); }}
                              className="text-zinc-500 hover:text-orange-400 transition"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => saveTraderStop(f.wallet, null)}
                              className="text-zinc-600 hover:text-red-400 transition"
                            >
                              ✕
                            </button>
                          </span>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setStopPct(15); setStopEditor(f.wallet); }}
                          className="text-xs text-zinc-500 hover:text-orange-400 transition"
                        >
                          + Set trailing stop on this trader
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* Top traders */}
      <div>
        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-white mb-0.5">Top Polymarket traders</h2>
            <p className="text-zinc-600 text-xs">Real accounts, real money. Click a name for full profile + Trader Intel.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {TRADER_SORT_OPTIONS.map(o => (
              <button
                key={o.value}
                onClick={() => {
                  if (traderSort === o.value) setTraderSortDir(d => d === 'desc' ? 'asc' : 'desc');
                  else { setTraderSort(o.value); setTraderSortDir('desc'); }
                }}
                className={`text-xs px-2.5 py-1 rounded-full border transition flex items-center gap-1 ${
                  traderSort === o.value
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500'
                }`}
              >
                {o.label}
                {traderSort === o.value && <span>{traderSortDir === 'desc' ? '↓' : '↑'}</span>}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="bg-zinc-900 h-24 rounded-xl animate-pulse" />)}
          </div>
        ) : (
          <div className="space-y-2">
            {sortTraders(traders, traderSort, traderSortDir).map(t => {
              const isFollowed = followedWallets.has(t.wallet.toLowerCase());
              const follow = follows.find(f => f.wallet.toLowerCase() === t.wallet.toLowerCase());
              const edge = t.volume > 0 ? (t.pnl / t.volume) * 100 : 0;

              return (
                <div key={t.wallet} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-zinc-600 font-mono text-xs w-6 flex-shrink-0">#{t.rank}</span>
                    {t.profileImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.profileImage} alt="" className="w-8 h-8 rounded-full object-cover bg-zinc-800 flex-shrink-0"
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-500 text-xs flex-shrink-0">
                        {t.name[0]?.toUpperCase() ?? '?'}
                      </div>
                    )}
                    <Link href={`/trader/${t.wallet}`} className="text-white text-sm font-semibold flex-1 truncate hover:text-blue-300 transition">
                      {t.name}
                    </Link>
                    {username ? (
                      isFollowed ? (
                        <span className="text-xs text-blue-400 font-medium flex-shrink-0">✓ copying</span>
                      ) : (
                        <button
                          onClick={() => setModal({ wallet: t.wallet, name: t.name })}
                          className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg font-semibold transition flex-shrink-0"
                        >
                          ⧉ Copy
                        </button>
                      )
                    ) : (
                      <span className="text-xs text-zinc-600 flex-shrink-0">log in to copy</span>
                    )}
                  </div>

                  <div className={`grid gap-2 ${follow ? 'grid-cols-2 sm:grid-cols-6' : 'grid-cols-2 sm:grid-cols-4'}`}>
                    <StatSlot label="P&L" value={`+${fmtUsd(t.pnl)}`} color="text-green-400" />
                    <StatSlot label="Volume" value={fmtUsd(t.volume)} />
                    <StatSlot
                      label="Edge %"
                      value={`${edge.toFixed(1)}%`}
                      color={edge >= 20 ? 'text-green-400' : edge >= 10 ? 'text-yellow-400' : 'text-zinc-300'}
                      sub="PnL / volume"
                    />
                    <StatSlot
                      label="Avg buy"
                      value={t.avgBuySize != null ? `$${t.avgBuySize.toFixed(0)}` : '—'}
                      sub="per trade"
                    />
                    {follow && <>
                      <StatSlot label="Copy %" value={`${follow.copyPct}%`} color="text-blue-400" />
                      <StatSlot label="Trades" value={String(follow.copiedTrades)} />
                    </>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Do Not Copy */}
      <div>
        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-white mb-0.5">🚫 Do Not Copy</h2>
            <p className="text-zinc-600 text-xs">Biggest losers on Polymarket right now. Avoid at all costs.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {TRADER_SORT_OPTIONS.map(o => (
              <button
                key={o.value}
                onClick={() => {
                  if (worstSort === o.value) setWorstSortDir(d => d === 'desc' ? 'asc' : 'desc');
                  else { setWorstSort(o.value); setWorstSortDir('asc'); }
                }}
                className={`text-xs px-2.5 py-1 rounded-full border transition flex items-center gap-1 ${
                  worstSort === o.value
                    ? 'bg-red-700 border-red-600 text-white'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500'
                }`}
              >
                {o.label}
                {worstSort === o.value && <span>{worstSortDir === 'desc' ? '↓' : '↑'}</span>}
              </button>
            ))}
          </div>
        </div>

        {worstLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="bg-zinc-900 h-24 rounded-xl animate-pulse" />)}
          </div>
        ) : (
          <div className="space-y-2">
            {sortTraders(worstTraders, worstSort, worstSortDir).map(t => {
              const edge = t.volume > 0 ? (t.pnl / t.volume) * 100 : 0;

              return (
                <div key={t.wallet} className="bg-zinc-900 border border-red-900/30 rounded-xl p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-zinc-600 font-mono text-xs w-6 flex-shrink-0">#{t.rank}</span>
                    {t.profileImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.profileImage} alt="" className="w-8 h-8 rounded-full object-cover bg-zinc-800 flex-shrink-0"
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-500 text-xs flex-shrink-0">
                        {t.name[0]?.toUpperCase() ?? '?'}
                      </div>
                    )}
                    <Link href={`/trader/${t.wallet}`} className="text-white text-sm font-semibold flex-1 truncate hover:text-blue-300 transition">
                      {t.name}
                    </Link>
                    <span className="text-xs text-red-400/70 font-medium flex-shrink-0">avoid</span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <StatSlot label="Lost" value={fmtUsd(Math.abs(t.pnl))} color="text-red-400" />
                    <StatSlot label="Volume" value={fmtUsd(t.volume)} />
                    <StatSlot
                      label="Edge %"
                      value={`${edge.toFixed(1)}%`}
                      color={edge < 0 ? 'text-red-400' : 'text-zinc-300'}
                      sub="PnL / volume"
                    />
                    <StatSlot
                      label="Avg buy"
                      value={t.avgBuySize != null ? `$${t.avgBuySize.toFixed(0)}` : '—'}
                      sub="per trade"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-zinc-600 text-xs leading-relaxed">
        Mirrored trades use the trader&apos;s historical fill price, so it doesn&apos;t matter when your portfolio syncs —
        you get the price they actually got. Copied positions show up in{' '}
        {username ? <Link href={`/portfolio/${username}`} className="text-blue-400 underline">your portfolio</Link> : 'your portfolio'} marked
        with ⧉. Whales bet thousands — you mirror with pocket change, which is the whole point.
      </p>

      {modal && (
        <FollowModal
          wallet={modal.wallet}
          traderName={modal.name}
          onClose={() => setModal(null)}
          onFollowed={loadFollows}
        />
      )}
    </main>
  );
}

function StatSlot({ label, value, color = 'text-white', sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="bg-zinc-800 rounded-lg px-2.5 py-2">
      <p className="text-zinc-600 text-xs mb-0.5">{label}</p>
      <p className={`font-mono font-bold text-sm ${color}`}>{value}</p>
      {sub && <p className="text-zinc-600 text-xs mt-0.5">{sub}</p>}
    </div>
  );
}
