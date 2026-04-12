import { NextResponse } from 'next/server';
import type { ImageMeta, DescriptionSection } from '@/lib/types';
import { compileSectionsToHtml, computeInputHash, buildInputSnapshot } from '@/lib/description-utils';
import { DEFAULT_DESCRIPTION_PROMPT } from '@/lib/description-prompt';
import { interpolatePrompt } from '@/lib/description-utils';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

interface GenerateDescriptionRequest {
  title: string;
  translatedData: {
    title: string;
    attributes: Record<string, string>;
  };
  imagesMeta: ImageMeta[];
  filledParameters: Record<string, string | string[]>;
  categoryPath: string;
  categoryId: string;
  prompt?: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as GenerateDescriptionRequest;

    if (!OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OPENAI_API_KEY nie jest ustawiony' }, { status: 500 });
    }

    const activeImages = (body.imagesMeta || [])
      .filter(i => !i.removed)
      .sort((a, b) => a.order - b.order);

    if (!activeImages.length) {
      return NextResponse.json({ error: 'Brak aktywnych zdjęć' }, { status: 400 });
    }

    // Przygotuj opisy zdjec
    const imageDescriptions = activeImages
      .map((img, idx) => {
        const desc = img.userDescription || img.aiDescription || 'Brak opisu';
        const feats = img.features?.length ? ` [Cechy: ${img.features.join(', ')}]` : '';
        return `Zdjęcie ${idx}: ${desc}${feats}`;
      })
      .join('\n');

    // Przygotuj atrybuty
    const attributes = Object.entries(body.translatedData.attributes || {})
      .map(([k, v]) => `- ${k}: ${v}`)
      .join('\n');

    // Przygotuj parametry
    const parameters = Object.entries(body.filledParameters || {})
      .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join('\n');

    // Interpoluj prompt
    const promptTemplate = body.prompt?.trim() || DEFAULT_DESCRIPTION_PROMPT;
    const systemPrompt = interpolatePrompt(promptTemplate, {
      title: body.title,
      attributes: attributes || '(brak)',
      category: body.categoryPath || '(nie wybrano)',
      parameters: parameters || '(brak)',
      image_count: activeImages.length,
      image_descriptions: imageDescriptions,
    });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: 'Wygeneruj strukturalny opis produktu według podanych instrukcji. Zwróć JSON z sekcjami.',
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`LLM API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);

    // Przeksztalc odpowiedz AI na DescriptionSection[]
    const rawSections: Array<{
      imageIndex?: number;
      imageIndices?: number[];
      heading?: string;
      body?: string;
      layout?: string;
    }> = parsed.sections || [];

    const sections: DescriptionSection[] = rawSections.map((s, idx) => {
      const isImagesOnly = s.layout === 'images-only';
      let imageUrls: string[] = [];

      if (isImagesOnly && Array.isArray(s.imageIndices)) {
        imageUrls = s.imageIndices
          .filter((i: number) => i >= 0 && i < activeImages.length)
          .map((i: number) => activeImages[i].url);
      } else if (typeof s.imageIndex === 'number' && s.imageIndex >= 0 && s.imageIndex < activeImages.length) {
        imageUrls = [activeImages[s.imageIndex].url];
      }

      return {
        id: `section-${idx}`,
        imageUrls,
        heading: s.heading || '',
        bodyHtml: s.body || '',
        layout: isImagesOnly ? 'images-only' : 'image-text',
      };
    });

    // Kompiluj HTML
    const fullHtml = compileSectionsToHtml(sections);

    // Hash danych wejsciowych
    const snapshot = buildInputSnapshot(
      body.title,
      body.imagesMeta,
      body.filledParameters || {},
      body.categoryId || '',
      body.translatedData.attributes || {},
    );
    const inputHash = computeInputHash(snapshot);

    return NextResponse.json({
      sections,
      fullHtml,
      inputHash,
    });
  } catch (err) {
    console.error('Description generation failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Błąd generowania opisu' },
      { status: 500 },
    );
  }
}
