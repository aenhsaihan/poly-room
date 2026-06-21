// LLM narration for the Agent Desk via Groq (OpenAI-compatible API).
// The deterministic engine in lib/agents.ts remains the source of truth for all
// numbers, scores, and the final decision — the LLM only writes the words around
// them (debate arguments, risk voices, thesis) and contributes background
// knowledge as a separate, zero-weight Domain Analyst.

import type { Market } from './polymarket';
import type { DeskReport } from './agents';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

interface Narration {
  bull: string[];
  bear: string[];
  researchRationale: string;
  traderJustification: string;
  riskAggressive: string;
  riskNeutral: string;
  riskConservative: string;
  thesis: string;
  domainFindings: string[];
}

const okStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const okArr = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every(okStr);

export async function narrateDesk(report: DeskReport, market: Market): Promise<DeskReport> {
  if (!process.env.GROQ_API_KEY) return { ...report, narrator: 'rules' };

  const evidence = report.analysts.map(a =>
    `${a.name} (${a.stance}, score ${a.score.toFixed(2)}):\n` +
    a.findings.map(f => `  - [${f.sentiment}] ${f.text}`).join('\n')
  ).join('\n');

  const daysLeft = market.endDate
    ? Math.ceil((new Date(market.endDate).getTime() - Date.now()) / 86400000)
    : null;

  const prompt = `You are the narrator for a multi-agent trading desk analyzing a prediction market. The desk's quantitative engine has ALREADY decided — your job is to write the dialogue around its decision, not to change it.

MARKET: "${market.question}"
YES price: ${(report.yesPrice * 100).toFixed(1)}¢${daysLeft !== null ? ` | resolves in ~${daysLeft} days` : ''}

COMPUTED EVIDENCE (the only numbers you may cite):
${evidence}

LOCKED DECISION (do not contradict it anywhere):
- Research rating on YES: ${report.research.rating}
- Trader action: ${report.trader.action}
- Conviction: ${report.decision.conviction}/100
- Suggested stake: ${report.decision.suggestedStakePct}% of balance

Write JSON with exactly these fields:
{
  "bull": [3-4 strings] — Bull Researcher's arguments. Sharp trading-floor voice. Each must cite at least one number from the evidence. Max 35 words each.
  "bear": [3-4 strings] — Bear Researcher's counterarguments, same rules. If the evidence gives the bear almost nothing, have them concede grudgingly but find the one real risk.
  "researchRationale": string — Research Manager weighing both sides and landing on the locked rating. Max 60 words.
  "traderJustification": string — Trader explaining the locked action in plain English, including (if action is BUY NO) that bearish views are expressed by buying NO. Max 50 words.
  "riskAggressive": string — Aggressive risk officer pushing for more size. Max 40 words.
  "riskNeutral": string — Neutral officer defending exactly the locked stake %. Max 40 words.
  "riskConservative": string — Conservative officer urging caution, citing a concrete risk from the evidence. Max 40 words.
  "thesis": string — Portfolio Manager's final memo: the locked action, why, and the stake. Max 70 words.
  "domainFindings": [2-3 strings] — Background facts you know about this question's topic that traders should weigh (history, structure of the event, base rates). These are from your general knowledge, NOT live news — never claim recency, never invent statistics or prices. Max 35 words each.
}

Rules: never invent numbers not in the evidence (well-known background facts are fine in domainFindings only); never contradict the locked decision; no emojis; no hedging boilerplate. Write complete, punchy sentences with subjects and verbs — clipped fragments like "strong signal, good flow" are forbidden. Each speaker should sound like a person mid-argument, referencing what another desk member said where natural.`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 1600,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`Groq ${res.status}`);
    const data = await res.json() as { choices: { message: { content: string } }[] };
    const n = JSON.parse(data.choices[0].message.content) as Partial<Narration>;

    // merge: every field falls back to the rule-based text if the LLM flubbed it
    const out: DeskReport = {
      ...report,
      narrator: 'ai',
      debate: {
        bull: okArr(n.bull) ? n.bull.map(s => s.trim()) : report.debate.bull,
        bear: okArr(n.bear) ? n.bear.map(s => s.trim()) : report.debate.bear,
      },
      research: {
        ...report.research,
        rationale: okStr(n.researchRationale) ? n.researchRationale.trim() : report.research.rationale,
      },
      trader: {
        ...report.trader,
        justification: okStr(n.traderJustification) ? n.traderJustification.trim() : report.trader.justification,
      },
      risk: {
        aggressive: okStr(n.riskAggressive) ? n.riskAggressive.trim() : report.risk.aggressive,
        neutral: okStr(n.riskNeutral) ? n.riskNeutral.trim() : report.risk.neutral,
        conservative: okStr(n.riskConservative) ? n.riskConservative.trim() : report.risk.conservative,
      },
      decision: {
        ...report.decision,
        thesis: okStr(n.thesis) ? n.thesis.trim() : report.decision.thesis,
      },
    };

    if (okArr(n.domainFindings)) {
      out.analysts = [
        ...report.analysts,
        {
          id: 'domain', emoji: '🧠', name: 'Domain Analyst', role: 'background knowledge (AI, not live news)',
          stance: 'NEUTRAL', score: 0, confidence: 'low',
          findings: n.domainFindings.map(text => ({ text: text.trim(), sentiment: 'neutral' as const, weight: 0.3 })),
        },
      ];
    }
    return out;
  } catch {
    return { ...report, narrator: 'rules' };
  }
}
