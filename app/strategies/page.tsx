'use client';
import { useEffect, useState, useCallback } from 'react';
import { useUser } from '../components/UserProvider';

interface Strategy {
  id: number;
  username: string;
  name: string;
  description: string;
  rules: string;
  enabled: boolean;
  status: string;
  ai_review: string | null;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-zinc-700 text-zinc-300',
  active:  'bg-green-900/60 text-green-300',
  rejected:'bg-red-900/60 text-red-400',
};

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function StrategiesPage() {
  const { username } = useUser();
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rules, setRules] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  const load = useCallback(() =>
    fetch('/api/strategies').then(r => r.json()).then(d => {
      if (Array.isArray(d)) setStrategies(d);
      setLoading(false);
    }).catch(() => setLoading(false))
  , []);

  useEffect(() => { load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !name.trim() || !description.trim() || !rules.trim()) return;
    setSubmitting(true);
    setSubmitMsg(null);
    const res = await fetch('/api/strategies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, name, description, rules }),
    });
    const d = await res.json();
    setSubmitting(false);
    if (res.ok) {
      setName(''); setDescription(''); setRules('');
      setSubmitMsg('Strategy submitted!');
      load();
    } else {
      setSubmitMsg(d.error ?? 'Failed to submit.');
    }
  }

  async function toggleEnabled(s: Strategy) {
    await fetch(`/api/strategies/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !s.enabled }),
    });
    setStrategies(prev => prev.map(x => x.id === s.id ? { ...x, enabled: !x.enabled } : x));
  }

  function updateStrategy(id: number, patch: Partial<Strategy>) {
    setStrategies(prev => prev.map(x => x.id === id ? { ...x, ...patch } : x));
  }

  const mine = strategies.filter(s => s.username === username);
  const others = strategies.filter(s => s.username !== username);

  return (
    <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">⚙️ Strategies</h1>
        <p className="text-zinc-400 text-sm leading-relaxed">
          Propose an automated trading strategy. Describe the logic and rules clearly —
          approved strategies get wired into a bot that trades on your behalf.
        </p>
      </div>

      {/* Submit form */}
      {username ? (
        <form onSubmit={submit} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
          <h2 className="text-white font-semibold text-sm">Propose a strategy</h2>

          <input
            type="text"
            placeholder="Strategy name (e.g. Fade the Crowd)"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={100}
            required
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-blue-500"
          />

          <textarea
            placeholder="Brief description — what does this strategy do and when does it apply?"
            value={description}
            onChange={e => setDescription(e.target.value)}
            required
            rows={2}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-blue-500 resize-none"
          />

          <textarea
            placeholder={`Rules (be specific):\n- Entry condition: e.g. buy YES when price drops below 30¢ on a market with >$100k volume\n- Exit condition: e.g. sell when price recovers above 50¢ or market closes\n- Position size: e.g. 5% of balance per trade, max 3 open positions\n- Market filter: e.g. only politics markets, only active markets with >7 days left`}
            value={rules}
            onChange={e => setRules(e.target.value)}
            required
            rows={6}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-blue-500 resize-none font-mono"
          />

          {submitMsg && (
            <p className={`text-xs ${submitMsg.includes('submitted') ? 'text-green-400' : 'text-red-400'}`}>
              {submitMsg}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !name.trim() || !description.trim() || !rules.trim()}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold py-2 rounded-lg transition text-sm"
          >
            {submitting ? 'Submitting…' : 'Submit strategy'}
          </button>
        </form>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 text-zinc-500 text-sm">
          Log in to propose a strategy.
        </div>
      )}

      {/* My strategies */}
      {mine.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-3">
            My strategies <span className="text-zinc-500 text-sm font-normal">({mine.length})</span>
          </h2>
          <div className="space-y-2">
            {mine.map(s => (
              <StrategyCard
                key={s.id}
                strategy={s}
                expanded={expanded}
                setExpanded={setExpanded}
                onToggle={toggleEnabled}
                isOwner
                onUpdate={updateStrategy}
              />
            ))}
          </div>
        </div>
      )}

      {/* All strategies */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-3">
          {mine.length > 0 ? 'Other strategies' : 'All strategies'}
          <span className="text-zinc-500 text-sm font-normal ml-2">({others.length})</span>
        </h2>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-zinc-900 rounded-xl animate-pulse" />)}
          </div>
        ) : others.length === 0 ? (
          <p className="text-zinc-600 text-sm bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            No strategies yet — be the first to propose one.
          </p>
        ) : (
          <div className="space-y-2">
            {others.map(s => (
              <StrategyCard
                key={s.id}
                strategy={s}
                expanded={expanded}
                setExpanded={setExpanded}
                onToggle={toggleEnabled}
                isOwner={false}
                onUpdate={updateStrategy}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function StrategyCard({ strategy: s, expanded, setExpanded, onToggle, isOwner, onUpdate }: {
  strategy: Strategy;
  expanded: number | null;
  setExpanded: (id: number | null) => void;
  onToggle: (s: Strategy) => void;
  isOwner: boolean;
  onUpdate: (id: number, patch: Partial<Strategy>) => void;
}) {
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);
  const isOpen = expanded === s.id;

  async function submitReply() {
    if (!reply.trim()) return;
    setReplying(true);
    await fetch(`/api/strategies/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appendRules: reply }),
    });
    onUpdate(s.id, { rules: s.rules + '\n\n---\n**Reply:** ' + reply.trim() });
    setReply('');
    setReplying(false);
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-3">
        <button
          className="flex-1 text-left flex items-center gap-3 min-w-0"
          onClick={() => setExpanded(isOpen ? null : s.id)}
        >
          <span className="text-white text-sm font-medium truncate">{s.name}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS_COLORS[s.status] ?? 'bg-zinc-700 text-zinc-300'}`}>
            {s.status}
          </span>
          <span className="text-zinc-600 text-xs flex-shrink-0 hidden sm:inline">{s.username}</span>
          <span className="text-zinc-600 text-xs flex-shrink-0">{timeAgo(s.created_at)}</span>
          <span className="text-zinc-600 text-xs flex-shrink-0">{isOpen ? '▲' : '▼'}</span>
        </button>

        {isOwner && (
          <button
            onClick={() => onToggle(s)}
            className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium transition ${
              s.enabled
                ? 'bg-green-800 hover:bg-red-800 text-green-200 hover:text-red-200'
                : 'bg-zinc-700 hover:bg-green-800 text-zinc-400 hover:text-green-200'
            }`}
          >
            {s.enabled ? 'On' : 'Off'}
          </button>
        )}
      </div>

      {isOpen && (
        <div className="px-4 pb-4 border-t border-zinc-800 pt-3 space-y-3">
          <p className="text-zinc-400 text-sm leading-relaxed">{s.description}</p>
          <div className="bg-zinc-800 rounded-lg p-3">
            <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-2">Rules</p>
            <p className="text-zinc-300 text-xs leading-relaxed font-mono whitespace-pre-wrap">{s.rules}</p>
          </div>
          {s.ai_review && (
            <div className="bg-zinc-800 rounded-lg p-3 border-l-2 border-blue-500">
              <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-1">Claude's review</p>
              <p className="text-zinc-200 text-sm leading-relaxed whitespace-pre-wrap">{s.ai_review}</p>
            </div>
          )}

          {s.ai_review && isOwner && (
            <div className="space-y-2">
              <p className="text-zinc-400 text-xs font-medium">Reply to Claude's questions:</p>
              <textarea
                value={reply}
                onChange={e => setReply(e.target.value)}
                placeholder="Answer the questions above so Claude can build your strategy…"
                rows={3}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-blue-500 resize-none"
              />
              <button
                onClick={submitReply}
                disabled={replying || !reply.trim()}
                className="text-xs bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition font-medium"
              >
                {replying ? 'Sending…' : 'Send reply'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
