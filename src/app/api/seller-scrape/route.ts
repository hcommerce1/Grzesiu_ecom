import { NextRequest, NextResponse } from 'next/server';
import {
  createSellerSession, getAllSellerSessions, getListings,
  insertListings, updateSellerSession,
} from '@/lib/db';
import { scrapeListingPage } from '@/lib/scrapers/listing-scraper';

export async function GET() {
  const sessions = getAllSellerSessions();
  return NextResponse.json({ sessions });
}

export async function POST(req: NextRequest) {
  try {
    const { sellerUrl } = await req.json();
    if (!sellerUrl || typeof sellerUrl !== 'string') {
      return NextResponse.json({ error: 'sellerUrl is required' }, { status: 400 });
    }

    let parsed: URL;
    try {
      parsed = new URL(sellerUrl);
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    }

    const hostname = parsed.hostname.toLowerCase();
    const pathParts = parsed.pathname.split('/').filter(Boolean);

    // Extract username from URL (e.g. /uzytkownik/username or /seller/username)
    let username = '';
    const userSegmentIdx = pathParts.findIndex(p =>
      ['uzytkownik', 'seller', 'user', 'sklep', 'shop'].includes(p.toLowerCase())
    );
    if (userSegmentIdx !== -1 && pathParts[userSegmentIdx + 1]) {
      username = pathParts[userSegmentIdx + 1];
    } else {
      // Fallback: last path segment
      username = pathParts[pathParts.length - 1] ?? 'unknown';
    }

    const queryFilter = parsed.searchParams.get('string') ?? parsed.searchParams.get('q') ?? undefined;

    const sessionId = createSellerSession({
      sellerUrl,
      sellerUsername: username,
      siteHostname: hostname,
      queryFilter,
    });

    updateSellerSession(sessionId, { status: 'scraping' });

    // Scrape page 1
    const result = await scrapeListingPage(sellerUrl, 1);

    if (result.products.length > 0) {
      insertListings(sessionId, result.products, 1);
    }

    updateSellerSession(sessionId, {
      status: result.totalPages > 0 ? 'scraping' : 'done',
      totalPages: result.totalPages,
      scrapedPages: 1,
      totalProducts: result.products.length,
    });

    // Fetch updated session
    const listings = getListings(sessionId);

    return NextResponse.json({
      sessionId,
      session: {
        id: sessionId,
        sellerUrl,
        sellerUsername: username,
        siteHostname: hostname,
        totalPages: result.totalPages,
        scrapedPages: 1,
        totalProducts: result.products.length,
        status: result.totalPages > 1 ? 'scraping' : 'done',
      },
      listings,
      totalPages: result.totalPages,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
