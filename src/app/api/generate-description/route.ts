import { NextResponse } from 'next/server';
import type { ImageMeta, DescriptionSection, AllegroParameter } from '@/lib/types';
import { compileSectionsToHtml, computeInputHash, buildInputSnapshot } from '@/lib/description-utils';
import { DEFAULT_DESCRIPTION_PROMPT } from '@/lib/description-prompt';
import { interpolatePrompt } from '@/lib/description-utils';
import { filterAttributesForAI } from '@/lib/ai-field-filter';
import { DESCRIPTION_STYLES, type DescriptionStyleId } from '@/lib/description-styles';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const CLAUDE_MODEL = 'claude-opus-4-6';

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
  allegroParameters?: AllegroParameter[];
  prompt?: string;
  uwagi?: string;
  bundleContext?: string;
  referenceDescription?: string;
  style?: string;
  // Pełny kontekst produktu
  originalDescription?: string;
  price?: string;
  currency?: string;
  ean?: string;
  sku?: string;
  productUrl?: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as GenerateDescriptionRequest;

    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY nie jest ustawiony' }, { status: 500 });
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

    // Przygotuj atrybuty (bez pól wewnętrznych)
    const filteredAttributes = filterAttributesForAI(body.translatedData.attributes || {});
    const attributes = Object.entries(filteredAttributes)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join('\n');

    // Przygotuj parametry — tłumacz ID → czytelne nazwy/wartości
    const paramDefs = body.allegroParameters || [];
    const parameters = Object.entries(body.filledParameters || {})
      .map(([k, v]) => {
        const def = paramDefs.find(p => p.id === k);
        const name = def?.name || k;
        const opts = def?.options ?? def?.restrictions?.allowedValues ?? def?.dictionary ?? [];
        const translateVal = (val: string) => opts.find(o => o.id === val)?.value ?? val;
        const translatedVal = Array.isArray(v) ? v.map(translateVal).join(', ') : translateVal(v);
        return `- ${name}: ${translatedVal}`;
      })
      .join('\n');

    // Kontekst zestawu (jeśli dotyczy)
    const bundleContextSection = body.bundleContext
      ? `\n\n## Kontekst zestawu (składniki):\n${body.bundleContext}`
      : '';

    // Instrukcje stylu (jeśli podany)
    const styleId = body.style as DescriptionStyleId | undefined;
    const styleSection = styleId && DESCRIPTION_STYLES[styleId]
      ? `\n\n## STYL OPISU: ${DESCRIPTION_STYLES[styleId].name}\n${DESCRIPTION_STYLES[styleId].sectionInstructions}`
      : '';

    // Opis referencyjny (jeśli podany)
    const referenceSection = body.referenceDescription
      ? `## PRZYKŁADOWY OPIS REFERENCYJNY (wzorzec stylu i głębokości)\n${body.referenceDescription}`
      : '';

    // Oryginalny opis produktu ze źródła
    const originalDescSection = body.originalDescription?.trim()
      ? body.originalDescription.slice(0, 4000)
      : '(brak oryginalnego opisu)';

    // URL źródłowy
    const urlLine = body.productUrl ? `\nŹródło: ${body.productUrl}` : '';

    // Interpoluj prompt
    const promptTemplate = body.prompt?.trim() || DEFAULT_DESCRIPTION_PROMPT;
    const systemPrompt = interpolatePrompt(promptTemplate, {
      title: body.title,
      attributes: attributes || '(brak)',
      category: body.categoryPath || '(nie wybrano)',
      parameters: parameters || '(brak)',
      image_count: activeImages.length,
      image_descriptions: imageDescriptions,
      uwagi: body.uwagi || '(brak uwag — produkt w pełni sprawny)',
      reference_description: referenceSection,
      original_description: originalDescSection,
      ean: body.ean || '(brak)',
      sku: body.sku || '(brak)',
      price: body.price ? `${body.price} ${body.currency || ''}`.trim() : '(brak)',
    }) + urlLine + bundleContextSection + styleSection + '\n\nZwróć WYŁĄCZNIE obiekt JSON z kluczem "sections". Żadnego innego tekstu, bez markdown, bez komentarzy.';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4000,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: 'Wygeneruj strukturalny opis produktu.',
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Claude API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    const content = data.content?.[0]?.text ?? '{}';

    // Strip potential markdown code fences
    const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);

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
