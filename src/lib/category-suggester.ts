import Anthropic from '@anthropic-ai/sdk';
import { searchCategories, getCommissionInfo } from '@/lib/allegro';
import type { AnthropicUsage } from './image-analyzer';

export interface CategorySuggestion {
  id: string;
  name: string;
  path: string;
  leaf: boolean;
  commission: string | null;
}

export async function suggestCategory(
  productTitle: string,
  attributes: Record<string, string>,
  apiKey: string,
): Promise<{ suggestions: CategorySuggestion[]; usage: AnthropicUsage }> {
  const anthropic = new Anthropic({ apiKey });

  const attributesSummary = Object.entries(attributes)
    .slice(0, 15)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  const userPrompt = `Jesteś ekspertem od kategoryzacji produktów na Allegro.pl.

Produkt: "${productTitle}"
${attributesSummary ? `Atrybuty:\n${attributesSummary}` : ''}

Zaproponuj 5-8 wyszukiwań kategorii Allegro, które najlepiej pasują do tego produktu.
Każde wyszukiwanie to 1-3 słowa kluczowe po polsku, które mogą być nazwą kategorii liściowej na Allegro.

Odpowiedz WYŁĄCZNIE poprawnym JSON bez markdown:
{"searches": ["odkurzacze pionowe", "odkurzacze bezprzewodowe", "odkurzacze", ...]}`;

  const llmRes = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const usage: AnthropicUsage = {
    input_tokens: llmRes.usage.input_tokens,
    output_tokens: llmRes.usage.output_tokens,
    cache_creation_input_tokens: (llmRes.usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens,
    cache_read_input_tokens: (llmRes.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens,
  };

  const content = (llmRes.content[0] as { type: 'text'; text: string }).text ?? '{}';
  let searches: string[] = [];
  try {
    const parsed = JSON.parse(content);
    searches = Array.isArray(parsed.searches) ? parsed.searches : [];
  } catch {
    searches = [productTitle.split(' ').slice(0, 3).join(' ')];
  }

  const seenIds = new Set<string>();
  const allResults: Array<{ id: string; name: string; fullPath: string; leaf: boolean }> = [];

  for (const term of searches.slice(0, 8)) {
    try {
      const results = await searchCategories(term, 10);
      for (const cat of results) {
        if (cat.leaf && !seenIds.has(cat.id)) {
          seenIds.add(cat.id);
          allResults.push(cat);
        }
      }
    } catch {
      // skip failed searches
    }
  }

  const topResults = allResults.slice(0, 10);
  const COMMISSION_BATCH = 5;
  const commissionsRaw = await Promise.allSettled(
    topResults.slice(0, COMMISSION_BATCH).map(cat => getCommissionInfo(cat.id))
  );

  const suggestions: CategorySuggestion[] = topResults.map((cat, i) => ({
    id: cat.id,
    name: cat.name,
    path: cat.fullPath,
    leaf: true,
    commission: i < COMMISSION_BATCH && commissionsRaw[i].status === 'fulfilled'
      ? commissionsRaw[i].value
      : null,
  }));

  return { suggestions, usage };
}
