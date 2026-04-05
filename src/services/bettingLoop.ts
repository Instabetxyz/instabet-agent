import { config } from '../config';
import * as serverClient from '../clients/serverClient';
import * as reasoningService from './reasoningService';
import * as memoryStore from '../storage/memoryStore';
import { StreamBetWsClient } from '../clients/wsClient';
import type { Market, AgentMemory, WsMarketResolvedEvent } from '../types';

// ─────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────

// Markets the agent has already evaluated this session
// Prevents re-evaluating the same market on repeated polls
const evaluatedMarkets = new Set<string>();

// ─────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────

export async function runLoop(): Promise<void> {
  console.log(`[Loop] Starting agent "${config.agent.name}"`);

  // 1. Load memory from 0G Storage
  let memory = await memoryStore.loadMemory();
  console.log(
    `[Loop] Memory loaded — ${memory.total_bets} bets, ` +
    `win rate ${(memory.win_rate * 100).toFixed(1)}%`,
  );

  // 2. Connect WebSocket for market_resolved events (settle bets in memory)
  const ws = new StreamBetWsClient(config.server.wsUrl);
  ws.onEvent(async (event) => {
    if (event.type === 'market_resolved') {
      memory = await handleResolution(memory, event);
    }
  });
  ws.connect();

  // 3. Poll loop
  while (true) {
    try {
      memory = await runCycle(memory, ws);
    } catch (err) {
      console.error('[Loop] Unhandled error in cycle:', err);
    }
    await sleep(config.strategy.pollIntervalMs);
  }
}

// ─────────────────────────────────────────────────────────
// One poll cycle
// ─────────────────────────────────────────────────────────

async function runCycle(
  memory: AgentMemory,
  ws: StreamBetWsClient,
): Promise<AgentMemory> {
  // Fetch active markets
  const markets = await serverClient.getActiveMarkets();

  // Filter to markets we haven't seen yet and that have enough time left
  const MIN_SECONDS = 20; // don't bet with <20s left — too risky
  const newMarkets = markets.filter(
    (m) =>
      !evaluatedMarkets.has(m.market_id) &&
      m.seconds_remaining >= MIN_SECONDS,
  );

  if (newMarkets.length === 0) {
    console.log('[Loop] No new markets to evaluate.');
    return memory;
  }

  console.log(`[Loop] ${newMarkets.length} new market(s) to evaluate.`);

  // Evaluate up to maxBetsPerCycle markets concurrently
  const batch = newMarkets.slice(0, config.strategy.maxBetsPerCycle);

  // Mark as evaluated immediately so concurrent cycles don't double-process
  batch.forEach((m) => evaluatedMarkets.add(m.market_id));

  // Process sequentially to avoid hammering 0G Compute
  for (const market of batch) {
    memory = await evaluateAndBet(market, memory, ws);
  }

  return memory;
}

// ─────────────────────────────────────────────────────────
// Evaluate a single market
// ─────────────────────────────────────────────────────────

async function evaluateAndBet(
  market: Market,
  memory: AgentMemory,
  ws: StreamBetWsClient,
): Promise<AgentMemory> {
  console.log(`\n[Market] ${market.market_id}`);
  console.log(`         "${market.condition}"`);
  console.log(`         odds YES=${(market.yes_odds * 100).toFixed(1)}% NO=${(market.no_odds * 100).toFixed(1)}% | ${market.seconds_remaining}s left`);

  // Ask 0G Compute for a decision
  const decision = await reasoningService.decide(market, memory);

  if (decision.action === 'skip') {
    console.log(`[Market] SKIP — ${decision.reasoning}`);
    return memory;
  }

  console.log(
    `[Market] BET ${decision.side.toUpperCase()} ` +
    `(confidence=${decision.confidence.toFixed(2)}) — ${decision.reasoning}`,
  );

  // Place the bet
  try {
    const result = await serverClient.placeBet({
      marketId:  market.market_id,
      side:      decision.side,
      amountWei: config.strategy.betAmountWei,
    });

    console.log(
      `[Market] ✓ Bet placed: ${result.bet_id} | tx=${result.tx_hash} | ` +
      `new odds YES=${(result.updated_odds.yes_odds * 100).toFixed(1)}% NO=${(result.updated_odds.no_odds * 100).toFixed(1)}%`,
    );

    // Subscribe to WebSocket events for this market (to settle the bet later)
    ws.subscribeMarket(market.market_id);

    // Record in memory
    memory = await memoryStore.recordBet(memory, {
      market_id:  market.market_id,
      condition:  market.condition,
      side:       decision.side,
      confidence: decision.confidence,
      amount_wei: config.strategy.betAmountWei.toString(),
      placed_at:  Math.floor(Date.now() / 1000),
    });

  } catch (err) {
    if (serverClient.isMarketClosed(err)) {
      console.warn(`[Market] Market ${market.market_id} closed before bet landed — skipping.`);
    } else {
      console.error(`[Market] Bet failed for ${market.market_id}:`, err);
    }
    // Remove from evaluated set so we retry next cycle if the market is still open
    evaluatedMarkets.delete(market.market_id);
  }

  return memory;
}

// ─────────────────────────────────────────────────────────
// Settle resolved markets in memory
// ─────────────────────────────────────────────────────────

async function handleResolution(
  memory: AgentMemory,
  event: WsMarketResolvedEvent,
): Promise<AgentMemory> {
  // Check if we have a pending bet on this market
  const hasBet = memory.recent_bets.some(
    (b) => b.market_id === event.market_id && b.outcome === 'pending',
  );
  if (!hasBet) return memory;

  console.log(
    `[Settlement] Market ${event.market_id} resolved → ${event.outcome.toUpperCase()}`,
  );

  return memoryStore.settleBets(
    memory,
    event.market_id,
    event.outcome,
    event.winning_pool_wei,
    event.total_pot_wei,
  );
}

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}