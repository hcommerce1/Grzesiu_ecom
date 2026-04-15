import type { SiteExtractor } from '../types';
import { formatDescriptionHtml } from './utils';

export const extractVidaXL: SiteExtractor = async (page, url) => {
    const data = await page.evaluate(({ formatDescriptionHtmlStr }) => {
        const formatDescriptionHtml = new Function('return ' + formatDescriptionHtmlStr)() as (element: HTMLElement) => string;

        // JSON-LD structured data (schema.org Product)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let jsonLd: any = null;
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of Array.from(scripts)) {
            try {
                const data = JSON.parse(script.textContent || '');
                if (data['@type'] === 'Product' || data.mainEntity?.['@type'] === 'Product') {
                    jsonLd = data['@type'] === 'Product' ? data : data.mainEntity;
                    break;
                }
            } catch { /* ignore */ }
        }

        function extractTitle(): string {
            if (jsonLd?.name) return jsonLd.name;
            const h1 = document.querySelector('h1');
            return h1?.textContent?.trim() || document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
        }

        function extractImages(): string[] {
            const seen = new Set<string>();
            const images: string[] = [];

            function isJunk(src: string): boolean {
                const lower = src.toLowerCase();
                const pathOnly = lower.split('?')[0];
                if (pathOnly.endsWith('.svg') || pathOnly.endsWith('.ico')) return true;
                if (lower.includes('unavailable') || lower.includes('placeholder') || lower.includes('no-image')) return true;
                if (lower.includes('/logo') || lower.includes('/icon') || lower.includes('/favicon')) return true;
                if (lower.includes('vdxl.im')) return true;
                if (lower.includes('1x1') || lower.includes('sprite')) return true;
                return false;
            }

            function addImage(src: string) {
                if (!src || isJunk(src)) return;
                const full = src.startsWith('http') ? src : new URL(src, window.location.origin).href;
                const hashMatch = full.match(/\/(dw[a-f0-9]{8,})\//);
                const key = hashMatch ? hashMatch[1] : full;
                if (!seen.has(key)) {
                    seen.add(key);
                    images.push(full);
                }
            }

            // Helper: check if element is inside a recommendation/cross-sell section
            function isInsideRecommendations(el: Element): boolean {
                let parent = el.parentElement;
                while (parent) {
                    const cls = (parent.className || '').toLowerCase();
                    if (cls.includes('product-tile') || cls.includes('recommend') ||
                        cls.includes('cross-sell') || cls.includes('similar') ||
                        cls.includes('also-bought') || cls.includes('recently') ||
                        cls.includes('einstein')) return true;
                    parent = parent.parentElement;
                }
                return false;
            }

            // 1. JSON-LD images (most reliable, only for this product)
            if (jsonLd?.image) {
                const imgs = Array.isArray(jsonLd.image) ? jsonLd.image : [jsonLd.image];
                for (const img of imgs) {
                    const src = typeof img === 'string' ? img : img?.url || img?.contentUrl || '';
                    addImage(src);
                }
            }

            // 2. Primary product gallery only (exclude recommendations)
            const galleryContainer = document.querySelector('.primary-images, .product-details, .product-detail');
            if (galleryContainer) {
                galleryContainer.querySelectorAll('img, [data-sourceimg]').forEach((el) => {
                    if (isInsideRecommendations(el)) return;
                    const src = (el as HTMLElement).getAttribute('data-sourceimg')
                        || (el as HTMLElement).getAttribute('data-src')
                        || (el as HTMLImageElement).src || '';
                    addImage(src);
                });
            }

            // 3. og:image fallback
            if (images.length === 0) {
                const og = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
                if (og) addImage(og);
            }

            return images.slice(0, 30);
        }

        function extractDescription(): string {
            // Sekcja "Opis"
            const descHeaders = document.querySelectorAll('h2, h3');
            for (const h of Array.from(descHeaders)) {
                const text = h.textContent?.trim()?.toLowerCase() || '';
                if (text === 'opis' || text === 'description' || text === 'produktbeschreibung' || text === 'beschreibung') {
                    const nextEl = h.nextElementSibling;
                    if (nextEl) return formatDescriptionHtml(nextEl as HTMLElement);
                }
            }

            const descEl = document.querySelector('[itemprop="description"], .product-description, .product-detail-description');
            if (descEl?.textContent?.trim()) return formatDescriptionHtml(descEl as HTMLElement);

            return document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
        }

        function extractAttributes(): Record<string, string> {
            const attrs: Record<string, string> = {};
            function addAttr(key: string, value: string) {
                const k = key.trim().replace(/[:\s]+$/g, '').replace(/\s+/g, ' ');
                const v = value.trim().replace(/\s+/g, ' ');
                if (k && v && k.length < 100 && v.length < 500 && k !== v) attrs[k] = v;
            }

            // VidaXL: <ul><li>Kolor: zielony</li>...</ul> (min 3 pary klucz:wartość)
            const allUls = document.querySelectorAll('ul');
            for (const ul of Array.from(allUls)) {
                const lis = ul.querySelectorAll('li');
                let kvCount = 0;
                const tmpAttrs: Record<string, string> = {};
                lis.forEach((li) => {
                    const t = li.textContent?.trim() || '';
                    const sep = t.match(/^(.+?)\s*:\s*(.+)$/);
                    if (sep) {
                        const k = sep[1].trim().replace(/[:\s]+$/g, '');
                        const v = sep[2].trim();
                        if (k && v && k.length < 100 && v.length < 500) {
                            tmpAttrs[k] = v;
                            kvCount++;
                        }
                    }
                });
                if (kvCount >= 3) {
                    Object.assign(attrs, tmpAttrs);
                    break;
                }
            }

            // Table rows fallback
            if (Object.keys(attrs).length === 0) {
                document.querySelectorAll('.product-specifications tr, .product-details tr, [class*="spec"] tr').forEach((row) => {
                    const cells = row.querySelectorAll('th, td');
                    if (cells.length >= 2) addAttr(cells[0].textContent || '', cells[1].textContent || '');
                });
            }

            // dl/dt/dd fallback
            if (Object.keys(attrs).length === 0) {
                document.querySelectorAll('dl').forEach((dl) => {
                    const dts = dl.querySelectorAll('dt');
                    dts.forEach((dt) => {
                        const dd = dt.nextElementSibling;
                        if (dd?.tagName === 'DD') addAttr(dt.textContent || '', dd.textContent || '');
                    });
                });
            }

            // Remove fields that are stored separately
            const removeKeys = ['EAN', 'ean', 'SKU', 'sku', 'Brand', 'brand', 'Marke'];
            for (const k of removeKeys) delete attrs[k];

            return attrs;
        }

        function extractPrice(): { price: string; currency: string } {
            if (jsonLd?.offers?.price || jsonLd?.price) {
                return {
                    price: String(jsonLd.offers?.price || jsonLd.price),
                    currency: jsonLd.offers?.priceCurrency || jsonLd.priceCurrency || 'PLN',
                };
            }
            const priceEl = document.querySelector('[itemprop="price"], .product-price, [class*="price"]');
            if (priceEl?.textContent?.trim()) {
                const text = priceEl.textContent.trim();
                const match = text.match(/([\d.,]+)\s*(zł|PLN|€|EUR)/i);
                if (match) return { price: match[1], currency: match[2] };
                return { price: text, currency: 'PLN' };
            }
            return { price: '', currency: '' };
        }

        function extractEan(): string {
            if (jsonLd?.gtin13) return jsonLd.gtin13;
            if (jsonLd?.gtin) return jsonLd.gtin;
            // EAN often in URL for VidaXL (e.g. /8718475594239.html)
            const urlMatch = window.location.pathname.match(/\/(\d{13})\.html/);
            if (urlMatch) return urlMatch[1];
            // Spec list
            const body = document.body.textContent || '';
            const eanMatch = body.match(/EAN[:\s]*(\d{8,13})/i);
            return eanMatch?.[1] || '';
        }

        function extractSku(): string {
            if (jsonLd?.sku) return jsonLd.sku;
            const skuEl = document.querySelector('[itemprop="sku"]');
            return skuEl?.textContent?.trim() || '';
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
    });

    return {
        url,
        title: data.title,
        images: data.images,
        description: data.description,
        attributes: data.attributes,
        price: data.price,
        currency: data.currency,
        ean: data.ean,
        sku: data.sku,
    };
};
