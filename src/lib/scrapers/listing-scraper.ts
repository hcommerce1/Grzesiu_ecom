import type { ListingProduct, ListingPageResult } from '../types';

const DECODO_API_USERNAME = process.env.DECODO_API_USERNAME || '';
const DECODO_API_PASSWORD = process.env.DECODO_API_PASSWORD || '';

// ─── Playwright — otwiera stronę sprzedawcy, wykonuje JS jak F12 konsola ───
async function scrapeViaPlaywright(pageUrl: string): Promise<ListingPageResult> {
  console.log(`[ListingScraper] Playwright: ${pageUrl}`);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { chromium } = require('playwright-extra');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const stealth = require('puppeteer-extra-plugin-stealth')();
  chromium.use(stealth);

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'pl-PL',
      extraHTTPHeaders: { 'Accept-Language': 'pl-PL,pl;q=0.9' },
    });
    const page = await context.newPage();

    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Scroll powoli żeby załadować lazy-loaded produkty
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let totalHeight = 0;
        const distance = 400;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= document.body.scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 150);
        setTimeout(() => { clearInterval(timer); resolve(); }, 6000);
      });
    });

    await page.waitForTimeout(1500);

    // Debug: sprawdź co jest na stronie
    const pageTitle = await page.title();
    const allLinksCount = await page.evaluate(() => document.querySelectorAll('a[href]').length);
    const ofertaLinksCount = await page.evaluate(() => document.querySelectorAll('a[href*="/oferta/"]').length);
    const pageUrl2 = page.url();
    console.log(`[ListingScraper] title="${pageTitle}" url="${pageUrl2}" allLinks=${allLinksCount} ofertaLinks=${ofertaLinksCount}`);

    // F12 konsola — wyciągamy produkty z wyrenderowanego DOM
    const result = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/oferta/"]')) as HTMLAnchorElement[];
      const seen = new Set<string>();
      const products: { url: string; title: string; price?: string; img?: string; externalId?: string }[] = [];

      for (const a of links) {
        const href = a.href;
        if (!href || seen.has(href) || href.includes('#')) continue;
        seen.add(href);

        const card = a.closest('article') || a.closest('[class*="card"]') || a.closest('[class*="item"]') || a.closest('li') || a.parentElement;
        const titleEl = a.querySelector('h1,h2,h3,h4') || card?.querySelector('[class*="title"],[class*="name"]');
        const title = titleEl?.textContent?.trim()
          || a.getAttribute('aria-label')
          || a.getAttribute('title')
          || a.textContent?.trim().replace(/\s+/g, ' ')
          || '';
        if (!title || title.length < 3) continue;

        const imgEl = a.querySelector('img') || card?.querySelector('img');
        let img = imgEl?.getAttribute('data-src') || imgEl?.getAttribute('data-lazy-src') || imgEl?.getAttribute('src') || '';
        if (img && (img.includes('icon') || img.includes('logo') || img.endsWith('.svg'))) img = '';

        const priceEl = card?.querySelector('[class*="price"],[data-testid*="price"]');
        const price = priceEl?.textContent?.trim().replace(/\s+/g, ' ');

        const idMatch = href.match(/\/oferta\/.*-(\d+?)(?:[/?#]|$)/);

        products.push({ url: href, title, price: price || undefined, img: img || undefined, externalId: idMatch?.[1] });
        if (products.length >= 60) break;
      }

      // Wykrywanie stron
      let maxPage = 1;
      document.querySelectorAll('a[href]').forEach((a) => {
        const m = (a as HTMLAnchorElement).href.match(/[?&]p=(\d+)/);
        if (m) { const n = parseInt(m[1]); if (n > maxPage) maxPage = n; }
      });

      return { products, totalPages: maxPage };
    });

    console.log(`[ListingScraper] Playwright extracted ${result.products.length} products, totalPages=${result.totalPages}`);

    const products: ListingProduct[] = result.products.map(p => ({
      url: p.url,
      externalId: p.externalId,
      title: p.title,
      thumbnailUrl: p.img || undefined,
      price: p.price || undefined,
      currency: 'PLN',
    }));

    const urlObj = new URL(pageUrl);
    const currentPage = parseInt(urlObj.searchParams.get('p') ?? '1', 10) || 1;

    return { products, currentPage, totalPages: result.totalPages ?? 1 };

  } finally {
    await browser.close();
  }
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
  return scrapeViaPlaywright(pageUrl);
}
