'use client';
import { useEffect, useState, useCallback } from 'react';
import { useUser } from '../components/UserProvider';

interface Ticket {
  id: number;
  username: string;
  type: string;
  title: string;
  body: string;
  status: string;
  ai_response: string | null;
  created_at: string;
  updated_at: string;
}

const TYPE_LABELS: Record<string, string> = { bug: '🐛 Bug', feature: '✨ Feature', other: '💬 Other' };
const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-900/60 text-blue-300',
  needs_info: 'bg-yellow-900/60 text-yellow-300',
  resolved: 'bg-green-900/60 text-green-300',
};

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function TicketsPage() {
  const { username } = useUser();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [reviewing, setReviewing] = useState<number | null>(null);
  const [resolving, setResolving] = useState<number | null>(null);

  // Submit form state
  const [type, setType] = useState('bug');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  const load = useCallback(() =>
    fetch('/api/tickets').then(r => r.json()).then(d => {
      if (Array.isArray(d)) setTickets(d);
      setLoading(false);
    }).catch(() => setLoading(false))
  , []);

  useEffect(() => { load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !title.trim() || !body.trim()) return;
    setSubmitting(true);
    setSubmitMsg(null);
    const res = await fetch('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, type, title, body }),
    });
    const d = await res.json();
    setSubmitting(false);
    if (res.ok) {
      setTitle(''); setBody(''); setType('bug');
      setSubmitMsg('Ticket submitted — thanks!');
      load();
    } else {
      setSubmitMsg(d.error ?? 'Failed to submit.');
    }
  }

  async function review(ticket: Ticket) {
    setReviewing(ticket.id);
    const res = await fetch(`/api/tickets/${ticket.id}/review`, { method: 'POST' });
    const d = await res.json();
    if (res.ok) {
      setTickets(prev => prev.map(t => t.id === ticket.id
        ? { ...t, ai_response: d.response, status: d.status }
        : t
      ));
      setExpanded(ticket.id);
    }
    setReviewing(null);
  }

  async function resolve(ticket: Ticket) {
    setResolving(ticket.id);
    await fetch(`/api/tickets/${ticket.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: ticket.status === 'resolved' ? 'open' : 'resolved' }),
    });
    setTickets(prev => prev.map(t => t.id === ticket.id
      ? { ...t, status: t.status === 'resolved' ? 'open' : 'resolved' }
      : t
    ));
    setResolving(null);
  }

  const open = tickets.filter(t => t.status !== 'resolved');
  const resolved = tickets.filter(t => t.status === 'resolved');

  return (
    <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">🎫 Tickets</h1>
        <p className="text-zinc-400 text-sm">Report a bug or request a feature. Claude reviews every ticket.</p>
      </div>

      {/* Submit form */}
      {username ? (
        <form onSubmit={submit} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
          <h2 className="text-white font-semibold text-sm">Open a ticket</h2>

          <div className="flex gap-2">
            {(['bug', 'feature', 'other'] as const).map(t => (
              <button
                key={t} type="button"
                onClick={() => setType(t)}
                className={`flex-1 text-xs py-1.5 rounded-lg transition font-medium ${
                  type === t ? 'bg-blue-600 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'
                }`}
              >
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          <input
            type="text"
            placeholder="Short title — what's the issue?"
            value={title}
            onChange={e => setTitle(e.target.value)}
            maxLength={200}
            required
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-blue-500"
          />

          <textarea
            placeholder={
              type === 'bug'
                ? 'What happened? What did you expect? Steps to reproduce…'
                : type === 'feature'
                ? 'What would you like to see? Why would it be useful?'
                : 'Describe your feedback…'
            }
            value={body}
            onChange={e => setBody(e.target.value)}
            required
            rows={4}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-blue-500 resize-none"
          />

          {submitMsg && (
            <p className={`text-xs ${submitMsg.includes('thanks') ? 'text-green-400' : 'text-red-400'}`}>
              {submitMsg}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !title.trim() || !body.trim()}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold py-2 rounded-lg transition text-sm"
          >
            {submitting ? 'Submitting…' : 'Submit ticket'}
          </button>
        </form>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 text-zinc-500 text-sm">
          Log in to submit a ticket.
        </div>
      )}

      {/* Open tickets */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-3">
          Open <span className="text-zinc-500 text-sm font-normal">({open.length})</span>
        </h2>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-zinc-900 rounded-xl animate-pulse" />)}
          </div>
        ) : open.length === 0 ? (
          <p className="text-zinc-600 text-sm bg-zinc-900 border border-zinc-800 rounded-xl p-4">No open tickets.</p>
        ) : (
          <div className="space-y-2">
            {open.map(t => <TicketCard key={t.id} ticket={t} expanded={expanded} setExpanded={setExpanded} reviewing={reviewing} resolving={resolving} onReview={review} onResolve={resolve} />)}
          </div>
        )}
      </div>

      {/* Resolved tickets */}
      {resolved.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-3">
            Resolved <span className="text-zinc-500 text-sm font-normal">({resolved.length})</span>
          </h2>
          <div className="space-y-2">
            {resolved.map(t => <TicketCard key={t.id} ticket={t} expanded={expanded} setExpanded={setExpanded} reviewing={reviewing} resolving={resolving} onReview={review} onResolve={resolve} />)}
          </div>
        </div>
      )}
    </main>
  );
}

function TicketCard({ ticket: t, expanded, setExpanded, reviewing, resolving, onReview, onResolve }: {
  ticket: Ticket;
  expanded: number | null;
  setExpanded: (id: number | null) => void;
  reviewing: number | null;
  resolving: number | null;
  onReview: (t: Ticket) => void;
  onResolve: (t: Ticket) => void;
}) {
  const isOpen = expanded === t.id;

  return (
    <div className={`bg-zinc-900 border rounded-xl overflow-hidden transition ${
      t.status === 'resolved' ? 'border-zinc-800 opacity-70' : 'border-zinc-800'
    }`}>
      <button
        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-zinc-800/40 transition"
        onClick={() => setExpanded(isOpen ? null : t.id)}
      >
        <span className="text-xs text-zinc-500 flex-shrink-0">{TYPE_LABELS[t.type] ?? t.type}</span>
        <span className="text-white text-sm font-medium flex-1 truncate">{t.title}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS_COLORS[t.status] ?? 'bg-zinc-800 text-zinc-400'}`}>
          {t.status === 'needs_info' ? 'needs info' : t.status}
        </span>
        <span className="text-zinc-600 text-xs flex-shrink-0">{timeAgo(t.created_at)}</span>
        <span className="text-zinc-600 text-xs flex-shrink-0">{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-3 border-t border-zinc-800 pt-3">
          <p className="text-zinc-500 text-xs">by <span className="text-zinc-300">{t.username}</span></p>
          <p className="text-zinc-300 text-sm leading-relaxed whitespace-pre-wrap">{t.body}</p>

          {t.ai_response && (
            <div className="bg-zinc-800 rounded-lg p-3 border-l-2 border-blue-500">
              <p className="text-zinc-500 text-xs mb-1 font-semibold uppercase tracking-wider">Claude's response</p>
              <p className="text-zinc-200 text-sm leading-relaxed whitespace-pre-wrap">{t.ai_response}</p>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => onReview(t)}
              disabled={reviewing === t.id}
              className="text-xs bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-zinc-200 px-3 py-1.5 rounded-lg transition font-medium"
            >
              {reviewing === t.id ? 'Reviewing…' : t.ai_response ? '🤖 Re-review' : '🤖 Review'}
            </button>
            <button
              onClick={() => onResolve(t)}
              disabled={resolving === t.id}
              className={`text-xs px-3 py-1.5 rounded-lg transition font-medium ${
                t.status === 'resolved'
                  ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-400'
                  : 'bg-green-800 hover:bg-green-700 text-green-200'
              }`}
            >
              {resolving === t.id ? '…' : t.status === 'resolved' ? 'Reopen' : '✓ Resolve'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
