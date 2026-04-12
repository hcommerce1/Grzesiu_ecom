import { NextResponse } from 'next/server';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const VISION_MODEL = process.env.VISION_MODEL || 'gpt-4o';

interface ImageAnalysisResult {
  url: string;
  aiDescription: string;
  aiConfidence: number;
  isFeatureImage: boolean;
  features: string[];
}

const SYSTEM_PROMPT = `Jesteś analitykiem zdjęć produktów e-commerce. Dla każdego zdjęcia określ:

1. Czy to zwykłe zdjęcie produktu (pokazuje produkt ogólnie), czy zdjęcie z konkretnymi cechami (pokazuje szczegół, mechanizm, funkcję, materiał, wymiary)?
2. Opisz w 1-2 zdaniach po polsku co dokładnie widać na zdjęciu.
3. Wymień konkretne cechy produktu widoczne na zdjęciu (np. "regulacja wysokości", "schowek boczny", "obrotowa podstawa").
4. Oceń swoją pewność od 0 do 1.

Zwróć JSON:
{
  "results": [
    {
      "description": "opis co widać na zdjęciu",
      "confidence": 0.85,
      "isFeatureImage": true,
      "features": ["cecha1", "cecha2"]
    }
  ]
}`;

export async function POST(req: Request) {
  try {
    const { images } = (await req.json()) as { images: string[] };

    if (!images?.length) {
      return NextResponse.json({ error: 'Brak zdjęć do analizy' }, { status: 400 });
    }

    if (!OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OPENAI_API_KEY nie jest ustawiony' }, { status: 500 });
    }

    // Przetwarzaj w batchach po 5 zdjęć (limit kontekstu vision)
    const BATCH_SIZE = 5;
    const allResults: ImageAnalysisResult[] = [];

    console.log(`[image-analyze] Analyzing ${images.length} images with model ${VISION_MODEL}`);

    for (let i = 0; i < images.length; i += BATCH_SIZE) {
      const batch = images.slice(i, i + BATCH_SIZE);
      console.log(`[image-analyze] Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} images`);

      const userContent: Array<{ type: string; text?: string; image_url?: { url: string; detail: string } }> = [
        { type: 'text', text: `Przeanalizuj ${batch.length} zdjęć produktu. Zwróć wyniki w kolejności zdjęć.` },
      ];

      for (const url of batch) {
        userContent.push({
          type: 'image_url',
          image_url: { url, detail: 'low' },
        });
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: VISION_MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userContent },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 2000,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error(`[image-analyze] Vision API error (${response.status}):`, err);
        throw new Error(`Vision API error (${response.status}): ${err}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '{}';
      console.log(`[image-analyze] Raw response:`, content.slice(0, 500));
      const parsed = JSON.parse(content);
      const results = parsed.results || [];

      for (let j = 0; j < batch.length; j++) {
        const r = results[j] || {};
        allResults.push({
          url: batch[j],
          aiDescription: r.description || '',
          aiConfidence: typeof r.confidence === 'number' ? r.confidence : 0.5,
          isFeatureImage: r.isFeatureImage ?? false,
          features: Array.isArray(r.features) ? r.features : [],
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
