import { NextRequest, NextResponse } from 'next/server';
import { getSellerSession, getListings, updateDeepScrape } from '@/lib/db';
import { scrapeProduct } from '@/lib/scraper';

export async function POST(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  try {
    const session = getSellerSession(sessionId);
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    const { listingId } = await req.json();
    if (!listingId || typeof listingId !== 'string') {
      return NextResponse.json({ error: 'listingId required' }, { status: 400 });
    }

    // Get listing
    const listings = getListings(sessionId);
    const listing = listings.find(l => l.id === listingId);
    if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });

    // Scrape
    const result = await scrapeProduct(listing.productUrl);

    if (result.success) {
      updateDeepScrape(listingId, { data: result.data });
      return NextResponse.json({ success: true, data: result.data });
    } else {
      updateDeepScrape(listingId, { error: result.error });
      return NextResponse.json({ success: false, error: result.error });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
