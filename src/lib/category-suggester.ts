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

async function selectBestCategory(
  productTitle: string,
  attributes: Record<string, string>,
  candidates: Array<{ id: string; name: string; fullPath: string }>,
  anthropic: Anthropic,
): Promise<string | null> {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].id;

  const attributesSummary = Object.entries(attributes)
    .slice(0, 10)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

  const candidateList = candidates
    .map((c, i) => `${i + 1}. [${c.id}] ${c.fullPath}`)
    .join('\n');

  const prompt = `Masz produkt i listę kandydatów kategorii Allegro. Wybierz JEDNĄ najlepiej pasującą.

Produkt: "${productTitle}"${attributesSummary ? `\nAtrybuty: ${attributesSummary}` : ''}

Kandydaci:
${candidateList}

Odpowiedz WYŁĄCZNIE numerem ID wybranej kategorii (sama liczba, zero innych znaków):`;

  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 20,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = (res.content[0] as { type: 'text'; text: string }).text.trim();
    const picked = raw.replace(/\D/g, '');
    const found = candidates.find(c => c.id === picked);
    if (found) {
      console.log(`[suggestCategory] best pick: [${found.id}] ${found.fullPath}`);
      return found.id;
    }
  } catch (err) {
    console.log('[suggestCategory] selectBestCategory failed:', err instanceof Error ? err.message : err);
  }
  return null;
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

  const userPrompt = `Jesteś ekspertem od struktury kategorii Allegro.pl.

Produkt: "${productTitle}"
${attributesSummary ? `Atrybuty:\n${attributesSummary}` : ''}

Twoim zadaniem jest zaproponowanie 6-8 fraz wyszukiwania, które pasują do NAZW kategorii na Allegro.
Kategorie Allegro to krótkie polskie rzeczowniki lub wyrażenia rzeczownikowe, np.:
- "Patchcordy", "Kable sieciowe", "Złączki kablowe", "Dławiki", "Rury osłonowe"
- "Odkurzacze pionowe", "Roboty sprzątające", "Akcesoria do odkurzaczy"
- "Wiertarki udarowe", "Szlifierki kątowe", "Narzędzia elektryczne"

ZASADY:
1. Pomijaj marki, numery modeli, wymiary, kolory — szukaj po TYPIE produktu
2. Zacznij od najbardziej szczegółowej nazwy (2-3 słowa), kończ na ogólnej (2 słowa)
3. Używaj polskich rzeczowników w mianowniku liczby mnogiej lub pojedynczej
4. Jeśli tytuł jest po angielsku, przetłumacz typ produktu na polski
5. NIGDY nie używaj ogólnych słów: "zestawy", "akcesoria", "produkty", "artykuły" —
   te słowa pasują do setek niezwiązanych kategorii. Zamiast tego użyj nadrzędnej kategorii
   (np. zamiast "zestawy" → "zastawa stołowa"; zamiast "akcesoria" → "akcesoria elektryczne")

Odpowiedz WYŁĄCZNIE tym JSON (bez żadnych innych znaków, bez \`\`\`):
{"searches": ["fraza 1", "fraza 2", "fraza 3", "fraza 4", "fraza 5", "fraza 6"]}`;

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

  const rawContent = (llmRes.content[0] as { type: 'text'; text: string }).text ?? '{}';
  // Strip markdown code fences if LLM wraps response despite instructions
  const content = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
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

  // Krok 3: LLM wybiera najlepszą kategorię z kandydatów
  onProgress?.('Wybieram najlepszą kategorię...');
  const bestId = await selectBestCategory(productTitle, attributes, topResults, anthropic);

  // Przesuń wybraną kategorię na pierwszą pozycję
  let orderedResults = topResults;
  if (bestId) {
    const bestIdx = topResults.findIndex(c => c.id === bestId);
    if (bestIdx > 0) {
      orderedResults = [topResults[bestIdx], ...topResults.slice(0, bestIdx), ...topResults.slice(bestIdx + 1)];
    }
  }

  const COMMISSION_BATCH = 5;
  onProgress?.(`Pobieram prowizje dla top ${Math.min(COMMISSION_BATCH, orderedResults.length)}...`);

  const commissionsRaw = await Promise.allSettled(
    orderedResults.slice(0, COMMISSION_BATCH).map(cat => getCommissionInfo(cat.id))
  );

  const suggestions: CategorySuggestion[] = orderedResults.map((cat, i) => ({
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
