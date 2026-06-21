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
}
interface Follow {
  id: number;
  wallet: string;
  traderName: string;
  copyAmount: number;
  createdAt: string;
  lastSyncedAt: string;
  copiedTrades: number;
  copiedSpent: number;
}

const fmtUsd = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `$${(n / 1000).toFixed(0)}K` : `$${n.toFixed(0)}`;

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
  const [follows, setFollows] = useState<Follow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [modal, setModal] = useState<{ wallet: string; name: string } | null>(null);
  const [followSort, setFollowSort] = useState<'pnl' | 'volume' | 'trades' | 'deployed' | 'copyAmount' | 'since'>('pnl');
  const [traderSort, setTraderSort] = useState<'pnl' | 'volume' | 'edge'>('pnl');
  const [traderSortDir, setTraderSortDir] = useState<'desc' | 'asc'>('desc');

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

  useEffect(() => { loadFollows(); }, [loadFollows]);

  // mirror any new trades from followed wallets when the page opens
  useEffect(() => {
    if (!username) return;
    fetch('/api/copy/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    }).then(r => r.json()).then(d => {
      if (d.copied > 0) { setSyncMsg(`⧉ ${d.copied} new trade${d.copied > 1 ? 's' : ''} copied into your portfolio`); refreshBalance(); loadFollows(); }
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
      setSyncMsg(d.copied > 0
        ? `⧉ ${d.copied} new trade${d.copied > 1 ? 's' : ''} copied into your portfolio`
        : 'Up to date — no new trades from the traders you follow.');
      if (d.copied > 0) { refreshBalance(); loadFollows(); }
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

  const followedWallets = new Set(follows.map(f => f.wallet.toLowerCase()));

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
                case 'copyAmount': return b.copyAmount - a.copyAmount;
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
                          stop
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      <StatSlot label="Real P&L" value={f.pnl != null ? `+${fmtUsd(f.pnl)}` : '—'} color={f.pnl != null ? 'text-green-400' : 'text-zinc-600'} />
                      <StatSlot label="Real Vol" value={f.volume != null ? fmtUsd(f.volume) : '—'} />
                      <StatSlot label="$/trade" value={`$${f.copyAmount}`} />
                      <StatSlot label="Trades" value={String(f.copiedTrades)} />
                      <StatSlot label="Deployed" value={f.copiedSpent > 0 ? `$${f.copiedSpent.toFixed(0)}` : '$0'} />
                      <StatSlot label="Avg copied" value={f.copiedTrades > 0 ? `$${(f.copiedSpent / f.copiedTrades).toFixed(0)}` : '—'} />
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
            {([
              { value: 'pnl',    label: 'P&L' },
              { value: 'volume', label: 'Volume' },
              { value: 'edge',   label: 'Edge %' },
            ] as const).map(o => (
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
        ) : (() => {
          const sorted = [...traders].sort((a, b) => {
            const edgeA = a.volume > 0 ? a.pnl / a.volume : 0;
            const edgeB = b.volume > 0 ? b.pnl / b.volume : 0;
            const val = traderSort === 'pnl' ? b.pnl - a.pnl
              : traderSort === 'volume' ? b.volume - a.volume
              : edgeB - edgeA;
            return traderSortDir === 'desc' ? val : -val;
          });

          return (
            <div className="space-y-2">
              {sorted.map(t => {
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

                    <div className={`grid gap-2 ${follow ? 'grid-cols-3 sm:grid-cols-6' : 'grid-cols-3'}`}>
                      <StatSlot label="P&L" value={`+${fmtUsd(t.pnl)}`} color="text-green-400" />
                      <StatSlot label="Volume" value={fmtUsd(t.volume)} />
                      <StatSlot
                        label="Edge %"
                        value={`${edge.toFixed(1)}%`}
                        color={edge >= 20 ? 'text-green-400' : edge >= 10 ? 'text-yellow-400' : 'text-zinc-300'}
                        sub="PnL / volume"
                      />
                      {follow && <>
                        <StatSlot label="$/trade" value={`$${follow.copyAmount}`} />
                        <StatSlot label="Trades" value={String(follow.copiedTrades)} />
                        <StatSlot label="Deployed" value={follow.copiedSpent > 0 ? `$${follow.copiedSpent.toFixed(0)}` : '$0'} />
                      </>}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
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

function StatSlot({ label, value, color = 'text-white' }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-zinc-800 rounded-lg px-2.5 py-2">
      <p className="text-zinc-600 text-xs mb-0.5">{label}</p>
      <p className={`font-mono font-bold text-sm ${color}`}>{value}</p>
    </div>
  );
}
