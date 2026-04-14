import { NextResponse } from 'next/server';
import { searchCategories, getCommissionInfo } from '@/lib/allegro';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

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

    if (!OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OPENAI_API_KEY nie jest ustawiony' }, { status: 500 });
    }

    // Step 1: Ask LLM to suggest category search terms
    const attributesSummary = body.productAttributes
      ? Object.entries(body.productAttributes)
          .slice(0, 15)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n')
      : '';

    const prompt = `Jesteś ekspertem od kategoryzacji produktów na Allegro.pl.

Produkt: "${body.productTitle}"
${body.sourceCategory ? `Kategoria źródłowa: ${body.sourceCategory}` : ''}
${attributesSummary ? `Atrybuty:\n${attributesSummary}` : ''}

Zaproponuj 5-8 wyszukiwań kategorii Allegro, które najlepiej pasują do tego produktu.
Każde wyszukiwanie to 1-3 słowa kluczowe po polsku, które mogą być nazwą kategorii liściowej na Allegro.

Odpowiedz w formacie JSON:
{"searches": ["odkurzacze pionowe", "odkurzacze bezprzewodowe", "odkurzacze", ...]}

Podaj TYLKO JSON, bez komentarzy.`;

    const llmRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 500,
      }),
    });

    if (!llmRes.ok) {
      const text = await llmRes.text();
      return NextResponse.json({ error: `LLM error: ${text}` }, { status: 500 });
    }

    const llmData = await llmRes.json();
    const content = llmData.choices?.[0]?.message?.content ?? '{}';
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
