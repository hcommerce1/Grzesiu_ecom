import type { ScrapeResponse, ProductData } from './types';
import { getExtractorForUrl } from './scrapers/index';
import { convertAsinToEan } from './asin-to-ean';

// ─── Icon / Logo Filter ───

export function isIconOrLogo(url: string): boolean {
  const lower = url.toLowerCase();
  const pathOnly = lower.replace(/\?.*$/, '');

  // File extension checks
  if (pathOnly.endsWith('.ico') || pathOnly.endsWith('.svg')) return true;

  // Path patterns indicating icons/logos
  const iconPathPatterns = [
    '/favicon', '/logo', '/icon',
    '/assets/icons/', '/images/icons/', '/static/icons/',
    '/badge', '/sprite',
  ];
  if (iconPathPatterns.some(p => lower.includes(p))) return true;

  // Payment icons
  const paymentPatterns = [
    'visa', 'mastercard', 'paypal', 'przelewy24', 'blik', 'klarna',
    'stripe', 'amex', 'american-express', 'apple-pay', 'google-pay',
  ];
  if (paymentPatterns.some(p => lower.includes(p))) return true;

  // Trust badges
  const trustPatterns = ['trusted-shops', 'ssl-badge', 'security-badge', 'trust-badge', 'verified'];
  if (trustPatterns.some(p => lower.includes(p))) return true;

  // Social media icons
  const socialPatterns = ['facebook', 'twitter', 'instagram', 'pinterest', 'youtube', 'linkedin', 'tiktok'];
  if (socialPatterns.some(p => lower.includes(p))) return true;

  // Tiny dimensions in URL params
  const dimMatch = lower.match(/[?&](w|h|width|height|size)=(\d+)/);
  if (dimMatch && parseInt(dimMatch[2]) <= 50) return true;

  return false;
}

// ─── Configuration ───
const SCRAPER_MODE = process.env.SCRAPER_MODE || 'decodo';
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY || '';
const DECODO_API_USERNAME = process.env.DECODO_API_USERNAME || '';
const DECODO_API_PASSWORD = process.env.DECODO_API_PASSWORD || '';

// ─── Access-Denied Detection ───
const ACCESS_DENIED_PATTERNS = [
    '<title>access denied',
    'please verify you are a human',
    '<title>attention required',
    'automated access',
    'enable javascript and cookies',
    'to discuss automated access',
    'api-services-support@amazon',
    'solve the captcha',
    'nie jestes robotem',
    'potwierdz, ze nie jestes',
    'captcha-delivery.com',
    '403 forbidden',
    'too many requests',
    'zostales zablokowany',
    'sprobuj ponownie pozniej',
    'cos w zachowaniu twojej przegladarki',
];

function detectAccessDenied(html: string): boolean {
    const lower = html.toLowerCase();
    return ACCESS_DENIED_PATTERNS.some((p) => lower.includes(p));
}

// ─── Allegro-specific ban detection (with ended-offer exclusion) ───
function detectAllegroBan(html: string, targetStatusCode: number): boolean {
    if (targetStatusCode === 403 || targetStatusCode === 429 || targetStatusCode === 503) {
        return true;
    }
    if (!html) return targetStatusCode >= 400;
    const lower = html.substring(0, 2000).toLowerCase();
    if (lower.includes('ta oferta nie istnieje') || lower.includes('oferta zakonczona') || lower.includes('oferta się zakończyła')) {
        return false;
    }
    return detectAccessDenied(html);
}

// ─── URL Validation ───
function isValidUrl(url: string): boolean {
    try {
        const u = new URL(url);
        return ['http:', 'https:'].includes(u.protocol);
    } catch {
        return false;
    }
}

