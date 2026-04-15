import type { SiteExtractor } from '../types';
import { formatDescriptionHtml, isValidImageUrl } from './utils';
import { extractGeneric } from './generic';

export const extractAosom: SiteExtractor = async (page, url) => {
    const aosomData = await page.evaluate(({ formatDescriptionHtmlStr, isValidImageUrlStr }) => {
        const formatDescriptionHtml = new Function('return ' + formatDescriptionHtmlStr)() as (element: HTMLElement) => string;
        const isValidImageUrl = new Function('return ' + isValidImageUrlStr)() as (url: string) => boolean;

        function extractTitle(): string {
            const aosomTitle = document.querySelector('h1.js-detail-title');
            if (aosomTitle?.textContent?.trim()) return aosomTitle.textContent.trim();
            return 'Untitled Product';
        }

        function extractImages(): string[] {
            const images: string[] = [];
            const seen = new Set<string>();

            // 1. JSON-LD images (cleanest source, no duplicates)
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (const script of Array.from(scripts)) {
                try {
                    const data = JSON.parse(script.textContent || '');
                    if (data['@type'] === 'Product' && Array.isArray(data.image)) {
                        for (const imgUrl of data.image) {
                            if (typeof imgUrl === 'string' && imgUrl.includes('aosomcdn.com') && imgUrl.includes('/product/')) {
                                // Normalize: use /100/ for highest quality
                                const highRes = imgUrl.replace(/\/thumbnail\/\d+\/[a-z0-9]+\//i, '/100/');
                                const normalized = highRes.split('?')[0].replace(/\.(jpg|png|webp)(\.webp)?$/i, '');
                                if (!seen.has(normalized)) {
                                    seen.add(normalized);
                                    images.push(highRes);
                                }
                            }
                        }
                    }
                } catch {}
            }

            // 2. Fallback: DOM thumbnails (deduplicated)
            if (images.length === 0) {
                const aosomThumbnails = Array.from(document.querySelectorAll('img.lazy[data-src*="aosomcdn.com"]'));
                for (const img of aosomThumbnails) {
                    const dataSrc = img.getAttribute('data-src');
                    if (dataSrc && dataSrc.includes('/product/')) {
                        const highRes = dataSrc.replace(/\/thumbnail\/\d+\/[a-z0-9]+\//i, '/100/');
                        const normalized = highRes.split('?')[0].replace(/\.(jpg|png|webp)(\.webp)?$/i, '');
                        if (!seen.has(normalized) && isValidImageUrl(highRes)) {
                            seen.add(normalized);
                            images.push(highRes);
                        }
                    }
                }
            }

            return images.slice(0, 30);
        }

        function extractDescription(): string {
            const aosomDesc = document.querySelector('.content-detail-content-text-describe');
            if (aosomDesc) return formatDescriptionHtml(aosomDesc as HTMLElement);
            return '';
        }

        function extractAttributes(): Record<string, string> {
            const attrs: Record<string, string> = {};
            function addAttr(key: string, value: string) {
                const k = key.trim().replace(/\s+/g, ' ');
                const v = value.trim().replace(/\s+/g, ' ');
                if (k && v && k.length < 100 && v.length < 500 && k !== v) attrs[k] = v;
            }

            // Aosom: tables inside .product-right-item-table-wrap and general product tables
            const tables = document.querySelectorAll('.product-right-item-table-wrap table, .product-detail-attributes table, .product-detail-description table, .content-detail table');
            for (const table of tables) {
                const rows = table.querySelectorAll('tr');
                rows.forEach((row) => {
                    const cells = row.querySelectorAll('th, td');
                    if (cells.length >= 2) {
                        addAttr(cells[0].textContent || '', cells[1].textContent || '');
                    }
                });
            }

            // Aosom: <h3>Parametry:</h3> followed by <ul> with ✔ Key: Value items
            const descArea = document.querySelector('.content-detail-content-text-describe') || document.body;
            const headings = descArea.querySelectorAll('h2, h3, h4');
            for (const h of Array.from(headings)) {
                const hText = h.textContent?.trim()?.toLowerCase() || '';
                if (hText.includes('parametr') || hText.includes('specyf') || hText.includes('dane techniczne')) {
                    // Get the <ul> right after this heading
                    const nextUl = h.nextElementSibling;
                    if (nextUl && nextUl.tagName === 'UL') {
                        const lis = nextUl.querySelectorAll('li');
                        for (const li of Array.from(lis)) {
                            const text = li.textContent?.trim() || '';
                            const cleaned = text.replace(/^[✔✓☑•\-\s]+/, '').trim();
                            const sep = cleaned.match(/^(.+?)\s*:\s*(.+)$/);
                            if (sep && sep[1].length < 60) addAttr(sep[1], sep[2]);
                        }
                    }
                }
            }

            // Fallback: parse from raw text if headings approach didn't work
            if (Object.keys(attrs).length < 3) {
                const fullText = descArea.textContent || '';
                const paramMatch = fullText.match(/Parametry:\s*([\s\S]*?)(?:Zawartość|Podręcznik|$)/i);
                if (paramMatch) {
                    const lines = paramMatch[1].split(/[✔✓\n]/).map(l => l.trim()).filter(Boolean);
                    for (const line of lines) {
                        const sep = line.match(/^(.+?)\s*:\s*(.+)$/);
                        if (sep && sep[1].length < 60) addAttr(sep[1], sep[2]);
                    }
                }
            }

            // Fallback: any table with 2-column rows that look like specs
            if (Object.keys(attrs).length === 0) {
                document.querySelectorAll('table').forEach((table) => {
                    const rows = table.querySelectorAll('tr');
                    if (rows.length >= 2 && rows.length <= 20) {
                        rows.forEach((row) => {
                            const cells = row.querySelectorAll('th, td');
                            if (cells.length >= 2) {
                                addAttr(cells[0].textContent || '', cells[1].textContent || '');
                            }
                        });
                    }
                });
            }

            // Remove SKU from attrs (stored separately)
            delete attrs['SKU'];
            delete attrs['sku'];

            return attrs;
        }

        function extractPrice(): { price: string; currency: string } {
            const aosomPriceEl = document.querySelector('.price-now, .now.js-set-price, .price');
            if (aosomPriceEl) {
                const pText = (aosomPriceEl as HTMLElement).innerText?.trim() || (aosomPriceEl as HTMLElement).textContent?.trim() || '';
                // Detect currency from text
                if (pText.includes('zł') || pText.includes('PLN')) {
                    const num = pText.replace(/[^\d.,]/g, '');
                    return { price: num, currency: 'PLN' };
                }
                if (pText.includes('€') || pText.includes('EUR')) {
                    const num = pText.replace(/[^\d.,]/g, '');
                    return { price: num, currency: 'EUR' };
                }
                // Detect from domain
                const host = window.location.hostname.toLowerCase();
                const currency = host.endsWith('.pl') ? 'PLN' : host.endsWith('.de') ? 'EUR' : host.endsWith('.co.uk') ? 'GBP' : 'EUR';
                return { price: pText.replace(/[^\d.,]/g, ''), currency };
            }
            return { price: '', currency: '' };
        }

        function extractEan(): string {
            // JSON-LD gtin13 (validate it's actually numeric)
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (const script of Array.from(scripts)) {
                try {
                    const data = JSON.parse(script.textContent || '');
                    if (data['@type'] === 'Product') {
                        const gtin = data.gtin13 || data.gtin || '';
                        if (/^\d{8,13}$/.test(gtin)) return gtin;
                    }
                } catch {}
            }
            // Body text search
            const body = document.body.textContent || '';
            const eanMatch = body.match(/EAN[:\s]*(\d{8,13})/i);
            if (eanMatch) return eanMatch[1];
            return '';
        }

        function extractSku(): string {
            const aosomH1 = document.querySelector('h1.js-detail-title');
            if (aosomH1 && aosomH1.getAttribute('sellersku')) {
                return aosomH1.getAttribute('sellersku')!.trim();
            }
            return '';
        }

        return {
            title: extractTitle(),
            images: extractImages(),
            description: extractDescription(),
            attributes: extractAttributes(),
            ...extractPrice(),
            ean: extractEan(),
            sku: extractSku(),
        };
    }, {
        formatDescriptionHtmlStr: formatDescriptionHtml.toString(),
        isValidImageUrlStr: isValidImageUrl.toString()
    });

    // Fall back to generic scraper for missing fields
    const genericData = await extractGeneric(page, url);

    return {
        url,
        title: aosomData.title !== 'Untitled Product' ? aosomData.title : genericData.title,
        images: aosomData.images.length > 0 ? aosomData.images : genericData.images,
        description: aosomData.description || genericData.description,
        attributes: Object.keys(aosomData.attributes).length > 0 ? aosomData.attributes : genericData.attributes,
        price: aosomData.price || genericData.price,
        currency: aosomData.currency || genericData.currency,
        ean: aosomData.ean || genericData.ean,
        sku: aosomData.sku || genericData.sku,
    };
};
