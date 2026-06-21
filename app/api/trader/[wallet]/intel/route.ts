import { NextRequest, NextResponse } from 'next/server';
import type { WalletTrade } from '@/lib/polymarket';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

interface Stats {
  totalTrades: number;
  buyCount: number;
  sellCount: number;
  yesBuyPct: number | null;
  avgBuySize: number;
  avgBuyPrice: number;
  topMarkets: { title: string; count: number }[];
}

export async function POST(req: NextRequest) {
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json({ error: 'No LLM configured' }, { status: 503 });
  }

  const { trades, stats, name } = await req.json() as {
    trades: WalletTrade[];
    stats: Stats;
    name: string | null;
  };

  const traderName = name || 'Unknown';

  const recentTrades = trades
    .slice(0, 20)
    .map(t => `${t.side} ${t.outcome} "${t.title.slice(0, 60)}" — $${(t.size * t.price).toFixed(0)} @ ${(t.price * 100).toFixed(0)}¢`)
    .join('\n');

  const prompt = `You are a trading analyst profiling a Polymarket prediction market trader. Give a sharp, honest assessment based only on the data below.

TRADER: ${traderName}
STATS (last ${stats.totalTrades} trades):
- BUY / SELL: ${stats.buyCount} buys, ${stats.sellCount} sells
- YES bet rate: ${stats.yesBuyPct != null ? stats.yesBuyPct.toFixed(0) + '%' : 'N/A'} of buys are YES (the rest are NO)
- Avg buy size: $${stats.avgBuySize.toFixed(0)} USDC
- Avg entry price: ${(stats.avgBuyPrice * 100).toFixed(0)}¢ (lower = more contrarian / higher conviction)
- Most active markets: ${stats.topMarkets.map(m => `"${m.title.slice(0, 50)}" (${m.count}x)`).join(', ') || 'N/A'}

RECENT TRADES (newest first):
${recentTrades}

Return JSON with exactly:
{
  "style": string — 1-2 sentences characterizing their trading style. Be specific. Max 60 words.
  "patterns": [string, string, string] — 3 sharp observations backed by specific numbers from the data above. Max 35 words each.
  "watchouts": [string, string] — 2 concrete risks to consider when copying them. Not generic. Max 35 words each.
  "verdict": string — one-sentence bottom line. Max 25 words.
}

Rules: no hedging boilerplate, no emojis, cite actual numbers, complete sentences only.`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 700,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`Groq ${res.status}`);
    const data = await res.json() as { choices: { message: { content: string } }[] };
    const intel = JSON.parse(data.choices[0].message.content);
    return NextResponse.json({ ...intel, narrator: 'ai' });
  } catch {
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 });
  }
}
