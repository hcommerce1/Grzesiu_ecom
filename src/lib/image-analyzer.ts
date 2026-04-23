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

export interface ProductContext {
  title?: string;
  categoryPath?: string;
  keyAttributes?: Record<string, string>;
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
- Jeśli podano kontekst produktu (tytuł + kategoria), traktuj go jako podstawową prawdę o TYPIE produktu. Nie zmieniaj typu (np. na "legowisko", "puf", "poduszka") gdy tytuł/kategoria mówią co innego (np. "krzesło"). Kontekst nie zastępuje obserwacji wizualnych — opisuj nadal co widać na konkretnym zdjęciu.

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

type Base64Image = { media_type: string; data: string };

const ALLOWED_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — limit Anthropic
const FETCH_TIMEOUT_MS = 15000;

async function fetchImageAsBase64(url: string): Promise<Base64Image | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });
    if (!res.ok) return null;

    const ctRaw = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return null;

    let media_type = ctRaw;
    if (!ALLOWED_MEDIA.has(media_type)) {
      // Fallback: sniff magic bytes (Allegro czasem serwuje bez poprawnego content-type)
      if (buf[0] === 0xff && buf[1] === 0xd8) media_type = 'image/jpeg';
      else if (buf[0] === 0x89 && buf[1] === 0x50) media_type = 'image/png';
      else if (buf[0] === 0x47 && buf[1] === 0x49) media_type = 'image/gif';
      else if (buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57) media_type = 'image/webp';
      else return null;
    }

    return { media_type, data: buf.toString('base64') };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function formatContextBlock(context: ProductContext): string | null {
  const lines: string[] = [];
  if (context.title) lines.push(`- Tytuł: ${context.title}`);
  if (context.categoryPath) lines.push(`- Kategoria: ${context.categoryPath}`);
  if (context.keyAttributes) {
    const attrs = Object.entries(context.keyAttributes)
      .filter(([, v]) => v != null && String(v).trim())
      .map(([k, v]) => `${k}: ${v}`);
    if (attrs.length) lines.push(`- Atrybuty: ${attrs.join(', ')}`);
  }
  if (!lines.length) return null;

  return `Kontekst produktu (z listingu sprzedawcy, nie z tego zdjęcia):\n${lines.join('\n')}\n\nUżyj tego do identyfikacji TYPU produktu — jeśli tytuł mówi "krzesło", nie opisuj tego jako "legowisko" czy "puf". Kontekst NIE zastępuje obserwacji — nadal opisz dokładnie co widać na konkretnym zdjęciu.`;
}

export async function analyzeImages(
  imageUrls: string[],
  apiKey: string,
  context?: ProductContext,
): Promise<{ results: ImageAnalysisResult[]; usage: AnthropicUsage }> {
  const BATCH_SIZE = 5;
  const allResults: ImageAnalysisResult[] = [];
  const totalUsage: AnthropicUsage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

  const contextBlock = context ? formatContextBlock(context) : null;

  for (let i = 0; i < imageUrls.length; i += BATCH_SIZE) {
    const batch = imageUrls.slice(i, i + BATCH_SIZE);

    const fetched = await Promise.all(batch.map(fetchImageAsBase64));
    const okIndices: number[] = [];
    const okImages: Base64Image[] = [];
    for (let j = 0; j < batch.length; j++) {
      if (fetched[j]) {
        okIndices.push(j);
        okImages.push(fetched[j]!);
      }
    }

    // Jeśli żaden obraz się nie pobrał — zapisz błędy i przejdź do następnego batcha
    if (!okImages.length) {
      for (let j = 0; j < batch.length; j++) {
        allResults.push({
          url: batch[j],
          aiDescription: 'Błąd pobrania zdjęcia',
          aiConfidence: 0,
          isFeatureImage: false,
          features: [],
          labelText: '',
          variantHint: '',
          imageType: '',
        });
      }
      continue;
    }

    type UserContentBlock =
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

    const userContent: UserContentBlock[] = [];
    if (contextBlock) userContent.push({ type: 'text', text: contextBlock });
    userContent.push({
      type: 'text',
      text: `Przeanalizuj ${okImages.length} zdjęć produktu. Zwróć wyniki jako JSON z polem "results" (tablica, kolejność zgodna z kolejnością zdjęć). Zwróć szczególną uwagę na tekst widoczny na etykietach, metryczce i nadrukach — odczytaj go dosłownie.`,
    });
    for (const img of okImages) {
      userContent.push({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } });
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

    // Zmapuj wyniki AI (indeksy odpowiadają okImages/okIndices) z powrotem do batcha.
    // Dla każdej pozycji batcha: jeśli jest w okIndices → weź odpowiedni wynik; wpp. placeholder błędu.
    for (let j = 0; j < batch.length; j++) {
      const okPos = okIndices.indexOf(j);
      if (okPos === -1) {
        allResults.push({
          url: batch[j],
          aiDescription: 'Błąd pobrania zdjęcia',
          aiConfidence: 0,
          isFeatureImage: false,
          features: [],
          labelText: '',
          variantHint: '',
          imageType: '',
        });
        continue;
      }
      const r = results[okPos] || {};
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
