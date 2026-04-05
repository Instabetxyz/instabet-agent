// ─────────────────────────────────────────────────────────
// Server API response shapes
// ─────────────────────────────────────────────────────────

export interface Market {
  market_id: string;
  stream_id: string;
  title: string;
  condition: string;
  stream_url: string;
  status: 'active' | 'resolved' | 'cancelled';
  created_by: string;
  is_agent_stream: boolean;
  yes_odds: number;
  no_odds: number;
  yes_pool_wei: string;
  no_pool_wei: string;
  total_volume_wei: string;
  starts_at: number;
  ends_at: number;
  seconds_remaining: number;
}

export interface BetResult {
  bet_id: string;
  market_id: string;
  side: 'yes' | 'no';
  amount_wei: string;
  tx_hash: string;
  placed_at: number;
  updated_odds: {
    yes_odds: number;
    no_odds: number;
    yes_pool_wei: string;
    no_pool_wei: string;
    total_volume_wei: string;
  };
}

// ─────────────────────────────────────────────────────────
// 0G Compute (OpenAI-compatible)
// ─────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface InferenceResponse {
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

// ─────────────────────────────────────────────────────────
// Agent decision
// ─────────────────────────────────────────────────────────

export type BetDecision =
  | { action: 'bet'; side: 'yes' | 'no'; confidence: number; reasoning: string }
  | { action: 'skip'; reasoning: string };

// ─────────────────────────────────────────────────────────
// Memory
// ─────────────────────────────────────────────────────────

export interface BetRecord {
  market_id: string;
  condition: string;
  side: 'yes' | 'no';
  confidence: number;
  amount_wei: string;
  placed_at: number;          // unix ts
  outcome: 'won' | 'lost' | 'pending';
  pnl_wei: string;
}

export interface AgentMemory {
  agent_name: string;
  total_bets: number;
  total_pnl_wei: string;      // signed, bigint as string
  win_rate: number;           // 0.0–1.0
  recent_bets: BetRecord[];   // capped at config.strategy.memoryWindow
  last_updated: number;       // unix ts
}

// ─────────────────────────────────────────────────────────
// WebSocket events (subset we care about)
// ─────────────────────────────────────────────────────────

export interface WsMarketResolvedEvent {
  type: 'market_resolved';
  market_id: string;
  outcome: 'yes' | 'no';
  resolved_at: number;
  winning_pool_wei: string | null;
  total_pot_wei: string;
}

export type WsIncomingEvent =
  | WsMarketResolvedEvent
  | { type: 'pong' }
  | { type: 'error'; message: string };