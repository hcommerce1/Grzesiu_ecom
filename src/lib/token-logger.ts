import { getDb } from './db';
import { calcCost } from './token-cost';
import type { AnthropicUsage } from './token-cost';
import { randomUUID } from 'crypto';

export function logTokenUsage(params: {
  productId: string;
  sessionKey?: string;
  toolName: string;
  model: string;
  usage: AnthropicUsage;
}): void {
  try {
    const db = getDb();
    const cost = calcCost(params.usage, params.model);
    db.prepare(`
      INSERT INTO product_token_usage
        (id, product_id, session_key, tool_name, model, input_tokens, output_tokens,
         cache_write_tokens, cache_read_tokens, cost_usd, cost_pln)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      randomUUID(),
      params.productId,
      params.sessionKey ?? null,
      params.toolName,
      params.model,
      params.usage.input_tokens ?? 0,
      params.usage.output_tokens ?? 0,
      params.usage.cache_creation_input_tokens ?? 0,
      params.usage.cache_read_input_tokens ?? 0,
      cost.usd,
      cost.pln,
    );
  } catch (err) {
    console.warn('[token-logger] Failed to log token usage:', err);
  }
}
