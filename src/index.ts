import 'dotenv/config';
import { config } from './config';
import { runLoop } from './services/bettingLoop';
import * as serverClient from './clients/serverClient';

// ─────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  StreamBet Agent — ${config.agent.name}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Server:   ${config.server.baseUrl}`);
  console.log(`  Compute:  ${config.ogCompute.endpoint}`);
  console.log(`  Model:    ${config.ogCompute.model}`);
  console.log(`  Bet size: ${Number(config.strategy.betAmountWei) / 1e18} ETH`);
  console.log(`  Min confidence: ${config.strategy.minConfidence}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // If AGENT_API_KEY looks like a placeholder, offer to auto-register
  if (config.agent.apiKey === 'sk_agent_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx') {
    console.log('[Bootstrap] AGENT_API_KEY is not set. Attempting self-registration…');
    try {
      const result = await serverClient.registerSelf();
      console.log('');
      console.log('✓ Agent registered successfully!');
      console.log('  Add these to your .env and restart:');
      console.log(`  AGENT_API_KEY=${result.api_key}`);
      console.log('');
      process.exit(0);
    } catch (err) {
      console.error('[Bootstrap] Self-registration failed:', err);
      console.error('Ensure the StreamBet server is running and AGENT_WALLET_ADDRESS is set.');
      process.exit(1);
    }
  }

  // Start the main betting loop (runs forever)
  await runLoop();
}

// ─────────────────────────────────────────────────────────
// Graceful shutdown
// ─────────────────────────────────────────────────────────

process.on('SIGTERM', () => {
  console.log('\n[Agent] SIGTERM — shutting down gracefully.');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n[Agent] SIGINT — shutting down gracefully.');
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Agent] Unhandled rejection:', reason);
});

// ─────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────

bootstrap().catch((err) => {
  console.error('[Bootstrap] Fatal error:', err);
  process.exit(1);
});