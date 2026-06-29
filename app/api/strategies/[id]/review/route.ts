import { NextRequest, NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await ensureSchema();

  const { rows } = await sql`SELECT * FROM strategies WHERE id = ${Number(id)}`;
  if (!rows[0]) return NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
  const s = rows[0];

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'AI not configured' }, { status: 500 });

  const prompt = `You are Claude, AI assistant embedded in Poly Trader — a paper trading app where users bet on Polymarket prediction markets with fake money.

A user has proposed the following automated trading strategy. Review it and respond.

Rules:
- If the strategy is well-specified (clear entry/exit conditions, position sizing, market filter), confirm you can implement it and briefly describe how it will work.
- If the strategy is too vague or missing critical details (e.g. no entry condition, no exit, no position size), ask 1–3 specific questions about the missing pieces.
- Keep your response to 2–4 sentences. Sign off as "— Claude".

Strategy name: ${s.name}
Description: ${s.description}
Rules:
${s.rules}`;

  const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 250,
      temperature: 0.4,
    }),
  });

  if (!groqRes.ok) return NextResponse.json({ error: 'AI request failed' }, { status: 502 });
  const groqData = await groqRes.json() as { choices: { message: { content: string } }[] };
  const ai_review = groqData.choices?.[0]?.message?.content?.trim() ?? '';

  await sql`UPDATE strategies SET ai_review = ${ai_review}, updated_at = NOW() WHERE id = ${Number(id)}`;

  return NextResponse.json({ ai_review });
}
