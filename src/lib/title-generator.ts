import { filterAttributesForAI } from './ai-field-filter';
import type { ProductSession, ImageMeta } from './types';
import type { AnthropicUsage } from './image-analyzer';

const TITLE_MODEL = process.env.TITLE_MODEL || 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `Jesteś ekspertem od tworzenia tytułów aukcji na Allegro.

### Zasady tytułu:
- Maksymalnie 75 znaków (wykorzystaj jak najwięcej)
- WIELKIE LITERY
- Nie używaj znaków specjalnych (żadnych: !, *, +, emoji)
- Tytuł ma być czytelny, konkretny i brzmieć naturalnie po polsku
- Umieść 2-3 naturalne frazy kluczowe, NIE rób listy słów kluczowych
- Nie pisz nazwy marki jako pierwszego słowa
- Zachowaj sens oryginalnej nazwy - nie dodawaj informacji których nie ma w danych
- NIE używaj ogólnych fraz marketingowych: "wysoka jakość", "dobry produkt", "idealny wybór", "najlepsza cena"
- Skup się na KONKRETACH: typ produktu, model, wymiary, kolor, materiał, moc, pojemność

### Przykłady dobrych tytułów:
- "NOWOCZESNA KONSOLA 100 CM STOLIK Z GEOMETRYCZNĄ PODSTAWĄ"
- "FOTEL RELAKSACYJNY OBROTOWY ROZKŁADANY Z PODNÓŻKIEM FLEXISPOT XC6 BRĄZ"
- "BIURKO REGULOWANE ELEKTRYCZNIE 120X60 CM Z WYŚWIETLACZEM LED"

Zwróć JSON:
{
  "title": "TYTUŁ WIELKIMI LITERAMI",
  "candidates": ["ALTERNATYWA 1", "ALTERNATYWA 2", "ALTERNATYWA 3"]
}`;

export async function generateTitle(
  session: ProductSession,
  imagesMeta: ImageMeta[],
  additionalContext: string | undefined,
  apiKey: string,
): Promise<{ title: string; candidates: string[]; usage: AnthropicUsage }> {
  const filteredAttrs = filterAttributesForAI(session.data?.attributes || {});
  const productContext = [
    `Oryginalny tytuł: ${session.data?.title || ''}`,
    '',
    'Atrybuty:',
    ...Object.entries(filteredAttrs).map(([k, v]) => `- ${k}: ${v}`),
  ];

  if (session.allegroCategory?.path) {
    productContext.push('', `Kategoria Allegro: ${session.allegroCategory.path}`);
  }

  if (imagesMeta?.length) {
    const features = imagesMeta.flatMap(i => i.features).filter((f, idx, arr) => arr.indexOf(f) === idx);
    if (features.length) {
      productContext.push('', `Cechy widoczne na zdjęciach: ${features.join(', ')}`);
    }
  }

  if (session.data?.ean) productContext.push('', `EAN: ${session.data.ean}`);
  if (session.data?.sku) productContext.push(`SKU: ${session.data.sku}`);

  if (session.data?.description?.trim()) {
    productContext.push(
      '',
      'Oryginalny opis produktu (użyj jako źródło konkretnych informacji do tytułu):',
      session.data.description.slice(0, 1500),
    );
  }

  if (additionalContext) {
    productContext.push('', `Dodatkowy kontekst: ${additionalContext}`);
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: TITLE_MODEL,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Wygeneruj tytuł Allegro dla tego produktu:\n\n${productContext.join('\n')}` }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude title API error (${response.status}): ${await response.text()}`);
  }

  const data = await response.json();
  const usage: AnthropicUsage = data.usage ?? {};
  const raw = data.content?.[0]?.text || '{}';
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const content = jsonMatch ? jsonMatch[1].trim() : raw;
  const parsed = JSON.parse(content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());

  return {
    title: parsed.title || '',
    candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
    usage,
  };
}