// ─── Amazon EAN enrichment (ASIN→EAN via Apify when EAN missing) ───
async function enrichAmazonEan(data: ProductData, url: string): Promise<void> {
    const hostname = new URL(url).hostname.toLowerCase();
    if (!hostname.includes('amazon.')) return;
    if (data.ean) return; // już mamy EAN

    const asin = data.sku || extractAsinFromUrl(url);
    if (!asin) return;

    const ean = await convertAsinToEan(asin);
    if (ean) data.ean = ean;
}

// ─── Main Scraper ───
export async function scrapeProduct(url: string): Promise<ScrapeResponse> {
    if (!isValidUrl(url)) {
        return { success: false, error: 'Invalid URL. Please provide a valid HTTP/HTTPS URL.', errorType: 'INVALID_URL' };
    }

    try {
        if (SCRAPER_MODE === 'decodo') {
            // Primary: Decodo
            if (DECODO_API_USERNAME && DECODO_API_PASSWORD) {
                console.log('[Scraper] Tryb DECODO Scraping API');
                const result = await scrapeWithDecodoAPI(url);
                if (result.success && result.data) {
                    await enrichAmazonEan(result.data, url);
                    return result;
                }
                console.warn('[Scraper] Decodo failed, próba ScrapingBee...');
            }
            // Fallback: ScrapingBee
            if (SCRAPINGBEE_API_KEY) {
                const result = await scrapeWithScrapingBeeRest(url);
                if (result.success && result.data) await enrichAmazonEan(result.data, url);
                return result;
            }
            const fbMsg135 = SCRAPINGBEE_API_KEY
                ? 'Decodo i ScrapingBee oba zwróciły fail — sprawdź URL, kredyty i statusy API'
                : 'Decodo nie zwrócił danych (URL nieistniejący / brak kredytów / blokada). Brak fallbacku ScrapingBee — klucz nieustawiony.';
            return { success: false, error: fbMsg135, errorType: 'UNKNOWN' };
        } else {
            // Primary: ScrapingBee
            if (SCRAPINGBEE_API_KEY) {
                console.log('[Scraper] Tryb ScrapingBee API');
                const result = await scrapeWithScrapingBeeRest(url);
                if (result.success && result.data) {
                    await enrichAmazonEan(result.data, url);
                    return result;
                }
                console.warn('[Scraper] ScrapingBee failed, próba Decodo...');
            }
            // Fallback: Decodo
            if (DECODO_API_USERNAME && DECODO_API_PASSWORD) {
                const result = await scrapeWithDecodoAPI(url);
                if (result.success && result.data) await enrichAmazonEan(result.data, url);
                return result;
            }
            const fbMsg153 = (DECODO_API_USERNAME && DECODO_API_PASSWORD)
                ? 'ScrapingBee i Decodo oba zwróciły fail — sprawdź URL, kredyty i statusy API'
                : 'ScrapingBee nie zwrócił danych. Brak fallbacku Decodo — klucze nieustawione.';
            return { success: false, error: fbMsg153, errorType: 'UNKNOWN' };
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error occurred';
        console.error('[Scraper] Error:', message);
        if (message.includes('timeout') || message.includes('Timeout')) {
            return { success: false, error: `Strona nie załadowała się w czasie. Szczegóły: ${message}`, errorType: 'TIMEOUT' };
        }
        return { success: false, error: message, errorType: 'UNKNOWN' };
    }
}

// ─── Decodo Web Scraping API Mode ───
const MIN_HTML_LENGTH = 500;

type DecodoInternalError =
    | 'allegro_ban' | 'empty_response' | 'decodo_rate_limit'
    | 'decodo_auth_failed' | 'decodo_no_funds' | 'decodo_timeout'
    | 'decodo_http_error' | 'decodo_parse_error';

const RETRYABLE_ERRORS = new Set<DecodoInternalError>([
    'allegro_ban', 'empty_response', 'decodo_rate_limit',
]);

type DecodoScrapeResponse = ScrapeResponse & { _internalError?: DecodoInternalError };

function buildDecodoRequestBody(url: string): Record<string, unknown> {
    const hostname = new URL(url).hostname.toLowerCase();

    // Amazon — dedykowany target z parsowaniem strukturalnym
    if (hostname.includes('amazon.')) {
        const asinMatch = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
        if (asinMatch) {
            // Wykryj domenę Amazon (np. amazon.pl → .pl, amazon.de → .de)
            const domainMatch = hostname.match(/amazon\.(\w+(?:\.\w+)?)/);
            const domain = domainMatch ? domainMatch[1] : 'com';
            return {
                target: 'amazon_product',
                query: asinMatch[1],
                parse: true,
                domain,
                autoselect_variant: true,
            };
        }
        // Fallback — Amazon URL bez ASIN → użyj amazon_url
        return {
            target: 'amazon_url',
            url,
            parse: true,
        };
    }

    // Allegro — dodatkowe browser actions do klikania galerii
    if (hostname.includes('allegro.pl')) {
        return {
            target: 'universal',
            url,
            headless: 'html',
            locale: 'pl-PL',
            geo: 'Poland',
            browser_actions: [
                { type: 'click', selector: { type: 'text', value: 'Pokaż wszystkie parametry' }, on_error: 'skip' },
                { type: 'click', selector: { type: 'css', value: '[data-box-name*="allery"] img:nth-child(2)' }, on_error: 'skip' },
                { type: 'click', selector: { type: 'css', value: '[data-box-name*="allery"] img:nth-child(3)' }, on_error: 'skip' },
                { type: 'click', selector: { type: 'css', value: '[data-box-name*="allery"] img:nth-child(4)' }, on_error: 'skip' },
                { type: 'click', selector: { type: 'css', value: '[data-box-name*="allery"] img:nth-child(5)' }, on_error: 'skip' },
                { type: 'wait', wait_time_s: 2 },
            ],
        };
    }

    // Inne strony — universal + browser actions
    return {
        target: 'universal',
        url,
        headless: 'html',
        locale: 'pl-PL',
        geo: 'Poland',
        browser_actions: [
            {
                type: 'click',
                selector: { type: 'text', value: 'Pokaż wszystkie parametry' },
                on_error: 'skip',
            },
            { type: 'wait', wait_time_s: 2 },
        ],
    };
}

async function scrapeDecodoSingleAttempt(url: string): Promise<DecodoScrapeResponse> {
    const credentials = Buffer.from(`${DECODO_API_USERNAME}:${DECODO_API_PASSWORD}`).toString('base64');
    const hostname = new URL(url).hostname.toLowerCase();
    const isAmazon = hostname.includes('amazon.');
    console.log(`[Scraper] Decodo API attempt: ${url} (target: ${isAmazon ? 'amazon_product' : 'universal'})`);

    try {
        const res = await fetch('https://scraper-api.decodo.com/v2/scrape', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Basic ${credentials}`,
            },
            body: JSON.stringify(buildDecodoRequestBody(url)),
            signal: AbortSignal.timeout(120000),
        });

        // Specific HTTP status handling
        if (res.status === 401) {
            console.error('[Scraper] Decodo API: błąd autoryzacji (401)');
            return { success: false, error: 'Decodo API: błąd autoryzacji (401)', errorType: 'UNKNOWN', _internalError: 'decodo_auth_failed' };
        }
        if (res.status === 402) {
            console.error('[Scraper] Decodo API: brak środków (402)');
            return { success: false, error: 'Decodo API: brak środków na koncie (402)', errorType: 'UNKNOWN', _internalError: 'decodo_no_funds' };
        }
        if (res.status === 429) {
            console.warn('[Scraper] Decodo API: rate limit (429)');
            return { success: false, error: 'Decodo API: rate limit (429)', errorType: 'UNKNOWN', _internalError: 'decodo_rate_limit' };
        }
        if (!res.ok) {
            const text = await res.text();
            console.error(`[Scraper] Decodo API HTTP ${res.status}: ${text.substring(0, 200)}`);
            return { success: false, error: `Decodo API error: HTTP ${res.status}`, errorType: 'UNKNOWN', _internalError: 'decodo_http_error' };
        }

        // Parse JSON response
        const rawText = await res.text();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let json: any;
        try {
            json = JSON.parse(rawText);
        } catch {
            return { success: false, error: 'Decodo API: nie udało się sparsować JSON', errorType: 'UNKNOWN', _internalError: 'decodo_parse_error' };
        }

        // Extract response data
        const results = json.results;
        const firstResult = Array.isArray(results) && results.length > 0 ? results[0] : json;
        const targetStatusCode: number = firstResult.status_code ?? 200;

        console.log(`[Scraper] Decodo API → keys: ${Object.keys(firstResult).join(', ')}`);

        // Amazon z parse:true — Decodo zwraca sparsowane dane w content.results lub content
        if (isAmazon) {
            // Decodo amazon_product: results[0].content.results lub results[0].content
            const contentObj = firstResult.content;
            const parsed = contentObj?.results ?? contentObj ?? firstResult.parsed;
            if (parsed && typeof parsed === 'object' && (parsed.title || parsed.product_name)) {
                console.log(`[Scraper] Decodo API → Amazon parsed data received`);
                const productData = extractAmazonFromParsed(parsed, url);
                console.log(`[Scraper] Decodo API OK (Amazon parsed): title="${productData.title}" | images=${productData.images?.length ?? 0} | attrs=${Object.keys(productData.attributes ?? {}).length}`);
                return { success: true, data: productData };
            }
            // Fallback: jeśli content jest stringiem HTML, parsuj przez DOM
            const htmlContent = typeof contentObj === 'string' ? contentObj : '';
            if (htmlContent.length >= MIN_HTML_LENGTH) {
                const productData = await extractFromHTML(htmlContent, url);
                console.log(`[Scraper] Decodo API OK (Amazon HTML fallback): title="${productData.title}"`);
                return { success: true, data: productData };
            }
            console.warn(`[Scraper] Decodo API: Amazon — brak sparsowanych danych i brak HTML`);
            return { success: false, error: 'Decodo API: brak danych produktu Amazon', errorType: 'UNKNOWN', _internalError: 'empty_response' };
        }

        // Inne strony — HTML mode
        const html: string = typeof firstResult.content === 'string' ? firstResult.content : (typeof json.content === 'string' ? json.content : (json.body ?? ''));
        console.log(`[Scraper] Decodo API → decodo=${res.status}, target=${targetStatusCode}, html=${html.length} bajtów`);

        // Empty response check
        if (html.length < MIN_HTML_LENGTH) {
            console.warn(`[Scraper] Decodo API: za mało danych (${html.length} znaków)`);
            return { success: false, error: `Decodo API zwróciło za mało danych (${html.length} znaków)`, errorType: 'UNKNOWN', _internalError: 'empty_response' };
        }

        // Ban detection — Allegro-specific or generic
        const isAllegro = url.includes('allegro.pl');
        const isBanned = isAllegro ? detectAllegroBan(html, targetStatusCode) : detectAccessDenied(html);
        if (isBanned) {
            console.warn(`[Scraper] Ban wykryty: target=${targetStatusCode}, html=${html.length}`);
            return { success: false, error: 'Access denied — Decodo API nie ominęło ochrony strony', errorType: 'ACCESS_DENIED', _internalError: 'allegro_ban' };
        }

        // Extract product data from HTML
        const productData = await extractFromHTML(html, url);
        console.log(`[Scraper] Decodo API OK: title="${productData.title}" | images=${productData.images?.length ?? 0} | attrs=${Object.keys(productData.attributes ?? {}).length}`);
        return { success: true, data: productData };
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown';
        const isTimeout = msg.includes('timeout') || msg.includes('abort');
        console.log(`[Scraper] Decodo API błąd: ${msg}`);
        return { success: false, error: `Decodo API: ${msg}`, errorType: isTimeout ? 'TIMEOUT' : 'UNKNOWN', _internalError: isTimeout ? 'decodo_timeout' : undefined };
    }
}

async function scrapeWithDecodoAPI(url: string): Promise<ScrapeResponse> {
    let result = await scrapeDecodoSingleAttempt(url);
    if (!result.success && result._internalError && RETRYABLE_ERRORS.has(result._internalError)) {
        console.log(`[Scraper] Decodo API retry za 2s (was: ${result._internalError})`);
        await new Promise(r => setTimeout(r, 2000));
        result = await scrapeDecodoSingleAttempt(url);
    }
    return result;
}

// ─── ScrapingBee REST API Mode ───
async function scrapeWithScrapingBeeRest(url: string): Promise<ScrapeResponse> {
    console.log(`[Scraper] ScrapingBee REST: ${url}`);
    try {
        const apiUrl = `https://app.scrapingbee.com/api/v1/?api_key=${SCRAPINGBEE_API_KEY}&url=${encodeURIComponent(url)}&render_js=true&premium_proxy=true&country_code=pl`;
        const res = await fetch(apiUrl, { signal: AbortSignal.timeout(90000) });
        if (!res.ok) {
            return { success: false, error: `ScrapingBee HTTP ${res.status}`, errorType: 'UNKNOWN' };
        }
        const html = await res.text();
        if (html.length < MIN_HTML_LENGTH) {
            return { success: false, error: `ScrapingBee: za mało danych (${html.length} znaków)`, errorType: 'UNKNOWN' };
        }
        const isAllegro = url.includes('allegro.pl');
        const isBanned = isAllegro ? detectAllegroBan(html, 200) : detectAccessDenied(html);
        if (isBanned) {
            return { success: false, error: 'ScrapingBee: Access denied — strona wykryła automatyczny dostęp', errorType: 'ACCESS_DENIED' };
        }
        const productData = await extractFromHTML(html, url);
        console.log(`[Scraper] ScrapingBee OK: title="${productData.title}" | images=${productData.images?.length ?? 0}`);
        return { success: true, data: productData };
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown';
        const isTimeout = msg.includes('timeout') || msg.includes('abort');
        return { success: false, error: `ScrapingBee: ${msg}`, errorType: isTimeout ? 'TIMEOUT' : 'UNKNOWN' };
    }
}

// ─── Extract Amazon product data from Decodo parsed JSON ───
// Decodo amazon_product zwraca dane w content.results z polami:
// title, product_name, images (string[]), description, bullet_points (string[]),
// product_details (Record<string,string>), price, currency, asin, brand, itd.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractAmazonFromParsed(parsed: any, url: string): ProductData {
    const title: string = parsed.title ?? parsed.product_name ?? '';

    // Images — Decodo zwraca tablicę URL-i
    const images: string[] = [];
    if (Array.isArray(parsed.images)) {
        for (const img of parsed.images) {
            if (typeof img === 'string') images.push(img);
            else if (img?.url) images.push(img.url);
        }
    }

    // Description — bullet_points + description
    const descParts: string[] = [];
    if (Array.isArray(parsed.bullet_points) && parsed.bullet_points.length > 0) {
        descParts.push('Key Features:\n' + parsed.bullet_points.map((b: string) => '• ' + b).join('\n'));
    }
    if (parsed.description) descParts.push(parsed.description);

    // Attributes — product_details (dict) + product_overview
    const attributes: Record<string, string> = {};
    if (parsed.product_details && typeof parsed.product_details === 'object') {
        for (const [k, v] of Object.entries(parsed.product_details)) {
            if (typeof v === 'string' && k !== 'asin') attributes[k] = v;
            else if (v != null && k !== 'asin') attributes[k] = String(v);
        }
    }
    if (parsed.product_overview && typeof parsed.product_overview === 'object') {
        for (const [k, v] of Object.entries(parsed.product_overview)) {
            if (typeof v === 'string') attributes[k] = v;
        }
    }
    if (parsed.brand) attributes['Marka'] = parsed.brand;
    if (parsed.manufacturer) attributes['Producent'] = parsed.manufacturer;

    // Price
    const price: string = parsed.price != null ? String(parsed.price) : '';
    const currency: string = parsed.currency ?? '';

    // EAN/UPC — from product_details or direct field
    let ean = '';
    // Decodo tłumaczy nazwy pól na język strony, szukamy po wielu wariantach
    if (parsed.product_details) {
        for (const [k, v] of Object.entries(parsed.product_details)) {
            const kl = k.toLowerCase();
            if (kl.includes('ean') || kl.includes('gtin') || kl === 'upc') {
                ean = String(v).trim();
                delete attributes[k];
                break;
            }
        }
    }
    if (!ean) {
        for (const key of ['EAN', 'ean', 'GTIN', 'gtin13', 'upc', 'UPC']) {
            if (attributes[key]) { ean = attributes[key]; delete attributes[key]; break; }
        }
    }

    // ASIN as SKU
    const asin = parsed.asin ?? extractAsinFromUrl(url) ?? '';

    return {
        title, images: images.slice(0, 30), description: descParts.join('\n\n'),
        attributes, price, currency, ean, sku: asin, url,
    };
}

// ─── Extract ASIN from Amazon URL ───
function extractAsinFromUrl(url: string): string {
    const match = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    return match?.[1] ?? '';
}

// ─── JSDOM Page Shim — pozwala istniejącym parserom Playwright działać na JSDOM ───
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createJSDOMPageShim(dom: any): any {
    const { document } = dom.window;

    // Polyfill innerText — JSDOM nie implementuje innerText
    if (!('innerText' in dom.window.HTMLElement.prototype)) {
        Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
            get() { return this.textContent; },
            configurable: true,
        });
    }

    return {
        evaluate: async (fn: Function, args?: unknown) => {
            const g = globalThis as Record<string, unknown>;
            const saved = { document: g.document, window: g.window, Node: g.Node };
            g.document = document;
            g.window = dom.window;
            g.Node = dom.window.Node;
            try {
                return await fn(args);
            } finally {
                for (const key of ['document', 'window', 'Node'] as const) {
                    if (saved[key] !== undefined) g[key] = saved[key];
                    else delete g[key];
                }
            }
        },
        content: async () => dom.serialize(),
    };
}

