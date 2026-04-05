import axios from 'axios';
import { config } from '../config';
import type { AgentMemory, BetRecord } from '../types';

// ─────────────────────────────────────────────────────────
// 0G Storage client
// ─────────────────────────────────────────────────────────
// 0G Storage exposes a simple key/value REST API.
// We store the agent's entire memory as a single JSON blob.

const http = axios.create({
  baseURL: config.ogStorage.endpoint,
  headers: {
    Authorization: `Bearer ${config.ogStorage.apiKey}`,
    'Content-Type': 'application/json',
  },
  timeout: 10_000,
});

const STORAGE_KEY = config.ogStorage.memoryKey;

// ─────────────────────────────────────────────────────────
// Default empty memory
// ─────────────────────────────────────────────────────────

function emptyMemory(): AgentMemory {
  return {
    agent_name:    config.agent.name,
    total_bets:    0,
    total_pnl_wei: '0',
    win_rate:      0,
    recent_bets:   [],
    last_updated:  Math.floor(Date.now() / 1000),
  };
}

// ─────────────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────────────

export async function loadMemory(): Promise<AgentMemory> {
  try {
    const { data } = await http.get<{ value: string }>(`/kv/${STORAGE_KEY}`);
    return JSON.parse(data.value) as AgentMemory;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      console.log('[Memory] No existing memory found — starting fresh.');
      return emptyMemory();
    }
    console.warn('[Memory] Failed to load from 0G Storage, using empty memory:', err);
    return emptyMemory();
  }
}

// ─────────────────────────────────────────────────────────
// Write
// ─────────────────────────────────────────────────────────

export async function saveMemory(memory: AgentMemory): Promise<void> {
  try {
    await http.put(`/kv/${STORAGE_KEY}`, {
      value: JSON.stringify(memory),
    });
  } catch (err) {
    // Non-fatal — we continue even if storage write fails
    console.warn('[Memory] Failed to persist to 0G Storage:', err);
  }
}

// ─────────────────────────────────────────────────────────
// Mutations (all return the updated memory)
// ─────────────────────────────────────────────────────────

/**
 * Record a new bet in memory and persist.
 */
export async function recordBet(
  memory: AgentMemory,
  bet: Omit<BetRecord, 'outcome' | 'pnl_wei'>,
): Promise<AgentMemory> {
  const record: BetRecord = { ...bet, outcome: 'pending', pnl_wei: '0' };

  const updated: AgentMemory = {
    ...memory,
    total_bets: memory.total_bets + 1,
    recent_bets: [
      record,
      // Keep the window trimmed
      ...memory.recent_bets.slice(0, config.strategy.memoryWindow - 1),
    ],
    last_updated: Math.floor(Date.now() / 1000),
  };

  //await saveMemory(updated);
  return updated;
}

/**
 * Update bet outcomes once a market is resolved.
 * Recalculates win_rate and total_pnl_wei.
 */
export async function settleBets(
  memory: AgentMemory,
  marketId: string,
  outcome: 'yes' | 'no',
  winningPoolWei: string | null,
  totalPotWei: string,
): Promise<AgentMemory> {
  const updatedBets = memory.recent_bets.map((b) => {
    if (b.market_id !== marketId || b.outcome !== 'pending') return b;

    const won = b.side === outcome;

    // Approximate payout: (amount / winning_pool) * total_pot - amount
    let pnlWei = '0';
    if (won && winningPoolWei && BigInt(winningPoolWei) > 0n) {
      const amount    = BigInt(b.amount_wei);
      const winPool   = BigInt(winningPoolWei);
      const totalPot  = BigInt(totalPotWei);
      const payout    = (amount * totalPot) / winPool;
      pnlWei          = (payout - amount).toString();
    } else if (!won) {
      pnlWei = (-BigInt(b.amount_wei)).toString();
    }

    return { ...b, outcome: won ? 'won' : 'lost', pnl_wei: pnlWei } as BetRecord;
  });

  // Recompute aggregate stats from the full recent_bets window
  const settled    = updatedBets.filter((b) => b.outcome !== 'pending');
  const wins       = settled.filter((b) => b.outcome === 'won').length;
  const winRate    = settled.length > 0 ? wins / settled.length : 0;
  const totalPnl   = updatedBets.reduce(
    (acc, b) => acc + BigInt(b.pnl_wei),
    BigInt(memory.total_pnl_wei),
  );

  const updated: AgentMemory = {
    ...memory,
    recent_bets:   updatedBets,
    win_rate:      winRate,
    total_pnl_wei: totalPnl.toString(),
    last_updated:  Math.floor(Date.now() / 1000),
  };

  //await saveMemory(updated);
  return updated;
}