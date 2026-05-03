import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { searchCategories } from '@/lib/allegro';
import { logTokenUsage } from '@/lib/token-logger';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-haiku-4-5-20251001';

const STOP_WORDS = new Set(['dla', 'do', 'ze', 'na', 'po', 'przy', 'bez', 'lub', 'oraz', 'nie', 'jak', 'typ', 'set', 'new', 'the', 'and', 'for']);

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

    // Step 1: Collect category candidates by searching with words from product title
    const title = body.productTitle;
    const words = title
      .toLowerCase()
      .replace(/[^a-ząćęłńóśźż\s-]/gi, ' ')
      .split(/[\s-]+/)
      .filter(w => w.length >= 3 && !STOP_WORDS.has(w));

    const seenIds = new Set<string>();
    const allCandidates: Array<{ id: string; name: string; fullPath: string; leaf: boolean }> = [];

    // Search with individual words from title
    for (const word of words.slice(0, 8)) {
      try {
        const results = await searchCategories(word, 12, true);
        for (const cat of results) {
          if (!seenIds.has(cat.id)) {
            seenIds.add(cat.id);
            allCandidates.push(cat);
          }
        }
      } catch { /* skip */ }
    }

    // Also try full title (catches multi-word exact matches)
    try {
      const fullResults = await searchCategories(title, 10, true);
      for (const cat of fullResults) {
        if (!seenIds.has(cat.id)) {
          seenIds.add(cat.id);
          allCandidates.push(cat);
        }
      }
    } catch { /* skip */ }

    // Step 2: AI picks best 5 from candidates
    if (allCandidates.length === 0) {
      return NextResponse.json({ suggestions: [] });
    }

    const candidateList = allCandidates
      .slice(0, 30)
      .map(c => `ID:${c.id} | ${c.name} | ${c.fullPath}`)
      .join('\n');

    const rankPrompt = `Produkt: "${title}"
${body.sourceCategory ? `Kategoria źródłowa: ${body.sourceCategory}` : ''}

Poniżej lista kandydatów kategorii Allegro. Wybierz 5 NAJLEPIEJ pasujących do tego produktu i zwróć ich ID w kolejności od najlepszego.
Jeśli żadna nie pasuje dobrze, wybierz najbliższe.

Kandydaci:
${candidateList}

Odpowiedz WYŁĄCZNIE poprawnym JSON bez markdown:
{"ids": ["123", "456", "789", "101", "102"]}`;

    const rankRes = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 200,
      messages: [{ role: 'user', content: rankPrompt }],
    });

    logTokenUsage({
      productId: body.productId ?? '__global__',
      toolName: 'suggest_categories',
      model: MODEL,
      usage: rankRes.usage,
    });

    let pickedIds: string[] = [];
    try {
      const parsed = JSON.parse((rankRes.content[0] as { type: 'text'; text: string }).text ?? '{}');
      pickedIds = Array.isArray(parsed.ids) ? parsed.ids.map(String) : [];
    } catch { /* fallback below */ }

    // Build ordered suggestions from picked IDs, fallback to all candidates
    const candidatesById = new Map(allCandidates.map(c => [c.id, c]));
    const ordered = pickedIds
      .map(id => candidatesById.get(id))
      .filter(Boolean) as typeof allCandidates;

    // Fill up to 5 with remaining candidates if AI returned fewer
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
