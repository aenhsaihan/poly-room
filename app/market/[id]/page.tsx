'use client';
import { useEffect, useState, use, useRef } from 'react';
import Link from 'next/link';
import type { Market } from '@/lib/polymarket';
import { useUser } from '../../components/UserProvider';
import BetModal from '../../components/BetModal';
import PriceChart from '../../components/PriceChart';
import TradeTape from '../../components/TradeTape';
import BacktestPanel from '../../components/BacktestPanel';
import AgentDesk from '../../components/AgentDesk';

interface Comment { id: number; username: string; body: string; created_at: string }
interface CommunityPosition {
  outcome: string;
  holderCount: number;
  totalShares: number;
  avgPrice: number;
  totalValue: number;
}

// Calibration data derived from Polymarket historical analysis
// Source: jon-becker/prediction-market-analysis research
// Each bucket: the percentage of markets at that probability range that resolved YES
const CALIB_BUCKETS = [
  { range: '0–10',   center: 5,  historical: 6.2  },
  { range: '10–20',  center: 15, historical: 14.8 },
  { range: '20–30',  center: 25, historical: 24.9 },
  { range: '30–40',  center: 35, historical: 34.3 },
  { range: '40–50',  center: 45, historical: 44.1 },
  { range: '50–60',  center: 55, historical: 55.7 },
  { range: '60–70',  center: 65, historical: 65.2 },
  { range: '70–80',  center: 75, historical: 75.1 },
  { range: '80–90',  center: 85, historical: 84.3 },
  { range: '90–100', center: 95, historical: 91.8 },
];

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fmtVol(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtDate(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { username } = useUser();

  const [market, setMarket] = useState<Market | null>(null);
  const [loadingMarket, setLoadingMarket] = useState(true);
  const [betOpen, setBetOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [communityPositions, setCommunityPositions] = useState<CommunityPosition[]>([]);

  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/markets/${id}`)
      .then(r => r.json())
      .then(d => { setMarket(d); setLoadingMarket(false); });
  }, [id]);

  useEffect(() => {
    fetch(`/api/analysis/${id}`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setCommunityPositions(d); });
  }, [id]);

  useEffect(() => {
    fetchComments();
    const interval = setInterval(fetchComments, 8000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function fetchComments() {
    const r = await fetch(`/api/comments/${id}`);
    const data = await r.json();
    if (Array.isArray(data)) setComments(data);
    setLoadingComments(false);
  }

  async function postComment(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !body.trim()) return;
    setPosting(true);
    await fetch(`/api/comments/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, body }),
    });
    setBody('');
    await fetchComments();
    setPosting(false);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }

  if (loadingMarket) return (
    <main className="max-w-4xl mx-auto px-4 py-8 space-y-4">
      <div className="h-8 bg-zinc-800 rounded animate-pulse w-2/3" />
      <div className="h-48 bg-zinc-900 rounded-xl animate-pulse" />
      <div className="h-64 bg-zinc-900 rounded-xl animate-pulse" />
    </main>
  );

  if (!market) return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <Link href="/" className="text-zinc-500 hover:text-white text-sm">← Markets</Link>
      <p className="text-zinc-400 mt-4">Market not found.</p>
    </main>
  );

  const isBinary = market.outcomes.length === 2 &&
    market.outcomes[0].toLowerCase() === 'yes' &&
    market.outcomes[1].toLowerCase() === 'no';
  const yes = market.outcomePrices[0] ?? 0.5;
  const no = market.outcomePrices[1] ?? 0.5;
  const endDate = fmtDate(market.endDate);
  const daysLeft = market.endDate
    ? Math.ceil((new Date(market.endDate).getTime() - Date.now()) / 86400000)
    : null;

  const descWords = market.description?.split(' ') ?? [];
  const shortDesc = descWords.slice(0, 60).join(' ') + (descWords.length > 60 ? '…' : '');

  // Analysis computed values
  const volMomentum = market.volume > 0 ? (market.volume24hr / market.volume) * 100 : 0;
  const liquidityRatio = market.volume > 0 ? (market.liquidity / market.volume) * 100 : 0;
  const bucketIdx = Math.min(Math.floor(yes * 100 / 10), 9);
  const calibBucket = CALIB_BUCKETS[bucketIdx];
  const calibDiff = yes * 100 - calibBucket.historical;
  const totalCommunityValue = communityPositions.reduce((s, p) => s + p.totalValue, 0);
  const totalCommunityHolders = communityPositions.reduce((s, p) => s + p.holderCount, 0);

  return (
    <>
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <Link href="/" className="text-zinc-500 hover:text-white text-sm transition inline-block">← Markets</Link>

        {/* Hero */}
        <div className="rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-900">
          {market.image && (
            <div className="relative h-40 bg-zinc-800 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={market.image} alt="" className="w-full h-full object-cover opacity-40" />
              <div className="absolute inset-0 bg-gradient-to-b from-transparent to-zinc-900" />
            </div>
          )}
          <div className="p-6">
            <h1 className="text-2xl font-bold text-white leading-snug mb-5">{market.question}</h1>

            {/* Probability */}
            {isBinary ? (
              <div className="mb-6">
                <div className="flex justify-between items-end mb-3">
                  <div>
                    <div className="text-5xl font-black text-green-400">{(yes * 100).toFixed(0)}%</div>
                    <div className="text-sm text-zinc-400 mt-0.5">chance YES</div>
                  </div>
                  <div className="text-right">
                    <div className="text-5xl font-black text-red-400">{(no * 100).toFixed(0)}%</div>
                    <div className="text-sm text-zinc-400 mt-0.5">chance NO</div>
                  </div>
                </div>
                <div className="h-4 rounded-full overflow-hidden flex bg-zinc-800">
                  <div
                    className="h-full bg-gradient-to-r from-green-600 to-green-400 transition-all duration-700"
                    style={{ width: `${yes * 100}%` }}
                  />
                  <div className="h-full bg-gradient-to-r from-red-400 to-red-600 flex-1 transition-all duration-700" />
                </div>
                <div className="flex justify-between text-xs text-zinc-500 mt-1">
                  <span>YES · {(yes * 100).toFixed(1)}¢ per share</span>
                  <span>NO · {(no * 100).toFixed(1)}¢ per share</span>
                </div>
              </div>
            ) : (
              <div className="mb-6 space-y-2">
                {market.outcomes.map((o, i) => {
                  const p = market.outcomePrices[i] ?? 0;
                  return (
                    <div key={o}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-zinc-200 font-medium">{o}</span>
                        <span className="text-zinc-300 font-mono">{(p * 100).toFixed(1)}%</span>
                      </div>
                      <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-700"
                          style={{ width: `${p * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <StatChip label="24h Volume" value={fmtVol(market.volume24hr)} />
              <StatChip label="Total Volume" value={fmtVol(market.volume)} />
              <StatChip label="Liquidity" value={fmtVol(market.liquidity)} />
              <StatChip
                label="Closes"
                value={endDate}
                sub={daysLeft !== null ? (daysLeft <= 0 ? 'Ended' : daysLeft === 1 ? 'Tomorrow' : `${daysLeft} days`) : undefined}
                highlight={daysLeft !== null && daysLeft <= 3 && daysLeft > 0}
              />
            </div>

            {/* Description */}
            {market.description && (
              <div className="text-sm text-zinc-400 leading-relaxed border-t border-zinc-800 pt-4 mb-5">
                <p>{expanded ? market.description : shortDesc}</p>
                {descWords.length > 60 && (
                  <button
                    onClick={() => setExpanded(v => !v)}
                    className="text-blue-400 hover:text-blue-300 mt-1 text-xs transition"
                  >
                    {expanded ? 'Show less' : 'Show full resolution criteria'}
                  </button>
                )}
              </div>
            )}

            <button
              onClick={() => setBetOpen(true)}
              className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 text-white font-semibold px-8 py-2.5 rounded-xl transition text-sm"
            >
              Place a Trade
            </button>
          </div>
        </div>

        {/* Analysis Panel */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
            <span className="text-white font-semibold">Market Analysis</span>
            <span className="text-xs text-zinc-600">Polymarket calibration research</span>
          </div>

          <div className="p-5 space-y-6">
            {/* Price History — real CLOB price series */}
            {market.clobTokenIds?.length > 0 && (
              <div>
                <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-3">Price History</p>
                <PriceChart
                  tokenId={market.clobTokenIds[0]}
                  outcomeLabel={market.outcomes[0] ?? 'YES'}
                />
              </div>
            )}

            {/* Real Money Flow — live trade tape from Polymarket */}
            {market.conditionId && (
              <div>
                <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-3">Real Money Flow</p>
                <TradeTape conditionId={market.conditionId} />
              </div>
            )}

            {/* Market Signals */}
            <div>
              <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-3">Market Signals</p>
              <div className="grid grid-cols-3 gap-3">
                <SignalCard
                  label="Volume Momentum"
                  value={`${volMomentum.toFixed(1)}%`}
                  sub="24h share of total"
                  accent={volMomentum >= 5 ? 'green' : volMomentum >= 1 ? 'yellow' : 'red'}
                  hint={volMomentum >= 5 ? 'Hot' : volMomentum >= 1 ? 'Active' : 'Quiet'}
                />
                <SignalCard
                  label="Liquidity Depth"
                  value={`${liquidityRatio.toFixed(1)}%`}
                  sub="liquidity vs. volume"
                  accent={liquidityRatio >= 5 ? 'green' : liquidityRatio >= 1 ? 'yellow' : 'red'}
                  hint={liquidityRatio >= 5 ? 'Deep' : liquidityRatio >= 1 ? 'Moderate' : 'Thin'}
                />
                <SignalCard
                  label="Crowd Size"
                  value={fmtVol(market.volume)}
                  sub="total trading volume"
                  accent={market.volume >= 1_000_000 ? 'green' : market.volume >= 100_000 ? 'yellow' : 'zinc'}
                  hint={market.volume >= 1_000_000 ? 'High confidence' : market.volume >= 100_000 ? 'Moderate' : 'Low volume'}
                />
              </div>
            </div>

            {/* Calibration — binary markets only */}
            {isBinary && (
              <div>
                <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-3">Calibration Context</p>
                <div className="bg-zinc-800 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-4 mb-5">
                    <div className="flex-1">
                      <p className="text-white text-sm font-medium mb-1">
                        This market is in the{' '}
                        <span className="text-blue-400 font-bold">{calibBucket.range}%</span> probability bucket
                      </p>
                      <p className="text-zinc-400 text-xs leading-relaxed">
                        Historically, Polymarket markets priced in this range have resolved YES{' '}
                        <span className="text-white font-semibold">{calibBucket.historical}%</span> of the time.
                        The current market implies <span className="text-white font-semibold">{(yes * 100).toFixed(1)}%</span>.
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className={`text-2xl font-black ${Math.abs(calibDiff) < 5 ? 'text-green-400' : 'text-yellow-400'}`}>
                        {calibDiff >= 0 ? '+' : ''}{calibDiff.toFixed(1)}%
                      </div>
                      <div className="text-zinc-500 text-xs">vs. historical</div>
                      <div className={`text-xs mt-0.5 font-medium ${Math.abs(calibDiff) < 5 ? 'text-green-500' : 'text-yellow-500'}`}>
                        {Math.abs(calibDiff) < 5 ? 'Well calibrated' : Math.abs(calibDiff) < 10 ? 'Slight divergence' : 'Notable divergence'}
                      </div>
                    </div>
                  </div>

                  {/* Calibration bar chart */}
                  <div className="flex items-end gap-0.5 h-20 mb-1">
                    {CALIB_BUCKETS.map((b, i) => {
                      const isActive = i === bucketIdx;
                      return (
                        <div key={b.range} className="flex-1 relative h-full">
                          {/* Perfect calibration ghost bar */}
                          <div
                            className={`absolute bottom-0 left-0 right-0 rounded-t-sm ${isActive ? 'bg-blue-400' : 'bg-zinc-600'} opacity-25`}
                            style={{ height: `${b.center}%` }}
                          />
                          {/* Historical resolution bar */}
                          <div
                            className={`absolute bottom-0 left-px right-px rounded-t-sm ${isActive ? 'bg-blue-500' : 'bg-zinc-500'}`}
                            style={{ height: `${b.historical}%` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  {/* X-axis labels */}
                  <div className="flex gap-0.5">
                    {CALIB_BUCKETS.map((b, i) => (
                      <div
                        key={b.range}
                        className={`flex-1 text-center text-xs ${i === bucketIdx ? 'text-blue-400 font-bold' : 'text-zinc-700'}`}
                      >
                        {b.center}
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-zinc-700">
                    <div className="flex items-center gap-3 text-xs text-zinc-600">
                      <span className="flex items-center gap-1">
                        <span className="w-3 h-2 rounded-sm bg-zinc-500 inline-block opacity-60" />
                        implied (perfect calibration)
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-3 h-2 rounded-sm bg-zinc-400 inline-block" />
                        historical resolution
                      </span>
                    </div>
                    <span className="text-xs text-zinc-600">market probability →</span>
                  </div>
                </div>
              </div>
            )}

            {/* Community Exposure */}
            {communityPositions.length > 0 && (
              <div>
                <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-3">
                  Community Exposure
                  <span className="normal-case font-normal text-zinc-600 ml-2">
                    — {totalCommunityHolders} user{totalCommunityHolders !== 1 ? 's' : ''} from this app have open positions
                  </span>
                </p>
                <div className="space-y-3">
                  {communityPositions.map(p => {
                    const pct = totalCommunityValue > 0 ? (p.totalValue / totalCommunityValue) * 100 : 0;
                    const isYes = p.outcome.toLowerCase() === 'yes';
                    const isNo = p.outcome.toLowerCase() === 'no';
                    const barColor = isYes ? 'bg-green-500' : isNo ? 'bg-red-500' : 'bg-blue-500';
                    const labelColor = isYes ? 'text-green-400' : isNo ? 'text-red-400' : 'text-blue-400';
                    return (
                      <div key={p.outcome}>
                        <div className="flex justify-between text-xs mb-1.5">
                          <span className={`font-bold ${labelColor}`}>{p.outcome}</span>
                          <span className="text-zinc-400">
                            {p.holderCount} holder{p.holderCount !== 1 ? 's' : ''} &nbsp;·&nbsp;
                            <span className="text-white font-mono">${p.totalValue.toFixed(0)}</span> invested &nbsp;·&nbsp;
                            avg <span className="font-mono">{(p.avgPrice * 100).toFixed(0)}¢</span>
                          </span>
                        </div>
                        <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${barColor} transition-all duration-500`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="text-right text-xs text-zinc-600 mt-0.5">{pct.toFixed(0)}% of community exposure</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Agent Desk — multi-agent analysis pipeline */}
        <AgentDesk market={market} />

        {/* Strategy Lab — backtesting on real price history */}
        {market.clobTokenIds?.length > 0 && (
          <BacktestPanel
            tokenId={market.clobTokenIds[0]}
            outcomeLabel={market.outcomes[0] ?? 'YES'}
          />
        )}

        {/* Discussion */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-800 flex items-center gap-2">
            <span className="text-white font-semibold">Discussion</span>
            {comments.length > 0 && (
              <span className="text-xs bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded-full">{comments.length}</span>
            )}
          </div>

          {/* Comment list */}
          <div className="divide-y divide-zinc-800 max-h-[500px] overflow-y-auto">
            {loadingComments && comments.length === 0 ? (
              <div className="px-5 py-8 text-zinc-500 text-sm text-center">Loading…</div>
            ) : comments.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-zinc-400 font-medium mb-1">No discussion yet</p>
                <p className="text-zinc-600 text-sm">Be the first to share your take on this market.</p>
              </div>
            ) : (
              comments.map(c => (
                <div key={c.id} className="px-5 py-4">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-white font-semibold text-sm">{c.username}</span>
                    <span className="text-zinc-600 text-xs">{timeAgo(c.created_at)}</span>
                  </div>
                  <p className="text-zinc-300 text-sm leading-relaxed whitespace-pre-wrap">{c.body}</p>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          {/* Composer */}
          <div className="px-5 py-4 border-t border-zinc-800 bg-zinc-950">
            {username ? (
              <form onSubmit={postComment} className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
                  <span className="text-zinc-300 font-medium">{username}</span>
                  <span>·</span>
                  <span>share your analysis</span>
                </div>
                <textarea
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 resize-none"
                  placeholder="What's your take? Share your reasoning, sources, or prediction…"
                  rows={3}
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) postComment(e as unknown as React.FormEvent); }}
                />
                <div className="flex justify-between items-center">
                  <span className="text-zinc-600 text-xs">{body.length}/1000 · ⌘↵ to post</span>
                  <button
                    type="submit"
                    disabled={posting || !body.trim()}
                    className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold px-5 py-1.5 rounded-lg transition"
                  >
                    {posting ? 'Posting…' : 'Post'}
                  </button>
                </div>
              </form>
            ) : (
              <p className="text-zinc-500 text-sm text-center py-2">
                Set a username via the nav bar to join the discussion.
              </p>
            )}
          </div>
        </div>
      </main>

      {betOpen && <BetModal market={market} onClose={() => setBetOpen(false)} />}
    </>
  );
}

function StatChip({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className="bg-zinc-800 rounded-xl px-3 py-2.5">
      <p className="text-zinc-500 text-xs mb-0.5">{label}</p>
      <p className={`font-mono font-bold text-sm ${highlight ? 'text-orange-400' : 'text-white'}`}>{value}</p>
      {sub && <p className={`text-xs mt-0.5 ${highlight ? 'text-orange-500' : 'text-zinc-500'}`}>{sub}</p>}
    </div>
  );
}

function SignalCard({ label, value, sub, accent, hint }: {
  label: string; value: string; sub: string;
  accent: 'green' | 'yellow' | 'red' | 'zinc';
  hint: string;
}) {
  const valueColor = { green: 'text-green-400', yellow: 'text-yellow-400', red: 'text-red-400', zinc: 'text-zinc-300' }[accent];
  const dotColor = { green: 'bg-green-500', yellow: 'bg-yellow-500', red: 'bg-red-500', zinc: 'bg-zinc-500' }[accent];
  return (
    <div className="bg-zinc-800 rounded-xl p-3">
      <p className="text-zinc-500 text-xs mb-1">{label}</p>
      <p className={`font-mono font-bold text-base ${valueColor}`}>{value}</p>
      <div className="flex items-center gap-1.5 mt-1">
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor}`} />
        <span className={`text-xs font-medium ${valueColor}`}>{hint}</span>
      </div>
      <p className="text-zinc-600 text-xs mt-0.5">{sub}</p>
    </div>
  );
}
