import { NextResponse } from 'next/server';
import { filterAttributesForAI } from '@/lib/ai-field-filter';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const TITLE_MODEL = process.env.TITLE_MODEL || 'claude-opus-4-6';

const SYSTEM_PROMPT = `Jesteś ekspertem od tworzenia tytułów aukcji na Allegro.

### Zasady tytułu:
- Maksymalnie 75 znaków (wykorzystaj jak najwięcej)
- WIELKIE LITERY
- Nie używaj znaków specjalnych (żadnych: !, *, +, emoji)
- Tytuł ma być czytelny, konkretny i brzmieć naturalnie po polsku
- Umieść 2-3 naturalne frazy kluczowe, NIE rób listy słów kluczowych
- Nie pisz nazwy marki jako pierwszego słowa
- Zachowaj sens oryginalnej nazwy - nie dodawaj informacji których nie ma w danych
- NIE używaj ogólnych fraz marketingowych: "wysoka jakość", "dobry produkt", "idealny wybór", "najlepsza cena", "świetny", "doskonały" — to puste słowa bez wartości dla klienta
- Skup się na KONKRETACH: typ produktu, model, wymiary, kolor, materiał, moc, pojemność

### Przykłady dobrych tytułów:
- "NOWOCZESNA KONSOLA 100 CM STOLIK Z GEOMETRYCZNĄ PODSTAWĄ"
- "FOTEL RELAKSACYJNY OBROTOWY ROZKŁADANY Z PODNÓŻKIEM FLEXISPOT XC6 BRĄZ"
- "BIURKO REGULOWANE ELEKTRYCZNIE 120X60 CM Z WYŚWIETLACZEM LED"

### Przykłady złych tytułów:
- "KONSOLA 100 CM BIAŁA GEOMETRYCZNA PODSTAWA MDF TRIBESIGNS" (lista słów)
- "TRIBESIGNS NOWOCZESNA KONSOLA" (marka na początku)
- "FOTEL BIUROWY WYSOKA JAKOŚĆ KOMFORT" (puste frazy marketingowe)

Zwróć JSON:
{
  "title": "TYTUŁ WIELKIMI LITERAMI",
  "candidates": ["ALTERNATYWA 1", "ALTERNATYWA 2", "ALTERNATYWA 3"]
}`;

interface GenerateTitleRequest {
  translatedData: {
    title: string;
    attributes: Record<string, string>;
  };
  imagesMeta?: Array<{
    aiDescription: string;
    userDescription: string;
    features: string[];
  }>;
  categoryPath?: string;
  // Pełny kontekst produktu
  originalDescription?: string;
  ean?: string;
  sku?: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as GenerateTitleRequest;

    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY nie jest ustawiony' }, { status: 500 });
    }

    const filteredAttrs = filterAttributesForAI(body.translatedData.attributes || {});
    const productContext = [
      `Oryginalny tytuł: ${body.translatedData.title}`,
      '',
      'Atrybuty:',
      ...Object.entries(filteredAttrs).map(([k, v]) => `- ${k}: ${v}`),
    ];

    if (body.categoryPath) {
      productContext.push('', `Kategoria Allegro: ${body.categoryPath}`);
    }

    if (body.imagesMeta?.length) {
      const features = body.imagesMeta
        .flatMap(i => i.features)
        .filter((f, idx, arr) => arr.indexOf(f) === idx);
      if (features.length) {
        productContext.push('', `Cechy widoczne na zdjęciach: ${features.join(', ')}`);
      }
    }

    if (body.ean) productContext.push('', `EAN: ${body.ean}`);
    if (body.sku) productContext.push(`SKU: ${body.sku}`);

    if (body.originalDescription?.trim()) {
      productContext.push(
        '',
        'Oryginalny opis produktu (użyj jako źródło konkretnych informacji do tytułu):',
        body.originalDescription.slice(0, 1500),
      );
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: TITLE_MODEL,
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: `Wygeneruj tytuł Allegro dla tego produktu:\n\n${productContext.join('\n')}` },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    const raw = data.content?.[0]?.text || '{}';
    // Strip markdown code fences if present
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const content = jsonMatch ? jsonMatch[1].trim() : raw;
    const parsed = JSON.parse(content);

    return NextResponse.json({
      title: parsed.title || '',
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
    });
  } catch (err) {
    console.error('Title generation failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Błąd generowania tytułu' },
      { status: 500 },
    );
  }
}
