// Multi-agent trading desk, modeled on TauricResearch/TradingAgents:
// analysts → bull/bear debate → research manager → trader → risk debate → portfolio manager.
// Deterministic: every agent argues from computed evidence instead of LLM sampling,
// so runs are free, instant, and every claim carries a real number.

import type { Market, PricePoint, RealTrade } from './polymarket';

export interface CommunityPosition {
  outcome: string;
  holderCount: number;
  totalValue: number;
  avgPrice: number;
}

export interface Finding {
  text: string;
  sentiment: 'bull' | 'bear' | 'neutral'; // on YES
  weight: number; // 0..1, how load-bearing this finding is
}

export type Stance = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type Rating = 'BUY' | 'OVERWEIGHT' | 'HOLD' | 'UNDERWEIGHT' | 'SELL';
export type Action = 'BUY YES' | 'BUY NO' | 'HOLD';

export interface AnalystReport {
  id: string;
  emoji: string;
  name: string;
  role: string;
  stance: Stance;
  score: number; // -1 (max bearish on YES) .. +1 (max bullish on YES)
  confidence: 'low' | 'medium' | 'high';
  findings: Finding[];
}

export interface DeskReport {
  analysts: AnalystReport[];
  debate: { bull: string[]; bear: string[] };
  research: { rating: Rating; rationale: string };
  trader: { action: Action; justification: string };
  risk: { aggressive: string; neutral: string; conservative: string };
  decision: {
    action: Action;
    rating: Rating;
    conviction: number;       // 0..100
    suggestedStakePct: number; // % of balance
    thesis: string;
  };
  yesPrice: number;
  narrator?: 'ai' | 'rules';
}

// Same historical resolution table used by the calibration panel
const CALIB = [6.2, 14.8, 24.9, 34.3, 44.1, 55.7, 65.2, 75.1, 84.3, 91.8];

