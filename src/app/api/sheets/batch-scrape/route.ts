import { NextRequest, NextResponse } from 'next/server';
import { getProductById, setProductStatus } from '@/lib/db';

export const maxDuration = 10;
export const dynamic = 'force-dynamic';

// POST /api/sheets/batch-scrape
// Triggers background scraping for a list of product IDs.
// Each product is scraped sequentially by calling /api/sheets/products/[id]/scrape
// on the same server (fire-and-forget per product).
export async function POST(req: NextRequest) {
  try {
    const { ids } = await req.json() as { ids: (string | number)[] };

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'Brak listy ids' }, { status: 400 });
    }

    const origin = req.nextUrl.origin;

    // Filter to only products that have scrape_url and are not already scraped/scraping
    const toScrape = ids
      .map(id => ({ id: String(id), product: getProductById(String(id)) }))
      .filter(({ product }) =>
        product?.scrape_url &&
        product.status !== 'scraping' &&
        product.status !== 'done' &&
        product.status !== 'in_progress'
      );

    // Mark all as queued
    toScrape.forEach(({ id }) => setProductStatus(id, 'queued', {}));

    // Fire scraping in background — don't await
    (async () => {
      for (const { id } of toScrape) {
        try {
          await fetch(`${origin}/api/sheets/products/${encodeURIComponent(id)}/scrape`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
        } catch (e) {
          console.error(`[batch-scrape] Error scraping product ${id}:`, e);
        }
        // Brief pause between products to avoid hammering external APIs
        await new Promise(r => setTimeout(r, 600));
      }
    })();

    return NextResponse.json({ queued: toScrape.length, ids: toScrape.map(t => t.id) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Błąd batch scraping';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
