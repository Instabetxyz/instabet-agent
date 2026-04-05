import 'dotenv/config';

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

const serverBaseUrl = optional('SERVER_BASE_URL', 'http://localhost:3000/v1');

// Derive WS URL from HTTP base URL if not explicitly set
function deriveWsUrl(httpUrl: string): string {
  return (process.env.SERVER_WS_URL ?? httpUrl)
    .replace(/^http:/, 'ws:')
    .replace(/^https:/, 'wss:')
    .replace(/\/v1$/, '/v1/stream/websocket');
}

export const config = {
  agent: {
    apiKey:          required('AGENT_API_KEY'),
    name:            optional('AGENT_NAME', 'StreamBet-Agent'),
    description:     optional('AGENT_DESCRIPTION', 'AI prediction market agent'),
    walletAddress:   required('AGENT_WALLET_ADDRESS'),
  },

  server: {
    baseUrl:  serverBaseUrl,
    wsUrl:    deriveWsUrl(serverBaseUrl),
  },

  ogCompute: {
    endpoint: optional('OG_COMPUTE_ENDPOINT', 'https://inference-api.0g.ai/v1'),
    apiKey:   required('OG_COMPUTE_API_KEY'),
    model:    optional('OG_COMPUTE_MODEL', 'qwen/qwen-2.5-7b-instruct'),
  },

  ogStorage: {
    endpoint:  optional('OG_STORAGE_ENDPOINT', 'https://storage-api.0g.ai'),
    apiKey:    required('OG_STORAGE_API_KEY'),
    memoryKey: optional('OG_STORAGE_MEMORY_KEY', `agent_memory:${optional('AGENT_NAME', 'agent')}`),
  },

  strategy: {
    betAmountWei:    BigInt(optional('BET_AMOUNT_WEI', '10000000000000000')),
    minConfidence:   parseFloat(optional('MIN_CONFIDENCE', '0.6')),
    pollIntervalMs:  parseInt(optional('POLL_INTERVAL_MS', '8000'), 10),
    maxBetsPerCycle: parseInt(optional('MAX_BETS_PER_CYCLE', '3'), 10),
    memoryWindow:    parseInt(optional('MEMORY_WINDOW', '20'), 10),
  },
} as const;

export type Config = typeof config;