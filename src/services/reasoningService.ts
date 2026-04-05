import * as ogCompute from '../clients/ogComputeClient';
import type { Market, AgentMemory, BetDecision, ChatMessage } from '../types';

// ─────────────────────────────────────────────────────────
// System prompt
// ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an AI agent that places bets on live-stream prediction markets.
Each market presents a YES/NO condition that will be observed on a live stream for 90 seconds.

Your job is to analyze the condition and current market state, then decide:
  - BET YES  — you believe the condition will occur
  - BET NO   — you believe the condition will NOT occur
  - SKIP     — insufficient information or confidence too low to bet

You must respond with ONLY valid JSON matching this exact schema, with no other text:
{
  "action":     "bet" | "skip",
  "side":       "yes" | "no" | null,
  "confidence": <number 0.0–1.0, required if action is "bet">,
  "reasoning":  "<one concise sentence>"
}

Rules:
- Only bet when confidence >= 0.6
- If action is "skip", set side to null
- Base your decision on the condition text, current odds, volume, and your past performance
- Be decisive — skipping too often is also a bad strategy`;

// ─────────────────────────────────────────────────────────
// Decision
// ─────────────────────────────────────────────────────────

/**
 * Ask 0G Compute whether to bet YES, NO, or skip on a market.
 * Injects the agent's memory as context so the model can learn from history.
 */
export async function decide(
  market: Market,
  memory: AgentMemory,
): Promise<BetDecision> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: buildUserPrompt(market, memory) },
  ];

  let raw: string;
  try {
    raw = await ogCompute.complete({ messages, maxTokens: 256, temperature: 0.2 });
  } catch (err) {
    console.error('[Reasoning] 0G Compute call failed:', err);
    return { action: 'skip', reasoning: '0G Compute unavailable.' };
  }

  return parseDecision(raw);
}

// ─────────────────────────────────────────────────────────
// Prompt builder
// ─────────────────────────────────────────────────────────

function buildUserPrompt(market: Market, memory: AgentMemory): string {
  const secondsLeft = Math.max(0, market.ends_at - Math.floor(Date.now() / 1000));
  const totalVolumeEth = (
    Number(BigInt(market.total_volume_wei)) / 1e18
  ).toFixed(4);

  const memorySection = buildMemorySection(memory);

  return `## Market to evaluate

Title:     ${market.title}
Condition: ${market.condition}
Stream:    ${market.stream_url}

Current odds:
  YES: ${(market.yes_odds * 100).toFixed(1)}%  (implied probability)
  NO:  ${(market.no_odds  * 100).toFixed(1)}%
Total volume: ${totalVolumeEth} ETH
Time remaining: ${secondsLeft}s

## Your performance history
${memorySection}

Based on all of the above, what is your decision?`;
}

function buildMemorySection(memory: AgentMemory): string {
  if (memory.recent_bets.length === 0) {
    return 'No bets placed yet — this is your first decision.';
  }

  const lines = [
    `Overall: ${memory.total_bets} bets | win rate ${(memory.win_rate * 100).toFixed(1)}% | PnL ${formatWeiEth(memory.total_pnl_wei)} ETH`,
    '',
    'Recent bets (newest first):',
  ];

  for (const b of memory.recent_bets.slice(0, 10)) {
    const pnl = b.outcome !== 'pending'
      ? ` | PnL ${formatWeiEth(b.pnl_wei)} ETH`
      : '';
    lines.push(
      `  [${b.outcome.toUpperCase()}] ${b.side.toUpperCase()} on "${b.condition.slice(0, 60)}" confidence=${b.confidence.toFixed(2)}${pnl}`,
    );
  }

  return lines.join('\n');
}

function formatWeiEth(weiStr: string): string {
  try {
    const wei  = BigInt(weiStr);
    const sign = wei < 0n ? '-' : '+';
    return `${sign}${(Number(wei < 0n ? -wei : wei) / 1e18).toFixed(4)}`;
  } catch {
    return '0.0000';
  }
}

// ─────────────────────────────────────────────────────────
// Response parser
// ─────────────────────────────────────────────────────────

function parseDecision(raw: string): BetDecision {
  // Strip any markdown fences the model may have added
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.warn('[Reasoning] Could not parse LLM response as JSON:', raw);
    return { action: 'skip', reasoning: 'LLM response was not valid JSON.' };
  }

  if (!isObject(parsed)) {
    return { action: 'skip', reasoning: 'LLM returned non-object JSON.' };
  }

  const action = parsed['action'];
  const reasoning = String(parsed['reasoning'] ?? 'No reasoning provided.');

  if (action === 'skip') {
    return { action: 'skip', reasoning };
  }

  if (action === 'bet') {
    const side = parsed['side'];
    const confidence = Number(parsed['confidence'] ?? 0);

    if (side !== 'yes' && side !== 'no') {
      return { action: 'skip', reasoning: 'LLM returned invalid side.' };
    }
    if (confidence < 0.6) {
      return { action: 'skip', reasoning: `Confidence too low (${confidence.toFixed(2)}).` };
    }

    return { action: 'bet', side, confidence, reasoning };
  }

  return { action: 'skip', reasoning: 'LLM returned unrecognised action.' };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}