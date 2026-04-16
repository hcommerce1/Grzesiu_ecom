import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface DetectDiffAttrsResult {
  detectedAttrs: string[];
  reasoning: string;
}

export async function POST(req: NextRequest) {
  try {
    const { products } = (await req.json()) as {
      products: { id: string; name: string }[];
    };

    if (!products?.length) {
      return NextResponse.json({ error: 'Missing products' }, { status: 400 });
    }

    const productList = products.map((p, i) => `${i + 1}. ${p.name}`).join('\n');

    const systemPrompt =
      'Jesteś ekspertem od analizy nazw produktów e-commerce. ' +
      'Analizujesz listę podobnych produktów i wykrywasz atrybuty, ' +
      'które RÓŻNIĄ SIĘ między produktami (np. kolor, rozmiar, długość, pojemność, moc). ' +
      'Ignorujesz części nazwy które są stałe/identyczne. ' +
      'Zwracaj TYLKO atrybuty, które realnie się różnią. ' +
      'Odpowiedz WYŁĄCZNIE poprawnym JSON bez markdown: { "detectedAttrs": ["Rozmiar", "Kolor"], "reasoning": "krótkie wyjaśnienie" }';

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Przeanalizuj te nazwy produktów i znajdź atrybuty które się różnią:\n\n${productList}`,
        },
      ],
    });

    const content = (response.content[0] as { type: 'text'; text: string }).text;
    const parsed = JSON.parse(content) as DetectDiffAttrsResult;

    return NextResponse.json({
      detectedAttrs: parsed.detectedAttrs ?? [],
      reasoning: parsed.reasoning ?? '',
    });
  } catch (e) {
    console.error('ai-detect-diff-attrs error:', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
