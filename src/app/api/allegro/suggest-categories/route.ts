import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { searchCategories } from '@/lib/allegro';
import { logTokenUsage } from '@/lib/token-logger';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const OPUS_MODEL = 'claude-opus-4-7';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

interface SuggestRequest {
  productTitle: string;
  productAttributes?: Record<string, string>;
  sourceCategory?: string;
  productId?: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as SuggestRequest;

    if (!body.productTitle) {
      return NextResponse.json({ error: 'Brak tytułu produktu' }, { status: 400 });
    }

    const title = body.productTitle;

    // Step 1: Opus extracts single-word search keywords in correct Polish category forms
    const extractPrompt = `Jesteś ekspertem kategorii Allegro. Dla podanego produktu wypisz słowa kluczowe do wyszukiwania kategorii na Allegro.

Produkt: "${title}"
${body.sourceCategory ? `Kategoria źródłowa: ${body.sourceCategory}` : ''}

Zasady:
- Każde słowo kluczowe = 1 słowo (nie frazy)
- Używaj form mianownika liczby mnogiej lub podstawowej (np. "peszle" nie "peszel", "kable" nie "kabel", "rury" nie "rura")
- Słowa muszą być typowymi nazwami kategorii Allegro
- Max 6 słów kluczowych, od najbardziej do najmniej specyficznych
- Uwzględnij zarówno specyficzne (np. "peszle") jak i szersze (np. "rury", "osprzęt")

Odpowiedz WYŁĄCZNIE poprawnym JSON bez markdown:
{"keywords": ["słowo1", "słowo2", "słowo3"]}`;

    const extractRes = await anthropic.messages.create({
      model: OPUS_MODEL,
      max_tokens: 150,
      messages: [{ role: 'user', content: extractPrompt }],
    });

    logTokenUsage({
      productId: body.productId ?? '__global__',
      toolName: 'suggest_categories_extract',
      model: OPUS_MODEL,
      usage: extractRes.usage,
    });

    let keywords: string[] = [];
    try {
      const parsed = JSON.parse((extractRes.content[0] as { type: 'text'; text: string }).text ?? '{}');
      keywords = Array.isArray(parsed.keywords) ? parsed.keywords.map(String).filter(Boolean) : [];
    } catch { /* fallback below */ }

    // Fallback: use title words directly if Opus failed
    if (keywords.length === 0) {
      keywords = title.toLowerCase()
        .replace(/[^a-ząćęłńóśźż\s-]/gi, ' ')
        .split(/[\s-]+/)
        .filter(w => w.length >= 4)
        .slice(0, 6);
    }

    // Step 2: Search categories for each keyword, collect up to 30 unique leaf candidates
    const seenIds = new Set<string>();
    const allCandidates: Array<{ id: string; name: string; fullPath: string; leaf: boolean }> = [];

    for (const keyword of keywords.slice(0, 6)) {
      if (allCandidates.length >= 30) break;
      try {
        const results = await searchCategories(keyword, 12, true);
        for (const cat of results) {
          if (allCandidates.length >= 30) break;
          if (!seenIds.has(cat.id)) {
            seenIds.add(cat.id);
            allCandidates.push(cat);
          }
        }
      } catch { /* skip */ }
    }

    if (allCandidates.length === 0) {
      return NextResponse.json({ suggestions: [] });
    }

    // Step 3: Haiku picks top 5 from candidates
    const candidateList = allCandidates
      .map(c => `ID:${c.id} | ${c.name} | ${c.fullPath}`)
      .join('\n');

    const rankPrompt = `Produkt: "${title}"
${body.sourceCategory ? `Kategoria źródłowa: ${body.sourceCategory}` : ''}

Wybierz 5 NAJLEPIEJ pasujących kategorii Allegro dla tego produktu. Jeśli żadna nie pasuje idealnie, wybierz najbliższe.

Kandydaci:
${candidateList}

Odpowiedz WYŁĄCZNIE poprawnym JSON bez markdown:
{"ids": ["123", "456", "789", "101", "102"]}`;

    const rankRes = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 200,
      messages: [{ role: 'user', content: rankPrompt }],
    });

    logTokenUsage({
      productId: body.productId ?? '__global__',
      toolName: 'suggest_categories_rank',
      model: HAIKU_MODEL,
      usage: rankRes.usage,
    });

    let pickedIds: string[] = [];
    try {
      const parsed = JSON.parse((rankRes.content[0] as { type: 'text'; text: string }).text ?? '{}');
      pickedIds = Array.isArray(parsed.ids) ? parsed.ids.map(String) : [];
    } catch { /* fallback below */ }

    const candidatesById = new Map(allCandidates.map(c => [c.id, c]));
    const ordered = pickedIds
      .map(id => candidatesById.get(id))
      .filter(Boolean) as typeof allCandidates;

    for (const cat of allCandidates) {
      if (ordered.length >= 5) break;
      if (!pickedIds.includes(cat.id)) ordered.push(cat);
    }

    const suggestions = ordered.slice(0, 5).map(cat => ({
      id: cat.id,
      name: cat.name,
      path: cat.fullPath,
      leaf: true,
      commission: null,
    }));

    return NextResponse.json({ suggestions });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
