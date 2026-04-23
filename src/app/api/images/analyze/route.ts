import { NextResponse } from 'next/server';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const VISION_MODEL = 'claude-sonnet-4-6';

interface ImageAnalysisResult {
  url: string;
  aiDescription: string;
  aiConfidence: number;
  isFeatureImage: boolean;
  features: string[];
  labelText: string;
  variantHint: string;
  imageType: 'main' | 'detail' | 'label' | 'lifestyle' | '';
}

const SYSTEM_PROMPT = `Jesteś analitykiem zdjęć produktów e-commerce. Dla każdego zdjęcia wykonaj PEŁNĄ analizę:

1. **Tekst z etykiet i napisów** — odczytaj DOSŁOWNIE każdy widoczny tekst: rozmiary (np. "52cm", "XL", "3/4"), długości, wagi, kody produktów, nazwy modeli, numery katalogowe, materiały, instrukcje, daty. Jeśli etykieta jest nieczytelna lub obrócona — napisz to wprost.
2. **Cechy wizualne** — opisuj kolor, wzór, fakturę, kształt, styl. Opisuj i produkt, i otoczenie/kontekst (np. jak produkt jest zamontowany, do czego podłączony, w jakim środowisku użyty). WAŻNE: nie przypisuj cech otoczenia do samego produktu — np. jeśli produkt leży na niebieskiej palecie, nie pisz "produkt jest niebieski".
3. **Wariant produktu** — na podstawie koloru, rozmiaru i tekstu z etykiet określ jaki to wariant (np. "czerwony L", "niebieski 52cm").
4. **Typ zdjęcia** — czy to zdjęcie główne (produkt w całości), detal (zbliżenie), etykieta/metryczka, czy zdjęcie w użyciu?
5. **Pewność** od 0 do 1.

ZASADY:
- Priorytet: tekst z etykiet > cechy wizualne. Etykieta zawsze wygrywa z oceną wizualną.
- Opisuj zarówno produkt jak i otoczenie/kontekst użytkowania — to cenne informacje.
- Nie przypisuj cech otoczenia do produktu (np. kolor tła ≠ kolor produktu).
- Jeśli widzisz rozmiar na etykiecie np. "52" — wpisz go dokładnie w labelText, nie interpretuj.
- Jeśli coś jest nieczytelne — napisz "nieczytelne", nie zgaduj.
- NIE wymyślaj cech których nie widzisz na zdjęciu.

Zwróć JSON:
{
  "results": [
    {
      "description": "pełny opis co widać na zdjęciu",
      "confidence": 0.85,
      "isFeatureImage": true,
      "features": ["cecha1", "cecha2"],
      "labelText": "pełny tekst odczytany z etykiet i napisów (pusty string jeśli brak)",
      "variantHint": "wykryty wariant np. czerwony 52cm (pusty string jeśli nie można określić)",
      "imageType": "main|detail|label|lifestyle"
    }
  ]
}`;

export async function POST(req: Request) {
  try {
    const { images } = (await req.json()) as { images: string[] };

    if (!images?.length) {
      return NextResponse.json({ error: 'Brak zdjęć do analizy' }, { status: 400 });
    }

    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY nie jest ustawiony' }, { status: 500 });
    }

    // Przetwarzaj w batchach po 5 zdjęć
    const BATCH_SIZE = 5;
    const allResults: ImageAnalysisResult[] = [];

    console.log(`[image-analyze] Analyzing ${images.length} images with model ${VISION_MODEL}`);

    for (let i = 0; i < images.length; i += BATCH_SIZE) {
      const batch = images.slice(i, i + BATCH_SIZE);
      console.log(`[image-analyze] Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} images`);

      const userContent: Array<{ type: string; text?: string; source?: { type: string; url: string } }> = [
        { type: 'text', text: `Przeanalizuj ${batch.length} zdjęć produktu. Zwróć wyniki jako JSON z polem "results" (tablica, kolejność zgodna z kolejnością zdjęć). Zwróć szczególną uwagę na tekst widoczny na etykietach, metryczce i nadrukach — odczytaj go dosłownie.` },
      ];

      for (const url of batch) {
        userContent.push({
          type: 'image',
          source: { type: 'url', url },
        });
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: VISION_MODEL,
          max_tokens: 4000,
          system: SYSTEM_PROMPT,
          messages: [
            { role: 'user', content: userContent },
          ],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error(`[image-analyze] Claude API error (${response.status}):`, err);
        throw new Error(`Claude API error (${response.status}): ${err}`);
      }

      const data = await response.json();
      const content = data.content?.[0]?.text || '{}';
      console.log(`[image-analyze] Raw response:`, content.slice(0, 500));

      const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      const results = parsed.results || [];

      for (let j = 0; j < batch.length; j++) {
        const r = results[j] || {};
        allResults.push({
          url: batch[j],
          aiDescription: r.description || '',
          aiConfidence: typeof r.confidence === 'number' ? r.confidence : 0.5,
          isFeatureImage: r.isFeatureImage ?? false,
          features: Array.isArray(r.features) ? r.features : [],
          labelText: r.labelText || '',
          variantHint: r.variantHint || '',
          imageType: r.imageType || '',
        });
      }
    }

    return NextResponse.json({ results: allResults });
  } catch (err) {
    console.error('Image analysis failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Błąd analizy zdjęć' },
      { status: 500 },
    );
  }
}
