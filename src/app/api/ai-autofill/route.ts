import { NextResponse } from 'next/server';
import { buildAutoFillPrompt, validateAutoFillResponse } from '@/lib/ai-autofill';
import type { AllegroParameter, ProductData } from '@/lib/types';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const AUTOFILL_MODEL = process.env.AUTOFILL_MODEL || 'claude-haiku-4-5-20251001';

interface AutoFillRequest {
  productData: ProductData;
  parameters: AllegroParameter[];
  alreadyFilled?: Record<string, string | string[]>;
  imageMeta?: Array<{ url: string; aiDescription?: string; features?: string[] }>;
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

    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY nie jest ustawiony' },
        { status: 500 },
      );
    }

    const { systemPrompt, parameterIds } = buildAutoFillPrompt(
      body.productData,
      body.parameters,
      body.alreadyFilled ?? {},
      body.imageMeta,
    );

    // Nothing to fill
    if (!systemPrompt || parameterIds.length === 0) {
      return NextResponse.json({
        filled: {},
        details: [],
        unfilled: body.parameters.map((p) => p.id),
      });
    }

    console.log(`[AI auto-fill] Using model: ${AUTOFILL_MODEL}, params: ${parameterIds.length}, images: ${body.imageMeta?.length ?? 0}`);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: AUTOFILL_MODEL,
        max_tokens: 4000,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: 'Przeanalizuj dane produktu i dopasuj wartości do parametrów Allegro. Zwróć JSON z tablicą results.',
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    // Anthropic returns content as array: data.content[0].text
    const content = data.content?.[0]?.text || '{}';
    console.log('[AI auto-fill] Raw Claude response (first 500 chars):', content.slice(0, 500));

    // Extract JSON — Claude may wrap in markdown code fences
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();

    const parsed = JSON.parse(jsonStr);

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
    console.log(`[AI auto-fill] Parsed ${rawEntries.length} entries from Claude response`);

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
