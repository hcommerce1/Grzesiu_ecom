import { NextResponse } from 'next/server';
import { buildAutoFillPrompt, validateAutoFillResponse } from '@/lib/ai-autofill';
import type { AllegroParameter, ProductData } from '@/lib/types';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

interface AutoFillRequest {
  productData: ProductData;
  parameters: AllegroParameter[];
  alreadyFilled?: Record<string, string | string[]>;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AutoFillRequest;

    if (!body.productData || !body.parameters?.length) {
      return NextResponse.json(
        { error: 'Brak danych produktu lub parametrów' },
        { status: 400 },
      );
    }

    if (!OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY nie jest ustawiony' },
        { status: 500 },
      );
    }

    const { systemPrompt, parameterIds } = buildAutoFillPrompt(
      body.productData,
      body.parameters,
      body.alreadyFilled ?? {},
    );

    // Nothing to fill
    if (!systemPrompt || parameterIds.length === 0) {
      return NextResponse.json({
        filled: {},
        details: [],
        unfilled: body.parameters.map((p) => p.id),
      });
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content:
              'Przeanalizuj dane produktu i dopasuj wartości do parametrów. Zwróć tablicę JSON.',
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`LLM API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    console.log('[AI auto-fill] Raw LLM response (first 500 chars):', content.slice(0, 500));
    const parsed = JSON.parse(content);

    // LLM may return [...] directly, or wrap in { results: [...] }, { parameters: [...] }, etc.
    // With json_object mode, it's always an object — find the first array value.
    let rawEntries: unknown[] = [];
    if (Array.isArray(parsed)) {
      rawEntries = parsed;
    } else if (typeof parsed === 'object' && parsed !== null) {
      for (const val of Object.values(parsed)) {
        if (Array.isArray(val) && val.length > 0) {
          rawEntries = val;
          break;
        }
      }
    }
    console.log(`[AI auto-fill] Parsed ${rawEntries.length} entries from LLM response`);

    const result = validateAutoFillResponse(
      rawEntries,
      body.parameters,
      body.productData,
    );

    return NextResponse.json(result);
  } catch (err) {
    console.error('AI auto-fill failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Błąd auto-fill' },
      { status: 500 },
    );
  }
}
