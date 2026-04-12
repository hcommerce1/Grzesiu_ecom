import { NextResponse } from 'next/server';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

const SYSTEM_PROMPT = `Jesteś ekspertem od tworzenia tytułów aukcji na Allegro.

### Zasady tytułu:
- Maksymalnie 75 znaków (wykorzystaj jak najwięcej)
- WIELKIE LITERY
- Nie używaj znaków specjalnych (żadnych: !, *, +, emoji)
- Tytuł ma być czytelny, konkretny i brzmieć naturalnie po polsku
- Umieść 2-3 naturalne frazy kluczowe, NIE rób listy słów kluczowych
- Nie pisz nazwy marki jako pierwszego słowa
- Zachowaj sens oryginalnej nazwy - nie dodawaj informacji których nie ma w danych

### Przykłady dobrych tytułów:
- "NOWOCZESNA KONSOLA 100 CM STOLIK Z GEOMETRYCZNĄ PODSTAWĄ"
- "FOTEL RELAKSACYJNY OBROTOWY ROZKŁADANY Z PODNÓŻKIEM FLEXISPOT XC6 BRĄZ"
- "BIURKO REGULOWANE ELEKTRYCZNIE 120X60 CM Z WYŚWIETLACZEM LED"

### Przykłady złych tytułów:
- "KONSOLA 100 CM BIAŁA GEOMETRYCZNA PODSTAWA MDF TRIBESIGNS" (lista słów)
- "TRIBESIGNS NOWOCZESNA KONSOLA" (marka na początku)

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
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as GenerateTitleRequest;

    if (!OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OPENAI_API_KEY nie jest ustawiony' }, { status: 500 });
    }

    const productContext = [
      `Oryginalny tytuł: ${body.translatedData.title}`,
      '',
      'Atrybuty:',
      ...Object.entries(body.translatedData.attributes || {}).map(([k, v]) => `- ${k}: ${v}`),
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

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Wygeneruj tytuł Allegro dla tego produktu:\n\n${productContext.join('\n')}` },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`LLM API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{}';
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
