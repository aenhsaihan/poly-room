'use client';
import { useEffect, useRef, useState } from 'react';
import type { Market } from '@/lib/polymarket';
import type { DeskReport, AnalystReport } from '@/lib/agents';
import { useUser } from './UserProvider';
import BetModal from './BetModal';

interface DeskRun {
  id: number;
  username: string;
  action: string;
  conviction: number;
  yesPrice: number;
  report: DeskReport;
  createdAt: string;
}

const STAGE_LABELS = [
  'Analyst team is reporting in…',
  'Bull and Bear researchers are debating…',
  'Research Manager is weighing the debate…',
  'Trader is drafting the order…',
  'Risk team is arguing over position size…',
  'Portfolio Manager is making the final call…',
];
const N_STAGES = STAGE_LABELS.length;

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const stanceColor = (s: string) =>
  s === 'BULLISH' ? 'bg-green-900/80 text-green-300' :
  s === 'BEARISH' ? 'bg-red-900/80 text-red-300' : 'bg-zinc-700 text-zinc-300';

const actionColor = (a: string) =>
  a === 'BUY YES' ? 'bg-green-600 text-white' :
  a === 'BUY NO' ? 'bg-red-600 text-white' : 'bg-zinc-600 text-zinc-200';

export default function AgentDesk({ market }: { market: Market }) {
  const { username } = useUser();
  const [run, setRun] = useState<DeskRun | null>(null);
  const [running, setRunning] = useState(false);
  const [revealed, setRevealed] = useState(N_STAGES); // prior runs show fully
  const [error, setError] = useState<string | null>(null);
  const [betOutcome, setBetOutcome] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch(`/api/agent-desk/${market.id}`)
      .then(r => r.json())
      .then(d => { if (d?.report) setRun(d); })
      .catch(() => {});
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [market.id]);

  async function convene() {
    setRunning(true);
    setError(null);
    setRevealed(0);
    try {
      const r = await fetch(`/api/agent-desk/${market.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username || 'guest' }),
      });
      if (!r.ok) throw new Error('desk failed');
      const d = await r.json();
      setRun(d);
      // theatrical staged reveal — data is already here
      timerRef.current = setInterval(() => {
        setRevealed(prev => {
          if (prev + 1 >= N_STAGES) {
            if (timerRef.current) clearInterval(timerRef.current);
            setRunning(false);
            return N_STAGES;
          }
          return prev + 1;
        });
      }, 900);
    } catch {
      setError('The desk could not convene — try again in a moment.');
      setRunning(false);
      setRevealed(N_STAGES);
    }
  }

  const report = run?.report;
  const show = (stage: number) => report && revealed >= stage;

  return (
    <>
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-white font-semibold">🤖 Agent Desk</span>
            <span className="text-xs text-zinc-600 hidden sm:inline">multi-agent pipeline, TradingAgents-style</span>
            {report?.narrator === 'ai' && (
              <span className="text-xs bg-purple-900/60 text-purple-300 px-2 py-0.5 rounded-full font-medium">✨ AI-narrated</span>
            )}
          </div>
          <button
            onClick={convene}
            disabled={running}
            className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold px-4 py-1.5 rounded-lg transition"
          >
            {running ? 'Desk in session…' : run ? 'Run the Desk again' : 'Run the Desk'}
          </button>
        </div>

        <div className="p-5 space-y-5">
          {!report && !running && (
            <p className="text-zinc-400 text-sm leading-relaxed">
              Convene an analyst team on this market: four specialist agents gather evidence
              (price action, real money flow, calibration, community positioning), a Bull and a Bear
              researcher debate it, a risk team fights over sizing, and a Portfolio Manager issues
              a final call. Every claim is computed from live data — no magic, all receipts.
            </p>
          )}
          {error && <p className="text-red-400 text-sm">{error}</p>}

          {report && run && revealed >= N_STAGES && !running && (
            <p className="text-zinc-600 text-xs">
              Last convened {timeAgo(run.createdAt)} by <span className="text-zinc-400">{run.username}</span> with
              YES at <span className="font-mono">{(run.yesPrice * 100).toFixed(1)}¢</span>
            </p>
          )}

          {running && revealed < N_STAGES && (
            <div className="flex items-center gap-2 text-sm text-blue-300">
              <span className="inline-block h-3 w-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
              {STAGE_LABELS[revealed]}
            </div>
          )}

          {/* Stage 1: Analysts */}
          {show(0) && (
            <div>
              <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-3">1 · Analyst Team</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {report!.analysts.map((a: AnalystReport) => (
                  <div key={a.id} className="bg-zinc-800 rounded-xl p-3.5">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span>{a.emoji}</span>
                        <div>
                          <p className="text-white text-sm font-semibold leading-none">{a.name}</p>
                          <p className="text-zinc-600 text-xs mt-0.5">{a.role}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${stanceColor(a.stance)}`}>{a.stance}</span>
                        <p className="text-zinc-600 text-xs mt-1">{a.confidence} confidence</p>
                      </div>
                    </div>
                    <ul className="space-y-1.5">
                      {a.findings.map((f, i) => (
                        <li key={i} className="text-xs leading-relaxed flex gap-1.5">
                          <span className={f.sentiment === 'bull' ? 'text-green-500' : f.sentiment === 'bear' ? 'text-red-500' : 'text-zinc-600'}>
                            {f.sentiment === 'bull' ? '▲' : f.sentiment === 'bear' ? '▼' : '•'}
                          </span>
                          <span className="text-zinc-400">{f.text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stage 2: Debate */}
          {show(1) && (
            <div>
              <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-3">2 · Researcher Debate</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-green-950/40 border border-green-900/50 rounded-xl p-3.5">
                  <p className="text-green-400 text-sm font-bold mb-2">🐂 Bull Researcher</p>
                  <ul className="space-y-2">
                    {report!.debate.bull.map((arg, i) => (
                      <li key={i} className="text-xs text-zinc-300 leading-relaxed">{arg}</li>
                    ))}
                  </ul>
                </div>
                <div className="bg-red-950/40 border border-red-900/50 rounded-xl p-3.5">
                  <p className="text-red-400 text-sm font-bold mb-2">🐻 Bear Researcher</p>
                  <ul className="space-y-2">
                    {report!.debate.bear.map((arg, i) => (
                      <li key={i} className="text-xs text-zinc-300 leading-relaxed">{arg}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Stage 3: Research Manager */}
          {show(2) && (
            <div>
              <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-3">3 · Research Manager</p>
              <div className="bg-zinc-800 rounded-xl p-4 flex items-start gap-4">
                <span className="text-2xl">🧑‍⚖️</span>
                <div>
                  <p className="text-white text-sm font-bold mb-1">Rating on YES: <span className="text-blue-300">{report!.research.rating}</span></p>
                  <p className="text-zinc-400 text-xs leading-relaxed">{report!.research.rationale}</p>
                </div>
              </div>
            </div>
          )}

          {/* Stage 4: Trader */}
          {show(3) && (
            <div>
              <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-3">4 · Trader</p>
              <div className="bg-zinc-800 rounded-xl p-4 flex items-start gap-4">
                <span className="text-2xl">🧑‍💻</span>
                <div>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded ${actionColor(report!.trader.action)}`}>{report!.trader.action}</span>
                  <p className="text-zinc-400 text-xs leading-relaxed mt-2">{report!.trader.justification}</p>
                </div>
              </div>
            </div>
          )}

          {/* Stage 5: Risk Team */}
          {show(4) && (
            <div>
              <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-3">5 · Risk Team</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {([
                  ['🔥', 'Aggressive', report!.risk.aggressive],
                  ['⚖️', 'Neutral', report!.risk.neutral],
                  ['🛡️', 'Conservative', report!.risk.conservative],
                ] as const).map(([emoji, name, text]) => (
                  <div key={name} className="bg-zinc-800 rounded-xl p-3.5">
                    <p className="text-white text-xs font-bold mb-1.5">{emoji} {name}</p>
                    <p className="text-zinc-400 text-xs leading-relaxed">{text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stage 6: Final Decision */}
          {show(5) && (
            <div>
              <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-3">6 · Portfolio Manager — Final Call</p>
              <div className={`rounded-xl p-5 border ${
                report!.decision.action === 'BUY YES' ? 'bg-green-950/40 border-green-800' :
                report!.decision.action === 'BUY NO' ? 'bg-red-950/40 border-red-800' :
                'bg-zinc-800 border-zinc-700'
              }`}>
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <span className={`text-sm font-black px-3 py-1.5 rounded-lg ${actionColor(report!.decision.action)}`}>
                    {report!.decision.action}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-500 text-xs">conviction</span>
                    <div className="w-28 h-2 bg-zinc-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${report!.decision.conviction >= 50 ? 'bg-blue-400' : 'bg-zinc-500'}`}
                        style={{ width: `${report!.decision.conviction}%` }}
                      />
                    </div>
                    <span className="text-white font-mono text-xs font-bold">{report!.decision.conviction}/100</span>
                  </div>
                  {report!.decision.suggestedStakePct > 0 && (
                    <span className="text-zinc-400 text-xs">
                      suggested stake: <span className="text-white font-mono font-bold">{report!.decision.suggestedStakePct}%</span> of balance
                    </span>
                  )}
                </div>
                <p className="text-zinc-300 text-sm leading-relaxed mb-4">{report!.decision.thesis}</p>
                {report!.decision.action !== 'HOLD' && username && (
                  <button
                    onClick={() => setBetOutcome(report!.decision.action === 'BUY YES' ? market.outcomes[0] : market.outcomes[1])}
                    className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-5 py-2 rounded-lg transition"
                  >
                    Trade this call →
                  </button>
                )}
                <p className="text-zinc-600 text-xs mt-3">
                  Computed from live market data — not financial advice, and the desk has been wrong before. Check the Agents tab to see its track record.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {betOutcome && <BetModal market={market} defaultOutcome={betOutcome} onClose={() => setBetOutcome(null)} />}
    </>
  );
}
