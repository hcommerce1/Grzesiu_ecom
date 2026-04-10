import type { ScrapeResponse } from './types';
import { getExtractorForUrl } from './scrapers/index';

// ─── Configuration ───
const SCRAPER_MODE = process.env.SCRAPER_MODE || 'playwright';
const UNBLOCKER_API_KEY = process.env.UNBLOCKER_API_KEY || '';
const NAVIGATION_TIMEOUT = 30000;
const SELECTOR_TIMEOUT = 10000;

// ─── Proxy Config ───
type ProxyConfig = { server: string; username: string; password: string };

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
            const premiumResult = await scrapeWithPlaywright(url, {
                server: 'http://proxy.scrapingbee.com:8886',
                username: UNBLOCKER_API_KEY,
                password: 'render_js=False&premium_proxy=True',
            });
            // Escalate to stealth proxy on ACCESS_DENIED
            if (!premiumResult.success && premiumResult.errorType === 'ACCESS_DENIED') {
                return scrapeWithPlaywright(url, {
                    server: 'http://proxy.scrapingbee.com:8886',
                    username: UNBLOCKER_API_KEY,
                    password: 'render_js=False&stealth_proxy=True',
                });
            }
            return premiumResult;
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

// ─── Playwright Mode (with optional ScrapingBee proxy) ───
async function scrapeWithPlaywright(url: string, proxy?: ProxyConfig): Promise<ScrapeResponse> {
    const { chromium } = require('playwright-extra');
    const stealth = require('puppeteer-extra-plugin-stealth')();

    chromium.use(stealth);

    const browser = await chromium.launch({
        headless: true,
        ...(proxy ? { proxy } : {}),
    });

    try {
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            ...(proxy ? { ignoreHTTPSErrors: true } : {}),
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
    // Primary selectors for Amazon, Allegro and common e-commerce sites
    const primarySelectors = [
        '#productTitle',
        '#title',
        '[data-feature-name="title"]',
        '[data-box-name]',          // Allegro
        'h1[class*="offer"]',       // Allegro offer title
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
