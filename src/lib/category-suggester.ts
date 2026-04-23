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

function buildFallbackTerms(productTitle: string, attributes: Record<string, string>): string[] {
  const terms: string[] = [];
  const title = productTitle.trim();
  if (title) {
    terms.push(title);
    const words = title.split(/\s+/).filter(Boolean);
    if (words.length >= 2) terms.push(words.slice(0, 2).join(' '));
    if (words.length >= 1) terms.push(words[0]);
  }
  const typeKeys = ['typ', 'Typ', 'rodzaj', 'Rodzaj', 'kategoria', 'Kategoria', 'Typ produktu', 'Rodzaj produktu'];
  for (const k of typeKeys) {
    const v = attributes[k];
    if (v && typeof v === 'string' && v.trim()) terms.push(v.trim());
  }
  return Array.from(new Set(terms.filter(Boolean)));
}

export async function suggestCategory(
  productTitle: string,
  attributes: Record<string, string>,
  apiKey: string,
  onProgress?: (message: string) => void,
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

  onProgress?.('Generuję zapytania wyszukiwania...');

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
  let parseOk = true;
  try {
    const parsed = JSON.parse(content);
    searches = Array.isArray(parsed.searches) ? parsed.searches.filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0) : [];
  } catch {
    parseOk = false;
  }

  if (!parseOk || searches.length === 0) {
    console.log('[suggestCategory] LLM parse failed or empty; falling back from title/attrs. Raw:', content.slice(0, 200));
    searches = buildFallbackTerms(productTitle, attributes);
  }

  const terms = searches.slice(0, 8).filter(t => t && t.trim().length > 0);
  console.log('[suggestCategory] search terms:', terms);
  onProgress?.(`Przeszukuję ${terms.length} kategorii Allegro...`);

  const seenIds = new Set<string>();
  const allResults: Array<{ id: string; name: string; fullPath: string; leaf: boolean }> = [];

  for (const term of terms) {
    try {
      const results = await searchCategories(term, 10);
      console.log(`[suggestCategory] term "${term}" → ${results.length} hits (leafs: ${results.filter(r => r.leaf).length})`);
      for (const cat of results) {
        if (cat.leaf && !seenIds.has(cat.id)) {
          seenIds.add(cat.id);
          allResults.push(cat);
        }
      }
    } catch (err) {
      console.log(`[suggestCategory] term "${term}" threw:`, err instanceof Error ? err.message : err);
    }
  }

  // Relaxed fallback: jeśli strict match nie dał nic, odpuść wymóg leaf i weź top N
  if (allResults.length === 0 && terms.length > 0) {
    console.log('[suggestCategory] strict match returned 0 leafs — relaxing leaf filter');
    for (const term of terms) {
      try {
        const results = await searchCategories(term, 20);
        for (const cat of results) {
          if (!seenIds.has(cat.id)) {
            seenIds.add(cat.id);
            allResults.push(cat);
          }
        }
      } catch {}
      if (allResults.length >= 5) break;
    }
  }

  // Ostatnia deska: spróbuj samego tytułu (pełnego) — single-word search bywa mocniejszy
  if (allResults.length === 0 && productTitle.trim()) {
    console.log('[suggestCategory] still 0 hits — trying full title as single term');
    try {
      const results = await searchCategories(productTitle.trim(), 10);
      for (const cat of results) if (!seenIds.has(cat.id)) { seenIds.add(cat.id); allResults.push(cat); }
    } catch {}
  }

  const topResults = allResults.slice(0, 10);
  console.log(`[suggestCategory] final candidates: ${topResults.length}`);
  const COMMISSION_BATCH = 5;

  onProgress?.(`Pobieram prowizje dla top ${Math.min(COMMISSION_BATCH, topResults.length)}...`);

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
