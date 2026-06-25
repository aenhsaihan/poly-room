import { NextRequest, NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await ensureSchema();

  const { rows } = await sql`SELECT * FROM tickets WHERE id = ${Number(id)}`;
  if (!rows[0]) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  const ticket = rows[0];

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'AI not configured' }, { status: 500 });

  const prompt = `You are Claude, AI assistant embedded in Poly Trader — a paper trading app where users bet on Polymarket prediction markets with fake money, copy real traders, and compete on a leaderboard.

A user has submitted the following ticket. Review it and write a response.

Rules:
- If the ticket is clear and actionable, acknowledge it, confirm your understanding of the issue or request, and let them know it's on your radar.
- If the ticket is too vague, missing reproduction steps (for bugs), or lacks enough context to act on, ask 1–3 specific clarifying questions. Be direct about what's missing.
- Never write more than 3 sentences. No bullet points. Sign off as "— Claude".

Ticket type: ${ticket.type}
Title: ${ticket.title}
Description: ${ticket.body}`;

  const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.4,
    }),
  });

  if (!groqRes.ok) return NextResponse.json({ error: 'AI request failed' }, { status: 502 });
  const groqData = await groqRes.json() as { choices: { message: { content: string } }[] };
  const response = groqData.choices?.[0]?.message?.content?.trim() ?? '';

  // Auto-set status based on response content
  const needsInfo = /\?/.test(response) && (response.match(/\?/g) ?? []).length >= 1;
  const newStatus = needsInfo ? 'needs_info' : ticket.status === 'open' ? 'open' : ticket.status;

  await sql`
    UPDATE tickets SET ai_response = ${response}, status = ${newStatus}, updated_at = NOW()
    WHERE id = ${Number(id)}
  `;

  return NextResponse.json({ response, status: newStatus });
}
