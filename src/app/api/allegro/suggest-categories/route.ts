import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { searchCategories, getCommissionInfo } from '@/lib/allegro';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface SuggestRequest {
  productTitle: string;
  productAttributes?: Record<string, string>;
  sourceCategory?: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as SuggestRequest;

    if (!body.productTitle) {
      return NextResponse.json({ error: 'Brak tytułu produktu' }, { status: 400 });
    }

    // Step 1: Ask LLM to suggest category search terms
    const attributesSummary = body.productAttributes
      ? Object.entries(body.productAttributes)
          .slice(0, 15)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n')
      : '';

    const userPrompt = `Jesteś ekspertem od kategoryzacji produktów na Allegro.pl.

Produkt: "${body.productTitle}"
${body.sourceCategory ? `Kategoria źródłowa: ${body.sourceCategory}` : ''}
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

    const content = (llmRes.content[0] as { type: 'text'; text: string }).text ?? '{}';
    let searches: string[] = [];
    try {
      const parsed = JSON.parse(content);
      searches = Array.isArray(parsed.searches) ? parsed.searches : [];
    } catch {
      searches = [body.productTitle.split(' ').slice(0, 3).join(' ')];
    }

    // Step 2: Search for each term and collect unique leaf categories
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
        // Skip failed searches
      }
    }

    // Step 3: Fetch commission info for top results (max 5, with timeout)
    // Ograniczamy do 5 żeby nie blokować serwera zbyt długo
    const topResults = allResults.slice(0, 10);
    const COMMISSION_BATCH = 5;
    const commissionsRaw = await Promise.allSettled(
      topResults.slice(0, COMMISSION_BATCH).map(cat => getCommissionInfo(cat.id))
    );

    const suggestions = topResults.map((cat, i) => ({
      id: cat.id,
      name: cat.name,
      path: cat.fullPath,
      leaf: true,
      commission: i < COMMISSION_BATCH && commissionsRaw[i].status === 'fulfilled'
        ? commissionsRaw[i].value
        : null,
    }));

    return NextResponse.json({ suggestions });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
