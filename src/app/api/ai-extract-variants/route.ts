import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { parseClaudeJson } from '@/lib/parse-claude-json';
import { logTokenUsage } from '@/lib/token-logger';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-haiku-4-5-20251001';

export interface ExtractionResult {
  productId: string;
  values: Record<string, string>;
  confidence: number;
  missing: string[];
}

interface InputProduct {
  id: string;
  name: string;
  ean?: string;
  sku?: string;
}

export async function POST(req: NextRequest) {
  try {
    const { products, diffFields, templateTitle, sessionKey } = (await req.json()) as {
      products: InputProduct[];
      diffFields: string[];
      templateTitle?: string;
      sessionKey?: string;
    };

    if (!products?.length || !diffFields?.length) {
      return NextResponse.json({ error: 'Missing products or diffFields' }, { status: 400 });
    }

    // Extract attr: prefixed fields — these need AI extraction from name
    const attrFields = diffFields
      .filter(f => f.startsWith('attr:'))
      .map(f => f.replace('attr:', ''));

    // Build extraction results — EAN/SKU are taken directly, attrs need AI
    const extractions: ExtractionResult[] = [];

    if (attrFields.length === 0) {
      // No attr fields to extract — just fill EAN/SKU directly
      for (const p of products) {
        const values: Record<string, string> = {};
        if (diffFields.includes('ean') && p.ean) values['ean'] = p.ean;
        if (diffFields.includes('sku') && p.sku) values['sku'] = p.sku;
        extractions.push({ productId: p.id, values, confidence: 1, missing: [] });
      }
      return NextResponse.json({ extractions });
    }

    // Build AI prompt for attribute extraction from names
    const productList = products
      .map((p, i) => `${i + 1}. ID="${p.id}" Nazwa="${p.name}"`)
      .join('\n');

    const attrList = attrFields.map(a => `"${a}"`).join(', ');
    const templateLine = templateTitle ? `Tytuł szablonu (wzorzec): "${templateTitle}"\n` : '';

    const systemPrompt = `Jesteś asystentem ekstrakcji danych produktów. Analizujesz nazwy produktów i wyciągasz z nich wartości wskazanych atrybutów.

ZASADY:
- Wyciągaj wartości TYLKO z nazwy produktu — nie wymyślaj.
- Jeśli wartości nie ma w nazwie — zwróć pusty string dla tego atrybutu i dodaj go do missing[].
- Zwracaj wartości w oryginalnej formie z nazwy (np. "Czerwony", "52cm", "XL").
- confidence: 0.0-1.0 — jak pewny jesteś że poprawnie wyciągnąłeś WSZYSTKIE atrybuty dla tego produktu.

Odpowiedz WYŁĄCZNIE poprawnym JSON bez markdown:
{
  "results": [
    {
      "id": "ID produktu",
      "values": { "NazwaAtrybutu": "wartość", ... },
      "confidence": 0.9,
      "missing": ["AtrybutKtóregoNieMa"]
    }
  ]
}`;

    const userPrompt = `${templateLine}Atrybuty do wyciągnięcia: ${attrList}

Produkty:
${productList}`;

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    logTokenUsage({
      productId: '__global__',
      sessionKey,
      toolName: 'extract_variants',
      model: MODEL,
      usage: response.usage,
    });

    const content = (response.content[0] as { type: 'text'; text: string }).text || '{}';
    const parsed = parseClaudeJson<{ results?: Array<{ id: string; values: Record<string, string>; confidence: number; missing: string[] }> }>(content);
    const aiResults = parsed.results || [];

    // Build final extractions — merge AI results with direct EAN/SKU
    const aiByProductId = new Map(aiResults.map(r => [r.id, r]));

    for (const p of products) {
      const ai = aiByProductId.get(p.id);
      const values: Record<string, string> = { ...(ai?.values || {}) };
      const missing: string[] = [...(ai?.missing || [])];

      // Fill EAN/SKU directly from data
      if (diffFields.includes('ean')) {
        if (p.ean) values['ean'] = p.ean;
        else if (!missing.includes('ean')) missing.push('ean');
      }
      if (diffFields.includes('sku')) {
        if (p.sku) values['sku'] = p.sku;
        else if (!missing.includes('sku')) missing.push('sku');
      }

      extractions.push({
        productId: p.id,
        values,
        confidence: ai?.confidence ?? 0.5,
        missing,
      });
    }

    return NextResponse.json({ extractions });
  } catch (err) {
    console.error('[ai-extract-variants]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Błąd ekstrakcji' },
      { status: 500 },
    );
  }
}
