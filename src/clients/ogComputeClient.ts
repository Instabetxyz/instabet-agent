import axios from 'axios';
import { config } from '../config';
import type { ChatMessage, InferenceResponse } from '../types';

// ─────────────────────────────────────────────────────────
// 0G Compute client
// ─────────────────────────────────────────────────────────
// 0G Compute exposes an OpenAI-compatible /chat/completions endpoint.
// We hit it directly with axios so the agent has no OpenAI SDK dependency.

const http = axios.create({
  baseURL: config.ogCompute.endpoint,
  headers: {
    Authorization: `Bearer ${config.ogCompute.apiKey}`,
    'Content-Type': 'application/json',
  },
  timeout: 30_000,
});

export interface CompletionOpts {
  messages: ChatMessage[];
  /** Max tokens to generate. Default: 512 */
  maxTokens?: number;
  /** Temperature 0.0–1.0. Default: 0.2 (low = more deterministic decisions) */
  temperature?: number;
}

/**
 * Call 0G Compute's chat completions endpoint.
 * Returns the assistant's text response.
 */
export async function complete(opts: CompletionOpts): Promise<string> {
  const { data } = await http.post<InferenceResponse>('/chat/completions', {
    model:       config.ogCompute.model,
    messages:    opts.messages,
    max_tokens:  opts.maxTokens ?? 512,
    temperature: opts.temperature ?? 0.2,
  });

  const content = data.choices[0]?.message?.content;
  if (!content) throw new Error('0G Compute returned empty response.');
  return content.trim();
}