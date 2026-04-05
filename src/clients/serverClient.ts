import axios, { AxiosInstance, AxiosError } from 'axios';
import { config } from '../config';
import type { Market, BetResult } from '../types';

// ─────────────────────────────────────────────────────────
// Axios instance — agent API key auth
// ─────────────────────────────────────────────────────────

const http: AxiosInstance = axios.create({
  baseURL: config.server.baseUrl,
  headers: {
    Authorization: `Bearer ${config.agent.apiKey}`,
    'Content-Type': 'application/json',
  },
  timeout: 15_000,
});

// ─────────────────────────────────────────────────────────
// Markets
// ─────────────────────────────────────────────────────────

/**
 * Fetch the current page of active markets, sorted by ends_at ascending
 * (most urgent first). The agent only acts on markets with enough time left.
 */
export async function getActiveMarkets(limit = 20): Promise<Market[]> {
  const { data } = await http.get<{ markets: Market[] }>('/markets', {
    params: { status: 'active', limit },
  });
  return data.markets;
}

// ─────────────────────────────────────────────────────────
// Betting
// ─────────────────────────────────────────────────────────

export interface PlaceBetOpts {
  marketId: string;
  side: 'yes' | 'no';
  amountWei: bigint;
}

export async function placeBet(opts: PlaceBetOpts): Promise<BetResult> {
  const { data } = await http.post<BetResult>(`/markets/${opts.marketId}/bet`, {
    side: opts.side,
    amount_wei: opts.amountWei.toString(),
  });
  return data;
}

// ─────────────────────────────────────────────────────────
// Self-registration (run once on first boot if needed)
// ─────────────────────────────────────────────────────────

export interface RegisterResult {
  agent_id: string;
  api_key: string;
  inft_id: string;
  og_storage_key: string;
}

/**
 * Register this agent on the server. Only called when AGENT_API_KEY is not
 * yet set — the returned api_key should be saved to .env as AGENT_API_KEY.
 */
export async function registerSelf(): Promise<RegisterResult> {
  // Use a temporary unauthenticated client for registration
  const { data } = await axios.post<RegisterResult>(
    `${config.server.baseUrl}/agents`,
    {
      name:           config.agent.name,
      description:    config.agent.description,
      wallet_address: config.agent.walletAddress,
    },
  );
  return data;
}

// ─────────────────────────────────────────────────────────
// Error helpers
// ─────────────────────────────────────────────────────────

export function isMarketClosed(err: unknown): boolean {
  return axios.isAxiosError(err) &&
    (err as AxiosError<{ error: string }>).response?.data?.error === 'MARKET_CLOSED';
}

export function isServerError(err: unknown): boolean {
  return axios.isAxiosError(err) && (err as AxiosError).response != null;
}