import type { ProductData, ScrapeResponse } from './types';
import { getExtractorForUrl } from './scrapers/index';

// ─── Configuration ───
const SCRAPER_MODE = process.env.SCRAPER_MODE || 'playwright';
const UNBLOCKER_API_KEY = process.env.UNBLOCKER_API_KEY || '';
const UNBLOCKER_API_URL = process.env.UNBLOCKER_API_URL || 'https://api.scrapingbee.com/api/v1/';
const NAVIGATION_TIMEOUT = 30000;
const SELECTOR_TIMEOUT = 10000;

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
];

function detectAccessDenied(html: string): boolean {
    const lower = html.toLowerCase();
    return ACCESS_DENIED_PATTERNS.some((p) => lower.includes(p));
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

// ─── Main Scraper ───
export async function scrapeProduct(url: string): Promise<ScrapeResponse> {
    if (!isValidUrl(url)) {
        return { success: false, error: 'Invalid URL. Please provide a valid HTTP/HTTPS URL.', errorType: 'INVALID_URL' };
    }

    try {
        if (SCRAPER_MODE === 'unblocker' && UNBLOCKER_API_KEY) {
            return await scrapeWithUnblocker(url);
        }
        return await scrapeWithPlaywright(url);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error occurred';
        if (message.includes('timeout') || message.includes('Timeout')) {
            return { success: false, error: 'The page took too long to load. Try again or use a different URL.', errorType: 'TIMEOUT' };
        }
        return { success: false, error: message, errorType: 'UNKNOWN' };
    }
}

// ─── Playwright Mode (with manual stealth) ───
async function scrapeWithPlaywright(url: string): Promise<ScrapeResponse> {
    const { chromium } = require('playwright-extra');
    const stealth = require('puppeteer-extra-plugin-stealth')();

    chromium.use(stealth);

    const browser = await chromium.launch({
        headless: true
    });

    try {
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();

        // Navigate with timeout
        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: NAVIGATION_TIMEOUT,
        });

        // Wait for content — try key selectors then fall back
        await waitForContent(page);

        // Auto-scroll to trigger lazy-loaded content (A+, specs, etc.)
        await autoScroll(page);

        // Check for access denied
        const bodyHtml = await page.content();
        if (detectAccessDenied(bodyHtml)) {
            return {
                success: false,
                error: 'Access denied by the target website. The site detected automated access.',
                errorType: 'ACCESS_DENIED',
            };
        }

        // Extract product data using Orchestrator
        const extractor = getExtractorForUrl(url);
        const productData = await extractor(page, url);
        return { success: true, data: productData };
    } finally {
        await browser.close();
    }
}

// ─── Wait for Content (Self-Healing) ───
async function waitForContent(page: import('playwright').Page): Promise<void> {
    // Primary selectors for Amazon and common e-commerce sites
    const primarySelectors = [
        '#productTitle',
        '#title',
        '[data-feature-name="title"]',
        'h1[class*="product"]',
        'h1[class*="title"]',
        'h1.product-title',
        'h1',
    ];

    for (const selector of primarySelectors) {
        try {
            await page.waitForSelector(selector, { timeout: SELECTOR_TIMEOUT });
            return;
        } catch {
            // Try next selector
        }
    }

    // If no selector found, wait a bit for dynamic content
    await page.waitForTimeout(3000);
}

// ─── Auto-scroll to trigger lazy-loaded content ───
async function autoScroll(page: import('playwright').Page): Promise<void> {
    await page.evaluate(async () => {
        await new Promise<void>((resolve) => {
            let totalHeight = 0;
            const distance = 500;
            const maxScrolls = 20;
            let scrollCount = 0;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;
                scrollCount++;
                if (totalHeight >= scrollHeight || scrollCount >= maxScrolls) {
                    clearInterval(timer);
                    window.scrollTo(0, 0);
                    resolve();
                }
            }, 150);
        });
    });
    // Give lazy content a moment to render
    await page.waitForTimeout(2000);
}



