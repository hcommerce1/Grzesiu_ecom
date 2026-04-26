import type { ImageMeta, DescriptionSection, AllegroParameter, ProductSession, DescriptionInputSnapshot } from './types';
import { compileSectionsToHtml, computeInputHash, buildInputSnapshot, interpolatePrompt } from './description-utils';
import { DEFAULT_DESCRIPTION_PROMPT } from './description-prompt';
import { filterAttributesForAI } from './ai-field-filter';
import { DESCRIPTION_STYLES, type DescriptionStyleId } from './description-styles';
import type { AnthropicUsage } from './image-analyzer';
import { parseClaudeJson } from './parse-claude-json';

const CLAUDE_MODEL = 'claude-sonnet-4-6';

export interface GenerateDescriptionOptions {
  session: ProductSession;
  imagesMeta: ImageMeta[];
  style?: 'technical' | 'lifestyle' | 'simple';
  additionalContext?: string;
  customPrompt?: string;
}

export async function generateDescription(
  opts: GenerateDescriptionOptions,
  apiKey: string,
): Promise<{ sections: DescriptionSection[]; fullHtml: string; inputHash: string; inputSnapshot: DescriptionInputSnapshot; usage: AnthropicUsage }> {
  const { session, imagesMeta, style, additionalContext, customPrompt } = opts;

  const activeImages = (imagesMeta || [])
    .filter(i => !i.removed)
    .sort((a, b) => a.order - b.order);

  if (!activeImages.length) {
    throw new Error('Brak aktywnych zdjęć do generowania opisu');
  }

  const imageDescriptions = activeImages
    .map((img, idx) => {
      const desc = img.userDescription || img.aiDescription || 'Brak opisu';
      const feats = img.features?.length ? ` [Cechy: ${img.features.join(', ')}]` : '';
      return `Zdjęcie ${idx}: ${desc}${feats}`;
    })
    .join('\n');

  const filteredAttributes = filterAttributesForAI(session.data?.attributes || {});
  const attributes = Object.entries(filteredAttributes)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  const paramDefs: AllegroParameter[] = session.allegroParameters ?? [];
  const parameters = Object.entries(session.filledParameters ?? {})
    .map(([k, v]) => {
      const def = paramDefs.find(p => p.id === k);
      const name = def?.name || k;
      const rawOpts = def?.dictionary ?? (Array.isArray(def?.options) ? def.options : null) ?? def?.restrictions?.allowedValues ?? [];
      const opts2 = Array.isArray(rawOpts) ? rawOpts : [];
      const translateVal = (val: string) => opts2.find(o => o.id === val)?.value ?? val;
      const translatedVal = Array.isArray(v) ? v.map(translateVal).join(', ') : translateVal(v);
      return `- ${name}: ${translatedVal}`;
    })
    .join('\n');

  const bundleContextSection = session.data?.bundleContextText
    ? `\n\n## Kontekst zestawu (składniki):\n${session.data.bundleContextText}`
    : '';

  const styleId = style as DescriptionStyleId | undefined;
  const styleSection = styleId && DESCRIPTION_STYLES[styleId]
    ? `\n\n## STYL OPISU: ${DESCRIPTION_STYLES[styleId].name}\n${DESCRIPTION_STYLES[styleId].sectionInstructions}`
    : '';

  const contextSection = additionalContext
    ? `\n\n## DODATKOWY KONTEKST OD UŻYTKOWNIKA:\n${additionalContext}`
    : '';

  const originalDescSection = session.data?.description?.trim()
    ? session.data.description.slice(0, 4000)
    : '(brak oryginalnego opisu)';

  const categoryPath = session.allegroCategory?.path ?? '';
  const title = session.generatedTitle || session.data?.title || '';
  const uwagi = session.sheetMeta?.uwagiKrotkie || '';

  const promptTemplate = customPrompt?.trim() || DEFAULT_DESCRIPTION_PROMPT;
  const systemPrompt = interpolatePrompt(promptTemplate, {
    title,
    attributes: attributes || '(brak)',
    category: categoryPath || '(nie wybrano)',
    parameters: parameters || '(brak)',
    image_count: activeImages.length,
    image_descriptions: imageDescriptions,
    uwagi: uwagi || '(brak uwag — produkt w pełni sprawny)',
    reference_description: '',
    original_description: originalDescSection,
    ean: session.data?.ean || '(brak)',
    sku: session.data?.sku || '(brak)',
    price: session.data?.price ? `${session.data.price} ${session.data.currency || ''}`.trim() : '(brak)',
  }) + bundleContextSection + styleSection + contextSection + '\n\nZwróć WYŁĄCZNIE obiekt JSON z kluczem "sections". Żadnego innego tekstu, bez markdown, bez komentarzy.';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      system: [
        { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: 'Wygeneruj strukturalny opis produktu.' }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude API error (${response.status}): ${await response.text()}`);
  }

  const data = await response.json();
  const usage: AnthropicUsage = data.usage ?? {};
  const content = data.content?.[0]?.text ?? '{}';
  const parsed = parseClaudeJson(content) as { sections?: unknown };

  const rawSections: Array<{ imageIndex?: number; imageIndices?: number[]; heading?: string; body?: string; layout?: string }> =
    (Array.isArray(parsed?.sections) ? parsed.sections : []) as Array<{ imageIndex?: number; imageIndices?: number[]; heading?: string; body?: string; layout?: string }>;

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
      layout: (s.layout as DescriptionSection['layout']) || 'image-text',
    };
  });

  const fullHtml = compileSectionsToHtml(sections);
  const snapshot = buildInputSnapshot(
    title,
    imagesMeta,
    session.filledParameters ?? {},
    session.allegroCategory?.id ?? '',
    session.data?.attributes ?? {},
  );
  const inputHash = computeInputHash(snapshot);

  return { sections, fullHtml, inputHash, inputSnapshot: snapshot, usage };
}