const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const sma = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
const stdev = (v: number[]) => {
  const m = sma(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
};

function rsi(prices: number[], period = 14): number | null {
  if (prices.length < period + 1) return null;
  let gain = 0, loss = 0;
  for (let j = prices.length - period; j < prices.length; j++) {
    const d = prices[j] - prices[j - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

function ema(prices: number[], period: number): number {
  const a = 2 / (period + 1);
  let e = prices[0];
  for (let i = 1; i < prices.length; i++) e = a * prices[i] + (1 - a) * e;
  return e;
}

function stanceOf(score: number): Stance {
  if (score > 0.15) return 'BULLISH';
  if (score < -0.15) return 'BEARISH';
  return 'NEUTRAL';
}

const cents = (p: number) => `${(p * 100).toFixed(1)}¢`;
const usd = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${n.toFixed(0)}`;

// ---------- Layer 1: Analysts (parallel) ----------

function marketAnalyst(history: PricePoint[], yes: number): AnalystReport {
  const findings: Finding[] = [];
  let score = 0;
  const prices = history.map(p => p.p);

  if (prices.length < 10) {
    findings.push({ text: 'Too little price history to read a trend — staying on the sidelines.', sentiment: 'neutral', weight: 0.2 });
    return { id: 'market', emoji: '📈', name: 'Market Analyst', role: 'price action & technicals', stance: 'NEUTRAL', score: 0, confidence: 'low', findings };
  }

  const r = rsi(prices);
  if (r !== null) {
    if (r < 30) { score += 0.45; findings.push({ text: `RSI is ${r.toFixed(0)} — the market looks oversold; sellers may be exhausted.`, sentiment: 'bull', weight: 0.8 }); }
    else if (r > 70) { score -= 0.45; findings.push({ text: `RSI is ${r.toFixed(0)} — the market looks overbought; the rally may be stretched.`, sentiment: 'bear', weight: 0.8 }); }
    else findings.push({ text: `RSI is ${r.toFixed(0)} — neither overbought nor oversold.`, sentiment: 'neutral', weight: 0.3 });
  }

  const eF = ema(prices, 8), eS = ema(prices, 21);
  if (eF > eS * 1.005) { score += 0.35; findings.push({ text: `Short-term trend (EMA-8 ${cents(eF)}) is above the long-term trend (EMA-21 ${cents(eS)}) — momentum favors YES.`, sentiment: 'bull', weight: 0.7 }); }
  else if (eF < eS * 0.995) { score -= 0.35; findings.push({ text: `Short-term trend (EMA-8 ${cents(eF)}) is below the long-term trend (EMA-21 ${cents(eS)}) — momentum favors NO.`, sentiment: 'bear', weight: 0.7 }); }
  else findings.push({ text: 'Short- and long-term trends are flat against each other — no momentum edge.', sentiment: 'neutral', weight: 0.3 });

  const lookback = Math.min(24, prices.length - 1);
  const change = yes - prices[prices.length - 1 - lookback];
  if (Math.abs(change) >= 0.03) {
    const dir = change > 0 ? 'bull' : 'bear';
    score += change > 0 ? 0.2 : -0.2;
    findings.push({ text: `Price moved ${change > 0 ? 'up' : 'down'} ${(Math.abs(change) * 100).toFixed(1)}¢ over the recent window — ${change > 0 ? 'buyers' : 'sellers'} are in control.`, sentiment: dir, weight: 0.5 });
  }

  const vol = stdev(prices.slice(-30));
  const choppy = vol > 0.05;
  if (choppy) findings.push({ text: `Volatility is elevated (±${(vol * 100).toFixed(1)}¢ swings) — signals here are noisier than usual.`, sentiment: 'neutral', weight: 0.4 });

  // indicators carry little information when price is pinned near 0 or 1
  const pinned = yes < 0.03 || yes > 0.97;
  if (pinned) {
    score *= 0.3;
    findings.push({ text: `Price is pinned near ${yes < 0.03 ? 'zero' : 'one'} — oscillators and trend signals barely mean anything out here; discounting them heavily.`, sentiment: 'neutral', weight: 0.6 });
  }

  return {
    id: 'market', emoji: '📈', name: 'Market Analyst', role: 'price action & technicals',
    stance: stanceOf(score), score: clamp(score),
    confidence: pinned ? 'low' : choppy ? 'medium' : prices.length > 100 ? 'high' : 'medium',
    findings,
  };
}

function flowAnalyst(trades: RealTrade[]): AnalystReport {
  const findings: Finding[] = [];
  let score = 0;

  if (trades.length === 0) {
    findings.push({ text: 'No recent real-money trades to read — order flow is silent.', sentiment: 'neutral', weight: 0.2 });
    return { id: 'flow', emoji: '💸', name: 'Flow Analyst', role: 'real money on Polymarket', stance: 'NEUTRAL', score: 0, confidence: 'low', findings };
  }

  // BUY Yes and SELL No are both bullish-YES dollars
  let bullUsd = 0, bearUsd = 0, whaleNet = 0, whales = 0;
  for (const t of trades) {
    const amt = t.size * t.price;
    const isYes = t.outcome.toLowerCase() === 'yes';
    const bullish = (t.side === 'BUY' && isYes) || (t.side === 'SELL' && !isYes);
    if (bullish) bullUsd += amt; else bearUsd += amt;
    if (amt >= 1000) { whales++; whaleNet += bullish ? 1 : -1; }
  }
  const total = bullUsd + bearUsd;
  const ratio = total > 0 ? (bullUsd - bearUsd) / total : 0;
  score += ratio * 0.9;

  findings.push({
    text: `Of the last ${trades.length} real trades (${usd(total)}), ${(((bullUsd) / Math.max(total, 1)) * 100).toFixed(0)}% of dollars backed YES — ${ratio > 0.15 ? 'real money is leaning YES' : ratio < -0.15 ? 'real money is leaning NO' : 'flow is roughly balanced'}.`,
    sentiment: ratio > 0.15 ? 'bull' : ratio < -0.15 ? 'bear' : 'neutral',
    weight: 0.9,
  });

  if (whales > 0) {
    score += clamp(whaleNet * 0.15, -0.3, 0.3);
    findings.push({
      text: `${whales} whale trade${whales > 1 ? 's' : ''} (≥$1K) in the tape, net ${whaleNet > 0 ? 'buying YES' : whaleNet < 0 ? 'buying NO' : 'split both ways'} — big accounts ${whaleNet === 0 ? 'disagree with each other' : 'are taking a side'}.`,
      sentiment: whaleNet > 0 ? 'bull' : whaleNet < 0 ? 'bear' : 'neutral',
      weight: 0.7,
    });
  }

  const newest = Math.max(...trades.map(t => t.timestamp));
  const hrs = (Date.now() / 1000 - newest) / 3600;
  if (hrs > 12) findings.push({ text: `Last real trade was ${hrs.toFixed(0)}h ago — this market is thinly traded right now.`, sentiment: 'neutral', weight: 0.4 });

  return {
    id: 'flow', emoji: '💸', name: 'Flow Analyst', role: 'real money on Polymarket',
    stance: stanceOf(score), score: clamp(score),
    confidence: total > 5000 ? 'high' : total > 500 ? 'medium' : 'low',
    findings,
  };
}

function fundamentalsAnalyst(market: Market, yes: number): AnalystReport {
  const findings: Finding[] = [];
  let score = 0;

  const bucket = Math.min(Math.floor(yes * 10), 9);
  const hist = CALIB[bucket];
  const diff = yes * 100 - hist; // positive → YES priced above its historical hit rate
  const extreme = yes < 0.05 || yes > 0.95;
  if (extreme) {
    findings.push({ text: `Price is pinned at ${cents(yes)} — too extreme to compare against bucket-average resolution rates; no calibration read at the tails.`, sentiment: 'neutral', weight: 0.5 });
  } else if (Math.abs(diff) >= 2) {
    score += clamp(-diff / 18, -0.5, 0.5);
    findings.push({
      text: `Markets priced ${bucket * 10}–${bucket * 10 + 10}¢ have historically resolved YES ${hist}% of the time; this one implies ${(yes * 100).toFixed(1)}% — YES looks ${diff > 0 ? 'about ' + diff.toFixed(1) + ' points rich' : 'about ' + Math.abs(diff).toFixed(1) + ' points cheap'} vs. history.`,
      sentiment: diff > 0 ? 'bear' : 'bull',
      weight: 0.8,
    });
  } else {
    findings.push({ text: `Price sits within ~2 points of the historical resolution rate for its bucket — no calibration edge either way.`, sentiment: 'neutral', weight: 0.5 });
  }

  const liqRatio = market.volume > 0 ? market.liquidity / market.volume : 0;
  if (market.liquidity < 5000) findings.push({ text: `Liquidity is thin (${usd(market.liquidity)}) — prices can be pushed around by single trades.`, sentiment: 'neutral', weight: 0.6 });
  else if (liqRatio > 0.05) findings.push({ text: `Liquidity is deep (${usd(market.liquidity)}) relative to volume — the current price is hard-fought and informative.`, sentiment: 'neutral', weight: 0.4 });

  if (market.volume >= 1_000_000) findings.push({ text: `${usd(market.volume)} total volume — a large crowd has priced this; big mispricings are less likely.`, sentiment: 'neutral', weight: 0.5 });
  else if (market.volume < 50_000) findings.push({ text: `Only ${usd(market.volume)} total volume — a small crowd; the price embeds less information.`, sentiment: 'neutral', weight: 0.5 });

  const daysLeft = market.endDate ? Math.ceil((new Date(market.endDate).getTime() - Date.now()) / 86400000) : null;
  if (daysLeft !== null && daysLeft > 0 && daysLeft <= 3) {
    findings.push({ text: `Resolves in ${daysLeft} day${daysLeft > 1 ? 's' : ''} — outcomes near resolution move fast and violently.`, sentiment: 'neutral', weight: 0.6 });
  }

  return {
    id: 'fundamentals', emoji: '🧮', name: 'Fundamentals Analyst', role: 'calibration & market quality',
    stance: stanceOf(score), score: clamp(score),
    confidence: market.volume > 100_000 ? 'high' : 'medium',
    findings,
  };
}

function sentimentAnalyst(positions: CommunityPosition[], commentCount: number): AnalystReport {
  const findings: Finding[] = [];
  let score = 0;

  const yesVal = positions.filter(p => p.outcome.toLowerCase() === 'yes').reduce((s, p) => s + p.totalValue, 0);
  const noVal = positions.filter(p => p.outcome.toLowerCase() === 'no').reduce((s, p) => s + p.totalValue, 0);
  const total = yesVal + noVal;
  const holders = positions.reduce((s, p) => s + p.holderCount, 0);

  if (total > 0) {
    const ratio = (yesVal - noVal) / total;
    score += ratio * 0.6;
    findings.push({
      text: `Our community has ${usd(total)} on this market across ${holders} trader${holders !== 1 ? 's' : ''}: ${((yesVal / total) * 100).toFixed(0)}% of it on YES.`,
      sentiment: ratio > 0.2 ? 'bull' : ratio < -0.2 ? 'bear' : 'neutral',
      weight: 0.6,
    });
  } else {
    findings.push({ text: 'Nobody in our community holds a position here yet — no crowd to read.', sentiment: 'neutral', weight: 0.3 });
  }

  if (commentCount > 0) {
    findings.push({ text: `${commentCount} comment${commentCount !== 1 ? 's' : ''} in the discussion — ${commentCount >= 5 ? 'this market has the group’s attention' : 'light chatter so far'}.`, sentiment: 'neutral', weight: 0.3 });
  }

  return {
    id: 'sentiment', emoji: '🗣️', name: 'Sentiment Analyst', role: 'community positioning & chatter',
    stance: stanceOf(score), score: clamp(score),
    confidence: holders >= 3 ? 'medium' : 'low',
    findings,
  };
}

// ---------- Layers 2–6: debate, ratings, risk, final call ----------

const WEIGHTS: Record<string, number> = { market: 0.30, flow: 0.30, fundamentals: 0.25, sentiment: 0.15 };

function ratingOf(score: number): Rating {
  if (score > 0.35) return 'BUY';
  if (score > 0.12) return 'OVERWEIGHT';
  if (score >= -0.12) return 'HOLD';
  if (score >= -0.35) return 'UNDERWEIGHT';
  return 'SELL';
}

export function runDesk(
  market: Market,
  history: PricePoint[],
  trades: RealTrade[],
  positions: CommunityPosition[],
  commentCount: number
): DeskReport {
  const yes = market.outcomePrices[0] ?? 0.5;

  const analysts = [
    marketAnalyst(history, yes),
    flowAnalyst(trades),
    fundamentalsAnalyst(market, yes),
    sentimentAnalyst(positions, commentCount),
  ];

  const score = clamp(analysts.reduce((s, a) => s + a.score * (WEIGHTS[a.id] ?? 0.25), 0));

  // Researcher debate: each side argues the strongest cross-analyst evidence
  const attributed = analysts.flatMap(a => a.findings.map(f => ({ ...f, who: a.name })));
  const bull = attributed.filter(f => f.sentiment === 'bull').sort((a, b) => b.weight - a.weight).slice(0, 5)
    .map(f => `${f.who}: ${f.text}`);
  const bear = attributed.filter(f => f.sentiment === 'bear').sort((a, b) => b.weight - a.weight).slice(0, 5)
    .map(f => `${f.who}: ${f.text}`);
  if (bull.length === 0) bull.push('Bull Researcher: I have no hard evidence to stand on — the bear case carries this round.');
  if (bear.length === 0) bear.push('Bear Researcher: I can’t find a real crack in this market — the bull case carries this round.');

  const rating = ratingOf(score);
  const ratingWord: Record<Rating, string> = {
    BUY: 'a strong case for YES', OVERWEIGHT: 'a moderate lean toward YES', HOLD: 'no clear edge',
    UNDERWEIGHT: 'a moderate lean toward NO', SELL: 'a strong case for NO',
  };
  const research = {
    rating,
    rationale: `The bulls brought ${bull.length} piece${bull.length !== 1 ? 's' : ''} of evidence, the bears ${bear.length}. Weighing the desks (technicals 30%, real-money flow 30%, fundamentals 25%, community 15%) the combined read is ${score >= 0 ? '+' : ''}${(score * 100).toFixed(0)} on a ±100 scale — ${ratingWord[rating]}.`,
  };

  // Trader maps the research rating to a prediction-market action
  const action: Action = rating === 'BUY' || rating === 'OVERWEIGHT' ? 'BUY YES'
    : rating === 'SELL' || rating === 'UNDERWEIGHT' ? 'BUY NO' : 'HOLD';
  const top = attributed.filter(f => f.sentiment !== 'neutral').sort((a, b) => b.weight - a.weight)[0];
  const trader = {
    action,
    justification: action === 'HOLD'
      ? `At ${cents(yes)} the evidence is split — no trade beats a forced trade. Wait for the flow or the chart to pick a side.`
      : `At ${cents(yes)} for YES, the desk's read translates to ${action} (in a prediction market you express a bearish view by buying NO). Primary driver: ${top ? top.text.toLowerCase() : 'the balance of evidence'}`,
  };

  // Risk debate
  const conviction = Math.round(Math.abs(score) * 100);
  const prices = history.map(p => p.p);
  const vol = prices.length >= 10 ? stdev(prices.slice(-30)) : 0;
  const daysLeft = market.endDate ? Math.ceil((new Date(market.endDate).getTime() - Date.now()) / 86400000) : null;
  const thinLiq = market.liquidity < 5000;

  let stake = Math.min(25, Math.max(2, Math.round(conviction / 4)));
  const caps: string[] = [];
  if (thinLiq) { stake = Math.max(2, Math.round(stake / 2)); caps.push('thin liquidity'); }
  if (daysLeft !== null && daysLeft <= 1) { stake = Math.max(2, Math.round(stake / 2)); caps.push('imminent resolution'); }
  if (action === 'HOLD') stake = 0;

  const risk = {
    aggressive: `Conviction is ${conviction}/100 and this is paper money — the whole point is to take swings. I'd size up to ${Math.min(30, stake * 2)}% of bankroll; timid sizing teaches you nothing about your own judgment.`,
    conservative: `${vol > 0.05 ? `Volatility is running ±${(vol * 100).toFixed(1)}¢ — this can gap against us overnight. ` : ''}${thinLiq ? 'Liquidity is thin, so the displayed price flatters what you could actually get. ' : ''}${daysLeft !== null && daysLeft <= 3 ? `Resolution is ${daysLeft <= 1 ? 'imminent' : 'days away'} — binary risk is at its maximum. ` : ''}Half the proposed size, or skip it. Protecting the bankroll keeps us on the leaderboard.`,
    neutral: `Both of you are arguing from temperament, not evidence. The conviction score is ${conviction}/100${caps.length ? ` and we're capped by ${caps.join(' and ')}` : ''} — a ${stake}% stake matches what the data supports: meaningful if right, survivable if wrong.`,
  };

  const decision = {
    action,
    rating,
    conviction,
    suggestedStakePct: stake,
    thesis: action === 'HOLD'
      ? `The desk found no edge at ${cents(yes)}: ${research.rationale.split('—')[0].trim()}. Stand aside until the picture changes — flat is a position too.`
      : `${action} at ${cents(yes)} with ${conviction}/100 conviction. ${top ? top.text + ' ' : ''}${caps.length ? `Position capped by ${caps.join(' and ')} — suggested stake ${stake}% of balance.` : `Suggested stake ${stake}% of balance.`}`,
  };

  return { analysts, debate: { bull, bear }, research, trader, risk, decision, yesPrice: yes };
}
