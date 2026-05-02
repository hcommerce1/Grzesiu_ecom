import { NextRequest, NextResponse } from 'next/server';
import { convertAsinToEan } from '@/lib/asin-to-ean';

export const maxDuration = 180;
export const dynamic = 'force-dynamic';

const DECODO_API_USERNAME = process.env.DECODO_API_USERNAME || '';
const DECODO_API_PASSWORD = process.env.DECODO_API_PASSWORD || '';

async function findAsinForSku(sku: string): Promise<string | null> {
  if (!DECODO_API_USERNAME || !DECODO_API_PASSWORD) return null;

  const credentials = Buffer.from(`${DECODO_API_USERNAME}:${DECODO_API_PASSWORD}`).toString('base64');

  // Scrape Amazon search results for the SKU
  const res = await fetch('https://scraper-api.decodo.com/v2/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${credentials}`,
    },
    body: JSON.stringify({
      target: 'amazon_search',
      query: sku,
      parse: true,
      domain: 'pl',
      count: 5,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) return null;

  const json = await res.json();
  // Decodo amazon_search returns parsed results with ASIN in URL
  const results = json?.results?.[0]?.content?.results?.organic ?? [];

  for (const item of results) {
    // Extract ASIN from URL or directly from result
    const asin = item.asin || item.product_id;
    if (asin && /^[A-Z0-9]{10}$/.test(asin)) {
      return asin;
    }
    // Try to extract from URL
    const url = item.url || item.link || '';
    const match = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    if (match) return match[1];
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { sku } = await req.json() as { sku: string };

    if (!sku?.trim()) {
      return NextResponse.json({ error: 'Brak SKU' }, { status: 400 });
    }

    const cleanSku = sku.trim();

    // Step 1: Find ASIN on Amazon
    const asin = await findAsinForSku(cleanSku);
    if (!asin) {
      return NextResponse.json({
        error: 'Nie znaleziono produktu na Amazon dla podanego SKU',
        ean: null,
        asin: null,
      });
    }

    // Step 2: ASIN → EAN via Apify
    const ean = await convertAsinToEan(asin);
    if (!ean) {
      return NextResponse.json({
        error: `Znaleziono ASIN ${asin} ale nie udało się pobrać EAN`,
        ean: null,
        asin,
      });
    }

    return NextResponse.json({ ean, asin });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Błąd lookup';
    return NextResponse.json({ error: msg, ean: null, asin: null }, { status: 500 });
  }
}
