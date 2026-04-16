import type { ListingProduct, ListingPageResult } from '../types';

const SCRAPER_MODE = process.env.SCRAPER_MODE || 'decodo';
const DECODO_API_USERNAME = process.env.DECODO_API_USERNAME || '';
const DECODO_API_PASSWORD = process.env.DECODO_API_PASSWORD || '';
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY || '';

// ─── Decodo — pobiera HTML strony listingów ───
async function fetchViaDecodo(pageUrl: string): Promise<string> {
  const credentials = Buffer.from(`${DECODO_API_USERNAME}:${DECODO_API_PASSWORD}`).toString('base64');
  const body = {
    target: 'universal',
    url: pageUrl,
    headless: 'html',
    locale: 'pl-PL',
    geo: 'Poland',
  };
  console.log(`[ListingScraper] Decodo request: ${pageUrl}`);
  const res = await fetch('https://scraper-api.decodo.com/v2/scrape', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${credentials}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Decodo HTTP ${res.status}`);
  const json = await res.json();
  const results = json.results;
  const first = Array.isArray(results) && results.length > 0 ? results[0] : json;
  const html: string = typeof first.content === 'string' ? first.content
    : typeof json.content === 'string' ? json.content
    : (json.body ?? '');
  if (html.length < 100) throw new Error(`Decodo: za mało HTML (${html.length} znaków)`);
  return html;
}

// ─── ScrapingBee REST API — pobiera HTML strony listingów ───
async function fetchViaScrapingBee(pageUrl: string): Promise<string> {
  const apiUrl = `https://app.scrapingbee.com/api/v1/?api_key=${SCRAPINGBEE_API_KEY}&url=${encodeURIComponent(pageUrl)}&render_js=true&premium_proxy=true&country_code=pl`;
  console.log(`[ListingScraper] ScrapingBee request: ${pageUrl}`);
  const res = await fetch(apiUrl, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`ScrapingBee HTTP ${res.status}`);
  const html = await res.text();
  if (html.length < 100) throw new Error(`ScrapingBee: za mało HTML (${html.length} znaków)`);
  return html;
}

// ─── Ekstrakcja produktów z HTML przez JSDOM ───
function extractListingsFromHTML(html: string, baseUrl: string, currentPage: number): ListingPageResult {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(html, { url: baseUrl });
  const document: Document = dom.window.document;

  const links = Array.from(document.querySelectorAll('a[href*="/oferta/"]')) as HTMLAnchorElement[];
  const seen = new Set<string>();
  const products: ListingProduct[] = [];

  for (const a of links) {
    const href = a.getAttribute('href') || '';
    if (!href || seen.has(href) || href.includes('#')) continue;
    const fullUrl = href.startsWith('http') ? href : new URL(href, baseUrl).toString();
    seen.add(href);

    const card = a.closest('article')
      || a.closest('[class*="card"]')
      || a.closest('[class*="item"]')
      || a.closest('li')
      || a.parentElement;

    const titleEl = a.querySelector('h1,h2,h3,h4')
      || card?.querySelector('[class*="title"],[class*="name"]');
    const title = titleEl?.textContent?.trim()
      || a.getAttribute('aria-label')
      || a.getAttribute('title')
      || a.textContent?.trim().replace(/\s+/g, ' ')
      || '';
    if (!title || title.length < 3) continue;

    const imgEl = (a.querySelector('img') || card?.querySelector('img')) as HTMLImageElement | null;
    let img = imgEl?.getAttribute('data-src') || imgEl?.getAttribute('data-lazy-src') || imgEl?.getAttribute('src') || '';
    if (img && (img.includes('icon') || img.includes('logo') || img.endsWith('.svg'))) img = '';

    const priceEl = card?.querySelector('[class*="price"],[data-testid*="price"]');
    const price = priceEl?.textContent?.trim().replace(/\s+/g, ' ');

    const idMatch = fullUrl.match(/\/oferta\/.*-(\d+?)(?:[/?#]|$)/);

    products.push({
      url: fullUrl,
      title,
      price: price || undefined,
      thumbnailUrl: img || undefined,
      externalId: idMatch?.[1],
      currency: 'PLN',
    });
    if (products.length >= 60) break;
  }

  // Wykrywanie stron
  let maxPage = 1;
  document.querySelectorAll('a[href]').forEach((a) => {
    const href = (a as HTMLAnchorElement).getAttribute('href') || '';
    const m = href.match(/[?&]p=(\d+)/);
    if (m) { const n = parseInt(m[1]); if (n > maxPage) maxPage = n; }
  });

  console.log(`[ListingScraper] Extracted ${products.length} products, totalPages=${maxPage}`);
  return { products, currentPage, totalPages: maxPage };
}

function buildListingUrl(baseUrl: string, page: number): string {
  const u = new URL(baseUrl);
  if (page > 1) {
    u.searchParams.set('p', String(page));
  } else {
    u.searchParams.delete('p');
  }
  return u.toString();
}

// ─── Public API ───
export async function scrapeListingPage(sellerUrl: string, page: number): Promise<ListingPageResult> {
  const pageUrl = buildListingUrl(sellerUrl, page);
  console.log(`[ListingScraper] Scraping page ${page}: ${pageUrl}`);

  const mode = SCRAPER_MODE;
  const hasDecodo = !!(DECODO_API_USERNAME && DECODO_API_PASSWORD);
  const hasSBee = !!SCRAPINGBEE_API_KEY;

  let html = '';

  if (mode === 'decodo') {
    if (hasDecodo) {
      try {
        html = await fetchViaDecodo(pageUrl);
        console.log(`[ListingScraper] Decodo OK, ${html.length} znaków`);
      } catch (err) {
        console.warn(`[ListingScraper] Decodo failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (!html && hasSBee) {
      try {
        html = await fetchViaScrapingBee(pageUrl);
        console.log(`[ListingScraper] ScrapingBee fallback OK, ${html.length} znaków`);
      } catch (err) {
        console.warn(`[ListingScraper] ScrapingBee failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  } else {
    if (hasSBee) {
      try {
        html = await fetchViaScrapingBee(pageUrl);
        console.log(`[ListingScraper] ScrapingBee OK, ${html.length} znaków`);
      } catch (err) {
        console.warn(`[ListingScraper] ScrapingBee failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (!html && hasDecodo) {
      try {
        html = await fetchViaDecodo(pageUrl);
        console.log(`[ListingScraper] Decodo fallback OK, ${html.length} znaków`);
      } catch (err) {
        console.warn(`[ListingScraper] Decodo failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  if (!html) {
    throw new Error(`Nie udało się pobrać strony listingów (brak credentials lub błąd API): ${pageUrl}`);
  }

  return extractListingsFromHTML(html, pageUrl, page);
}
