'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Market } from '@/lib/polymarket';
import AgentDesk from '../components/AgentDesk';

interface RunRow {
  id: number;
  marketId: string;
  marketQuestion: string;
  username: string;
  action: string;
  rating: string;
  conviction: number;
  yesPriceAtRun: number;
  yesPriceNow: number | null;
  createdAt: string;
}

const PIPELINE = [
  ['📈💸🧮🗣️', 'Analyst Team', 'four specialists gather evidence: price action, real money flow, calibration vs. history, community positioning'],
  ['🐂🐻', 'Researcher Debate', 'a Bull and a Bear argue the strongest evidence from opposite sides'],
  ['🧑‍⚖️', 'Research Manager', 'weighs the debate into a five-tier rating on YES'],
  ['🧑‍💻', 'Trader', 'turns the rating into an order: buy YES, buy NO, or stand aside'],
  ['🔥⚖️🛡️', 'Risk Team', 'aggressive, neutral, and conservative risk officers fight over position size'],
  ['🎯', 'Portfolio Manager', 'issues the final call with a conviction score and a suggested stake'],
] as const;

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const actionColor = (a: string) =>
  a === 'BUY YES' ? 'bg-green-600 text-white' :
  a === 'BUY NO' ? 'bg-red-600 text-white' : 'bg-zinc-600 text-zinc-200';

// Did the price move the way the desk called it?
function verdict(run: RunRow): { label: string; color: string } | null {
  if (run.yesPriceNow === null || run.action === 'HOLD') return null;
  const move = run.yesPriceNow - run.yesPriceAtRun;
  if (Math.abs(move) < 0.005) return { label: 'flat so far', color: 'text-zinc-500' };
  const right = (run.action === 'BUY YES' && move > 0) || (run.action === 'BUY NO' && move < 0);
  const pts = (Math.abs(move) * 100).toFixed(1);
  return right
    ? { label: `✓ right so far (+${pts}¢)`, color: 'text-green-400' }
    : { label: `✗ wrong so far (−${pts}¢)`, color: 'text-red-400' };
}

export default function AgentsPage() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [urlInput, setUrlInput] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolvedMarket, setResolvedMarket] = useState<Market | null>(null);

  useEffect(() => {
    fetch('/api/agent-desk')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setRuns(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function resolveUrl() {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    setResolving(true);
    setResolveError(null);
    setResolvedMarket(null);
    const res = await fetch(`/api/markets/resolve-url?url=${encodeURIComponent(trimmed)}`);
    const d = await res.json();
    if (!res.ok) {
      setResolveError(d.error ?? 'Could not find that market.');
    } else {
      setResolvedMarket(d as Market);
    }
    setResolving(false);
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white mb-2">🤖 Agent Desk</h1>
        <p className="text-zinc-400 text-sm leading-relaxed">
          Every market page has a <span className="text-white font-medium">Run the Desk</span> button that convenes
          a multi-agent analyst pipeline (modeled on the TradingAgents research framework) on that market.
          This page is the desk&apos;s public track record — every call anyone has run, and how it&apos;s aging
          against the real price.
        </p>
      </div>

      {/* Paste a Polymarket URL */}
      <div className="rounded-2xl border border-zinc-700 bg-zinc-900 p-5 space-y-4">
        <p className="text-white font-semibold text-sm">Analyze any Polymarket market</p>
        <p className="text-zinc-400 text-xs">Paste a Polymarket URL — the desk will run on it directly.</p>
        <div className="flex gap-2">
          <input
            type="url"
            value={urlInput}
            onChange={e => { setUrlInput(e.target.value); setResolveError(null); setResolvedMarket(null); }}
            onKeyDown={e => e.key === 'Enter' && resolveUrl()}
            placeholder="https://polymarket.com/event/world-cup-winner/will-spain-win…"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500 min-w-0"
          />
          <button
            onClick={resolveUrl}
            disabled={resolving || !urlInput.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-lg transition flex-shrink-0"
          >
            {resolving ? 'Looking up…' : 'Load'}
          </button>
        </div>
        {resolveError && <p className="text-red-400 text-xs">{resolveError}</p>}
        {resolvedMarket && (
          <div className="space-y-2">
            <p className="text-zinc-400 text-xs">
              Found: <span className="text-white font-medium">{resolvedMarket.question}</span>
            </p>
            <AgentDesk market={resolvedMarket} />
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
        <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-4">How the desk works</p>
        <div className="space-y-3">
          {PIPELINE.map(([emoji, name, desc], i) => (
            <div key={name} className="flex items-start gap-3">
              <span className="text-zinc-600 font-mono text-xs mt-0.5 w-4 flex-shrink-0">{i + 1}</span>
              <span className="flex-shrink-0 w-16 text-sm">{emoji}</span>
              <div>
                <span className="text-white text-sm font-semibold">{name}</span>
                <span className="text-zinc-500 text-sm"> — {desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Track record */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-3">
          Recent calls <span className="text-zinc-500 text-sm font-normal">({runs.length})</span>
        </h2>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-zinc-900 h-20 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : runs.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
            <p className="text-zinc-400 font-medium mb-1">No desk runs yet</p>
            <p className="text-zinc-600 text-sm">
              Open any <Link href="/" className="text-blue-400 underline">market</Link> and hit
              &ldquo;Run the Desk&rdquo; — the call will show up here for everyone to judge.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {runs.map(run => {
              const v = verdict(run);
              return (
                <Link
                  key={run.id}
                  href={`/market/${run.marketId}`}
                  className="block bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-600 transition group"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <p className="text-white text-sm leading-snug flex-1 group-hover:text-blue-300 transition">
                      {run.marketQuestion}
                    </p>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded flex-shrink-0 ${actionColor(run.action)}`}>
                      {run.action}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
                    <span>conviction <span className="text-white font-mono">{run.conviction}/100</span></span>
                    <span>
                      called at <span className="font-mono text-zinc-300">{(run.yesPriceAtRun * 100).toFixed(1)}¢</span>
                      {run.yesPriceNow !== null && (
                        <> → now <span className="font-mono text-zinc-300">{(run.yesPriceNow * 100).toFixed(1)}¢</span></>
                      )}
                    </span>
                    {v && <span className={`font-medium ${v.color}`}>{v.label}</span>}
                    <span className="ml-auto">
                      by <span className="text-zinc-400">{run.username}</span> · {timeAgo(run.createdAt)}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
