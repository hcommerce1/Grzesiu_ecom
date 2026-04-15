import { NextRequest, NextResponse } from 'next/server';
import { getSellerSession, insertListings, updateSellerSession } from '@/lib/db';
import { scrapeListingPage } from '@/lib/scrapers/listing-scraper';

export async function POST(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  try {
    const session = getSellerSession(sessionId);
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    const { page } = await req.json();
    if (!page || typeof page !== 'number') {
      return NextResponse.json({ error: 'page number required' }, { status: 400 });
    }

    const result = await scrapeListingPage(session.sellerUrl, page);

    if (result.products.length > 0) {
      insertListings(sessionId, result.products, page);
    }

    const hasMore = page < result.totalPages;
    updateSellerSession(sessionId, {
      scrapedPages: Math.max(session.scrapedPages, page),
      totalProducts: session.totalProducts + result.products.length,
      totalPages: result.totalPages > 0 ? result.totalPages : session.totalPages,
      status: hasMore ? 'scraping' : 'done',
    });

    return NextResponse.json({ products: result.products, hasMore, totalPages: result.totalPages });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