// ─── Unblocker API Mode ───
async function scrapeWithUnblocker(url: string): Promise<ScrapeResponse> {
    const apiUrl = new URL(UNBLOCKER_API_URL);
    apiUrl.searchParams.set('api_key', UNBLOCKER_API_KEY);
    apiUrl.searchParams.set('url', url);
    apiUrl.searchParams.set('render_js', 'true');
    apiUrl.searchParams.set('premium_proxy', 'true');

    const response = await fetch(apiUrl.toString(), {
        method: 'GET',
        headers: { 'Accept': 'text/html' },
    });

    if (!response.ok) {
        if (response.status === 403 || response.status === 429) {
            return {
                success: false,
                error: 'Access denied via Unblocker API. Check your API key or quota.',
                errorType: 'ACCESS_DENIED',
            };
        }
        return {
            success: false,
            error: `Unblocker API returned status ${response.status}`,
            errorType: 'UNKNOWN',
        };
    }

    const html = await response.text();

    if (detectAccessDenied(html)) {
        return {
            success: false,
            error: 'The target site still blocked access even through the proxy.',
            errorType: 'ACCESS_DENIED',
        };
    }

    // Parse the HTML using a simple DOM approach
    // For the unblocker mode, we'll use a lightweight parse
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM(html, { url });
    const document = dom.window.document;

    // Re-use similar extraction logic for the JSDOM document
    const title = extractTitleFromDocument(document);
    const images = extractImagesFromDocument(document, html);
    const description = extractDescriptionFromDocument(document);
    const attributes = extractAttributesFromDocument(document);
    const { price, currency } = extractPriceFromDocument(document);

    return {
        success: true,
        data: { title, images, description, attributes, price, currency, url },
    };
}

// ─── Document-based extraction helpers (for Unblocker mode) ───
function extractTitleFromDocument(doc: Document): string {
    const selectors = ['#productTitle', '[data-feature-name="title"] span', 'h1[class*="product"]', 'h1', 'title'];
    for (const sel of selectors) {
        const el = doc.querySelector(sel);
        if (el?.textContent?.trim()) return el.textContent.trim();
    }
    return 'Untitled Product';
}

function extractImagesFromDocument(doc: Document, html: string): string[] {
    const images = new Set<string>();
    const matches = html.matchAll(/"(?:hiRes|large)"\s*:\s*"(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi);
    for (const match of matches) {
        if (match[1]) images.add(match[1]);
    }
    const ogImage = doc.querySelector('meta[property="og:image"]');
    if (ogImage) {
        const content = ogImage.getAttribute('content');
        if (content) images.add(content);
    }
    return Array.from(images).slice(0, 20);
}

function extractDescriptionFromDocument(doc: Document): string {
    const selectors = ['#productDescription', '#feature-bullets', '[itemprop="description"]', 'meta[name="description"]'];
    for (const sel of selectors) {
        const el = doc.querySelector(sel);
        if (el?.textContent?.trim()) return el.textContent.trim();
        if (el?.getAttribute('content')) return el.getAttribute('content') || '';
    }
    return '';
}

function extractAttributesFromDocument(doc: Document): Record<string, string> {
    const attrs: Record<string, string> = {};
    const rows = doc.querySelectorAll('#productDetails_techSpec_section_1 tr, .prodDetTable tr');
    rows.forEach((row) => {
        const cells = row.querySelectorAll('th, td');
        if (cells.length >= 2) {
            const key = cells[0].textContent?.trim() || '';
            const value = cells[1].textContent?.trim() || '';
            if (key && value) attrs[key] = value;
        }
    });
    return attrs;
}

function extractPriceFromDocument(doc: Document): { price: string; currency: string } {
    const selectors = ['.a-price .a-offscreen', '#priceblock_ourprice', '[itemprop="price"]'];
    for (const sel of selectors) {
        const el = doc.querySelector(sel);
        if (el?.textContent?.trim()) {
            const text = el.textContent.trim();
            const match = text.match(/([$€£¥])\s*([\d.,]+)/);
            if (match) return { currency: match[1], price: match[2] };
            return { price: text, currency: '' };
        }
    }
    return { price: '', currency: '' };
}