// ─── Extract product data from raw HTML using JSDOM + istniejące parsery ───
async function extractFromHTML(html: string, url: string): Promise<ProductData> {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM(html, { url });
    const hostname = new URL(url).hostname.toLowerCase();

    // Allegro — specjalny ekstraktor (parsuje dataLayer z inline scripts)
    if (hostname.includes('allegro.pl')) {
        return extractAllegroFromDOM(dom.window.document, url, dom.window);
    }

    // Wszystkie inne strony — JSDOM shim + istniejące parsery z scrapers/
    const shimPage = createJSDOMPageShim(dom);
    const extractor = getExtractorForUrl(url);
    return extractor(shimPage, url);
}

// ─── Allegro DOM extractor (specjalny — parsuje dataLayer z inline scripts) ───
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractAllegroFromDOM(document: Document, url: string, window: any): ProductData {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let dl: Record<string, any> = {};
    const scripts = document.querySelectorAll('script:not([src])');
    for (const script of Array.from(scripts)) {
        const text = (script as any).textContent || '';
        const match = text.match(/dataLayer\s*=\s*\[(\{[\s\S]*?\})\]/);
        if (match) {
            try { dl = JSON.parse(match[1]); } catch { /* ignore */ }
            break;
        }
    }

    const title: string = dl.offerName ??
        document.querySelector('meta[property="og:title"]')?.getAttribute('content') ??
        document.querySelector('h1')?.textContent?.trim() ?? '';
    const price: string = dl.price != null ? String(dl.price) : '';
    const currency: string = dl.currency ?? 'PLN';
    const sku: string = dl.idItem ?? '';

    // Priorytet: JSON galerii z React hydration data
    // Format: "original":"https:\u002F\u002Fa.allegroimg.com\u002Foriginal\u002F..."
    const galleryImages: string[] = [];
    for (const script of Array.from(scripts)) {
        const text = (script as any).textContent || '';
        const imgMatches = text.matchAll(/"original"\s*:\s*"(https?:[^"]*allegroimg\.com[^"]*)"/gi);
        for (const m of imgMatches) {
            let imgUrl = m[1];
            imgUrl = imgUrl.replace(/\\u002F/g, '/');
            if (imgUrl && imgUrl.includes('/original/') && !galleryImages.includes(imgUrl)) {
                galleryImages.push(imgUrl);
            }
        }
    }

    let images: string[];
    if (galleryImages.length > 0) {
        images = galleryImages.slice(0, 30);
    } else {
        // Fallback: zbierz z DOM
        const imgSet = new Set<string>();
        const ogImg = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
        if (ogImg) imgSet.add(ogImg);
        document.querySelectorAll('link[rel="preload"][as="image"]').forEach((l: any) => {
            const href = l.href || l.getAttribute('href') || '';
            if (href.includes('allegroimg.com')) imgSet.add(href);
        });
        document.querySelectorAll('img[src*="allegroimg.com"]').forEach((img: any) => {
            const src = img.src || img.getAttribute('src') || img.dataset?.src || '';
            if (src && !src.includes('1x1') && !src.includes('sprite')) imgSet.add(src);
        });
        // Filtruj UI elementy i deduplikuj
        const uiPatterns = [
            'action-common-', 'action-', 'illustration-', 'information-',
            'brand-subbrand-', 'thank-you-page-', 'dark-illustration-',
            'question-', 'star-full', 'star-empty', 'star-half',
            'round-tick', 'badge-check', 'arrowhead-', 'heart-',
            'share-', 'weighing-scale', 'flame-', 'low-price-',
            'company-', 'smart-',
        ];
        const filtered = Array.from(imgSet).filter(u => {
            const lower = u.toLowerCase();
            if (!lower.includes('allegroimg.com')) return false;
            const sizeMatch = lower.match(/\/s(\d+)\//);
            if (sizeMatch && parseInt(sizeMatch[1]) < 150) return false;
            if (uiPatterns.some(p => lower.includes(p))) return false;
            if (lower.includes('/user/') || lower.includes('/avatar')) return false;
            if (lower.includes('/logo') || lower.includes('/banner/')) return false;
            const pathOnly = lower.split('?')[0];
            if (pathOnly.endsWith('.svg') || pathOnly.endsWith('.ico')) return false;
            return true;
        });
        const byBase = new Map<string, string>();
        for (const u of filtered) {
            const base = u.replace(/\/(original|s\d+)\//, '/SIZE/');
            const existing = byBase.get(base);
            if (!existing) { byBase.set(base, u); }
            else if (u.includes('/original/')) { byBase.set(base, u); }
            else if (!existing.includes('/original/')) {
                const es = parseInt(existing.match(/\/s(\d+)\//)?.[1] || '0');
                const ns = parseInt(u.match(/\/s(\d+)\//)?.[1] || '0');
                if (ns > es) byBase.set(base, u);
            }
        }
        images = Array.from(byBase.values()).slice(0, 30);
    }

    const descEl = document.querySelector('[data-box-name="Description"]') ?? document.querySelector('[data-box-name*="escription"]');
    const description: string = (descEl as any)?.textContent?.trim() ?? document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';

    const attributes: Record<string, string> = {};
    const paramsBox = document.querySelector('[data-box-name="Parameters"]') ?? document.querySelector('[data-box-name*="aram"]');
    if (paramsBox) {
        paramsBox.querySelectorAll('li, tr').forEach((row: any) => {
            const cells = row.querySelectorAll('span, td, dt, dd');
            if (cells.length >= 2) {
                const k = cells[0].textContent?.trim() ?? '';
                const v = cells[1].textContent?.trim() ?? '';
                if (k && v && k !== v && k.length < 100 && v.length < 500) attributes[k] = v;
            }
        });
    }
    if (Object.keys(attributes).length === 0) {
        document.querySelectorAll('table tr').forEach((row: any) => {
            const tds = row.querySelectorAll('td');
            if (tds.length >= 2) {
                const k = tds[0].textContent?.trim() ?? '';
                const valueTd = tds[1];
                const firstDiv = valueTd.querySelector('div');
                let v = '';
                if (firstDiv) v = firstDiv.childNodes[0]?.textContent?.trim() ?? firstDiv.textContent?.trim() ?? '';
                else v = valueTd.childNodes[0]?.textContent?.trim() ?? valueTd.textContent?.trim() ?? '';
                if (k && v && k !== v && k.length < 100 && v.length < 500 && !k.includes('{') && !v.includes('{')) attributes[k] = v;
            }
        });
    }

    const bodyText = document.body?.textContent ?? '';
    const eanMatch = bodyText.match(/EAN[:\s]*(\d{8,13})/i);
    const ean: string = eanMatch?.[1] ?? '';

    return { title, price, currency, sku, images, description, attributes, ean, url };
}

// ─── fetchPageHtml — pobiera surowy HTML strony ───
export async function fetchPageHtml(url: string): Promise<string> {
    const mode = SCRAPER_MODE;
    const hasDecodo = !!(DECODO_API_USERNAME && DECODO_API_PASSWORD);
    const hasSBee = !!SCRAPINGBEE_API_KEY;

    const tryDecodo = async (): Promise<string> => {
        const credentials = Buffer.from(`${DECODO_API_USERNAME}:${DECODO_API_PASSWORD}`).toString('base64');
        const body = { target: 'universal', url, headless: 'html', locale: 'pl-PL', geo: 'Poland' };
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
        const html = typeof first.content === 'string' ? first.content : (typeof json.content === 'string' ? json.content : (json.body ?? ''));
        if (html.length > 100) return html;
        throw new Error(`Decodo: za mało HTML (${html.length} znaków)`);
    };

    const tryScrapingBee = async (): Promise<string> => {
        const apiUrl = `https://app.scrapingbee.com/api/v1/?api_key=${SCRAPINGBEE_API_KEY}&url=${encodeURIComponent(url)}&render_js=true&premium_proxy=true&country_code=pl`;
        const res = await fetch(apiUrl, { signal: AbortSignal.timeout(60000) });
        if (!res.ok) throw new Error(`ScrapingBee HTTP ${res.status}`);
        return await res.text();
    };

    if (mode === 'decodo') {
        if (hasDecodo) {
            try { return await tryDecodo(); } catch (err) { console.warn('[fetchPageHtml] Decodo error:', err instanceof Error ? err.message : err); }
        }
        if (hasSBee) {
            try { return await tryScrapingBee(); } catch (err) { console.warn('[fetchPageHtml] ScrapingBee error:', err instanceof Error ? err.message : err); }
        }
    } else {
        if (hasSBee) {
            try { return await tryScrapingBee(); } catch (err) { console.warn('[fetchPageHtml] ScrapingBee error:', err instanceof Error ? err.message : err); }
        }
        if (hasDecodo) {
            try { return await tryDecodo(); } catch (err) { console.warn('[fetchPageHtml] Decodo error:', err instanceof Error ? err.message : err); }
        }
    }

    throw new Error(`fetchPageHtml: brak działającego scrapera dla ${url}`);
}
