import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { translateProductBasic } from '@/lib/translator';
import { logTokenUsage } from '@/lib/token-logger';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.AGENT_MODEL || 'claude-haiku-4-5-20251001';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { rawContent, url, productId, sessionKey } = body as {
      rawContent: string;
      url?: string;
      productId?: string;
      sessionKey?: string;
    };

    if (!rawContent || rawContent.trim().length < 50) {
      return NextResponse.json({ success: false, error: 'rawContent jest zbyt krótki' }, { status: 400 });
    }

    // Truncate to stay within token limits (keep first ~6000 chars)
    const content = rawContent.slice(0, 6000);

    const prompt = `Przeanalizuj poniższą treść strony produktowej i wyekstrahuj dane produktu.

${url ? `URL strony: ${url}` : ''}

Treść strony:
${content}

Zwróć JSON w formacie:
{
  "title": "nazwa produktu po polsku",
  "description": "opis produktu po polsku (pełny, sformatowany HTML z <p>, <ul>, <strong> itp.)",
  "price": "cena jako liczba lub string",
  "currency": "PLN lub EUR",
  "sku": "kod SKU jeśli dostępny",
  "ean": "EAN/GTIN jeśli dostępny",
  "attributes": {
    "Kolor": "wartość",
    "Materiał": "wartość",
    "Wymiary": "wartość"
  }
}

Wyodrębnij jak najwięcej informacji. Jeśli czegoś nie ma, pomiń pole. Odpowiedz TYLKO poprawnym JSON.`;

    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    logTokenUsage({
      productId: productId ?? 'local',
      sessionKey,
      toolName: 'scrape_raw',
      model: MODEL,
      usage: res.usage,
    });

    const text = (res.content[0] as { type: 'text'; text: string }).text ?? '{}';
    let parsed: Record<string, unknown> = {};
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      return NextResponse.json({ success: false, error: 'AI nie zwróciło poprawnego JSON' }, { status: 500 });
    }

    const productData = {
      url: url || '',
      title: String(parsed.title || ''),
      description: String(parsed.description || ''),
      price: String(parsed.price || ''),
      currency: String(parsed.currency || 'PLN'),
      sku: String(parsed.sku || ''),
      ean: String(parsed.ean || ''),
      attributes: (parsed.attributes as Record<string, string>) || {},
      images: [],
    };

    const translated = await translateProductBasic(productData, { productId, sessionKey });
    return NextResponse.json({ success: true, data: translated, originalData: productData });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Błąd ekstrakcji';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
