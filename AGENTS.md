# AGENTS.md — Instabet Agent

Agentic coding guide for the StreamBet AI agent codebase.

## Project Overview

A StreamBet AI agent that polls prediction markets, reasons via 0G Compute (OpenAI-compatible API), and places bets via the StreamBet API. Uses WebSocket for real-time market updates.

## Commands

```bash
# Install dependencies
npm install

# Development (watch mode, auto-reload)
npm run dev

# Build TypeScript
npm run build

# Start production build
npm run start
```

### Running a Single Test

No test framework is currently configured. To add tests:

```bash
# Install vitest (already used in similar projects)
npm install -D vitest

# Run all tests
npm test

# Run specific test file
npx vitest run src/services/bettingLoop.test.ts

# Run tests in watch mode
npx vitest
```

### Linting

No linter is currently configured. To add ESLint:

```bash
npm install -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
npx eslint src/**/*.ts
```

## Code Style Guidelines

### General Principles

- **Strict TypeScript**: Full strict mode enabled in `tsconfig.json`
- **No comments unless required**: Code should be self-explanatory
- **Error handling**: Always handle errors explicitly, never silently swallow
- **Graceful shutdown**: Handle SIGTERM/SIGINT for production deployments

### Imports

- Use explicit relative imports: `import { config } from './config'`
- Group imports: external (axios), internal (./clients, ./services)
- Use `import type` for types only: `import type { Market, BetResult } from '../types'`

```typescript
// Good
import axios, { AxiosInstance, AxiosError } from 'axios';
import { config } from '../config';
import type { Market, BetResult } from '../types';

// Avoid default exports
```

### Naming Conventions

- **Files**: kebab-case (`serverClient.ts`, `bettingLoop.ts`)
- **Interfaces**: PascalCase with descriptive names (`Market`, `BetResult`)
- **Types**: PascalCase (`BetDecision`, `WsIncomingEvent`)
- **Functions**: camelCase (`getActiveMarkets`, `placeBet`)
- **Constants**: camelCase or UPPER_SNAKE (prefer `config.strategy.*` over global constants)

### TypeScript

- Use `interface` for public APIs, `type` for unions/intersections
- Use `bigint` for ETH amounts, serialize as strings (`string` not `number`)
- Use `as const` for configuration objects: `export const config = { ... } as const`
- Avoid `any` — use `unknown` when type is truly unknown
- Enable strict null checking

```typescript
// Good
export interface Market {
  market_id: string;
  yes_odds: number;
  total_volume_wei: string;  // bigint serialized as string
}

// Configuration uses as const
export const config = {
  strategy: {
    betAmountWei: BigInt(optional('BET_AMOUNT_WEI', '10000000000000000')),
  },
} as const;
```

### Error Handling

- Use typed errors with helper functions
- Always log errors with context before exiting
- Distinguish between recoverable and fatal errors

```typescript
// Good — typed error helpers
export function isMarketClosed(err: unknown): boolean {
  return axios.isAxiosError(err) &&
    (err as AxiosError<{ error: string }>).response?.data?.error === 'MARKET_CLOSED';
}

// Always handle rejections
process.on('unhandledRejection', (reason) => {
  console.error('[Agent] Unhandled rejection:', reason);
});
```

### Async/Await

- Always handle async errors with try/catch at top level
- Use meaningful error messages that include the operation name

```typescript
async function bootstrap(): Promise<void> {
  try {
    await runLoop();
  } catch (err) {
    console.error('[Bootstrap] Fatal error:', err);
    process.exit(1);
  }
}
```

### Configuration

- Use environment variables with validation in `src/config.ts`
- Provide sensible defaults for optional variables
- Throw clear errors for missing required variables

```typescript
function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}
```

### Logging

- Use console.log/error with context prefixes: `[Bootstrap]`, `[Agent]`
- Include operation names in logs: `'[Bootstrap] Agent registered successfully!'`
- Use separators for major sections: `console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');`

### WebSocket Handling

- Handle reconnection logic for production resilience
- Parse and validate incoming messages with types
- Handle pong/ping for connection keepalive

### Memory & State

- Use `AgentMemory` interface for tracking bet history
- Store as JSON in 0G Storage for persistence
- Calculate win rate and PNL from stored records

### Testing

- Use Vitest as test framework (already used in similar projects)
- Place tests alongside source files: `src/services/bettingLoop.test.ts`
- Use descriptive test names: `should place bet when confidence exceeds threshold`

### File Organization

```
src/
├── index.ts          # Entry point, bootstrap, shutdown
├── config.ts         # Environment configuration
├── types.ts          # All TypeScript interfaces/types
├── clients/          # External API clients
│   ├── serverClient.ts
│   ├── wsClient.ts
│   └── ogComputeClient.ts
├── services/         # Business logic
│   ├── bettingLoop.ts
│   └── reasoningService.ts
└── storage/          # Persistence
    └── memoryStore.ts
```

## Environment Variables

Required:
- `AGENT_API_KEY` — Agent authentication key
- `AGENT_WALLET_ADDRESS` — Ethereum wallet address
- `OG_COMPUTE_API_KEY` — 0G Compute API key
- `OG_STORAGE_API_KEY` — 0G Storage API key

Optional (with defaults):
- `SERVER_BASE_URL` — API server URL (default: `http://localhost:3000/v1`)
- `OG_COMPUTE_ENDPOINT` — LLM endpoint (default: `https://inference-api.0g.ai/v1`)
- `OG_COMPUTE_MODEL` — Model name (default: `qwen/qwen-2.5-7b-instruct`)
- `BET_AMOUNT_WEI` — Bet size in wei (default: `10000000000000000` = 0.01 ETH)
- `MIN_CONFIDENCE` — Minimum confidence to bet (default: `0.6`)
- `POLL_INTERVAL_MS` — Market polling interval (default: `8000`)
- `MAX_BETS_PER_CYCLE` — Max bets per poll cycle (default: `3`)
- `MEMORY_WINDOW` — Recent bets to track (default: `20`)
