export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export interface TokenCost {
  usd: number;
  pln: number;
}

import { getCachedUsdToPln } from './fx-rate';

const PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  'claude-opus-4-6':           { input: 15 / 1e6,   output: 75 / 1e6,  cacheWrite: 18.75 / 1e6, cacheRead: 1.5 / 1e6 },
  'claude-opus-4-7':           { input: 15 / 1e6,   output: 75 / 1e6,  cacheWrite: 18.75 / 1e6, cacheRead: 1.5 / 1e6 },
  'claude-sonnet-4-6':         { input: 3 / 1e6,    output: 15 / 1e6,  cacheWrite: 3.75 / 1e6,  cacheRead: 0.3 / 1e6 },
  'claude-haiku-4-5-20251001': { input: 1 / 1e6,    output: 5 / 1e6,   cacheWrite: 1.25 / 1e6,  cacheRead: 0.10 / 1e6 },
};

export function calcCost(usage: AnthropicUsage, model: string): TokenCost {
  const p = PRICING[model] ?? PRICING['claude-sonnet-4-6'];
  const usd =
    usage.input_tokens * p.input +
    usage.output_tokens * p.output +
    (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite +
    (usage.cache_read_input_tokens ?? 0) * p.cacheRead;
  return { usd, pln: usd * getCachedUsdToPln() };
}

export function sumUsage(usages: AnthropicUsage[]): AnthropicUsage {
  return usages.reduce(
    (acc, u) => ({
      input_tokens: acc.input_tokens + (u.input_tokens ?? 0),
      output_tokens: acc.output_tokens + (u.output_tokens ?? 0),
      cache_creation_input_tokens: (acc.cache_creation_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      cache_read_input_tokens: (acc.cache_read_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    }),
    { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  );
}
