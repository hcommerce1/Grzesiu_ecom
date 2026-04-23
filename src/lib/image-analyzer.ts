const VISION_MODEL = 'claude-sonnet-4-6';

export interface ImageAnalysisResult {
  url: string;
  aiDescription: string;
  aiConfidence: number;
  isFeatureImage: boolean;
  features: string[];
  labelText: string;
  variantHint: string;
  imageType: 'main' | 'detail' | 'label' | 'lifestyle' | '';
}

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
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

export async function analyzeImages(
  imageUrls: string[],
  apiKey: string,
): Promise<{ results: ImageAnalysisResult[]; usage: AnthropicUsage }> {
  const BATCH_SIZE = 5;
  const allResults: ImageAnalysisResult[] = [];
  const totalUsage: AnthropicUsage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

  for (let i = 0; i < imageUrls.length; i += BATCH_SIZE) {
    const batch = imageUrls.slice(i, i + BATCH_SIZE);

    const userContent: Array<{ type: string; text?: string; source?: { type: string; url: string } }> = [
      { type: 'text', text: `Przeanalizuj ${batch.length} zdjęć produktu. Zwróć wyniki jako JSON z polem "results" (tablica, kolejność zgodna z kolejnością zdjęć). Zwróć szczególną uwagę na tekst widoczny na etykietach, metryczce i nadrukach — odczytaj go dosłownie.` },
    ];

    for (const url of batch) {
      userContent.push({ type: 'image', source: { type: 'url', url } });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude vision API error (${response.status}): ${await response.text()}`);
    }

    const data = await response.json();
    const content = data.content?.[0]?.text || '{}';
    const usage: AnthropicUsage = data.usage ?? {};
    totalUsage.input_tokens += usage.input_tokens ?? 0;
    totalUsage.output_tokens += usage.output_tokens ?? 0;
    totalUsage.cache_creation_input_tokens = (totalUsage.cache_creation_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
    totalUsage.cache_read_input_tokens = (totalUsage.cache_read_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);

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

  return { results: allResults, usage: totalUsage };
}
