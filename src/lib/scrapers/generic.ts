import type { ProductData } from '../types';
import type { SiteExtractor } from '../scraper-types';
import { formatDescriptionHtml, isValidImageUrl } from './utils';
import { isIconOrLogo } from '../scraper';

export const extractGeneric: SiteExtractor = async (page, url) => {
    const data = await page.evaluate(({ formatDescriptionHtmlStr, isValidImageUrlStr, isIconOrLogoStr }) => {
        // Hydrate utility functions inside the browser context
        const formatDescriptionHtml = new Function('return ' + formatDescriptionHtmlStr)() as (element: HTMLElement) => string;
        const isValidImageUrl = new Function('return ' + isValidImageUrlStr)() as (url: string) => boolean;
        const isIconOrLogo = new Function('return ' + isIconOrLogoStr)() as (url: string) => boolean;

        function extractTitle(): string {
            const commonSelectors = [
                'h1[class*="product"] span',
                'h1[class*="title"]',
                'h1.product-title',
                '[itemprop="name"]',
                '.product-title',
                '.product_title',
            ];
            for (const sel of commonSelectors) {
                const el = document.querySelector(sel);
                if (el?.textContent?.trim()) return el.textContent.trim();
            }

            const h1s = Array.from(document.querySelectorAll('h1'));
            if (h1s.length > 0) {
                const sorted = h1s.sort((a, b) => (b.textContent?.length || 0) - (a.textContent?.length || 0));
                return sorted[0]?.textContent?.trim() || 'Untitled Product';
            }
            return 'Untitled Product';
        }

        function extractImages(): string[] {
            const images = new Set<string>();

            const productImgs = document.querySelectorAll(
                '[class*="product"] img, [data-component-type="s-product-image"] img, [itemprop="image"]'
            );
            productImgs.forEach((img) => {
                const el = img as HTMLImageElement;
                if (el.naturalWidth > 0 && el.naturalWidth < 50 && el.naturalHeight > 0 && el.naturalHeight < 50) return;
                const src = el.dataset.src || el.dataset.lazySrc || el.src;
                if (src && isValidImageUrl(src) && !src.includes('sprite') && !src.includes('1x1') && !isIconOrLogo(src)) {
                    images.add(src);
                }
            });

            if (images.size === 0) {
                const ogImage = document.querySelector('meta[property="og:image"]');
                const content = ogImage?.getAttribute('content');
                if (content && isValidImageUrl(content)) images.add(content);
            }

            return Array.from(images).slice(0, 30);
        }

        function extractDescription(): string {
            const parts: string[] = [];

            const descSelectors = [
                '[itemprop="description"]',
                '.product-description',
                '#description',
                '[data-feature-name="productDescription"]',
                '.product-detail-description',
            ];
            for (const sel of descSelectors) {
                const el = document.querySelector(sel);
                if (el?.textContent?.trim() && el.textContent.trim().length > 30) {
                    return formatDescriptionHtml(el as HTMLElement);
                }
            }

            const metaDesc = document.querySelector('meta[name="description"]');
            if (metaDesc) {
                const content = metaDesc.getAttribute('content');
                if (content) parts.push(content);
            }

            return parts.join('\n\n');
        }

        function extractAttributes(): Record<string, string> {
            const attrs: Record<string, string> = {};

            function addAttr(key: string, value: string) {
                const k = key.trim().replace(/\s+/g, ' ');
                const v = value.trim().replace(/\s+/g, ' ');
                if (k && v && k.length < 100 && v.length < 500 && k !== v) {
                    attrs[k] = v;
                }
            }

            const generalAttrSelectors = [
                'table.woocommerce-product-attributes',
                'table.shop_attributes',
                'table.product-attributes',
                '#product-attribute-specs-table',
                '.product-specs',
                '.attributes-list',
                '.specifications',
            ];

            for (const sel of generalAttrSelectors) {
                const table = document.querySelector(sel);
                if (table) {
                    const rows = table.querySelectorAll('tr');
                    rows.forEach((row) => {
                        const cells = row.querySelectorAll('th, td');
                        if (cells.length >= 2) {
                            addAttr(cells[0].textContent || '', cells[1].textContent || '');
                        }
                    });
                }
            }

            return attrs;
        }

        function extractPrice(): { price: string; currency: string } {
            const priceSelectors = [
                '.price_active',
                '#product-price',
                '.product-price .price',
                '.current-price-container .price',
                '[itemprop="price"]',
                'meta[itemprop="price"]',
                '[class*="price"] [class*="current"]',
                '.price--default',
                '.product-detail-price',
            ];

            for (const sel of priceSelectors) {
                const el = document.querySelector(sel);
                const raw = el?.textContent?.trim() || el?.getAttribute('content') || '';
                if (raw) {
                    const match = raw.match(/([$€£¥zł])\s*([\d.,]+)/);
                    if (match) return { currency: match[1], price: match[2] };
                    const match2 = raw.match(/([\d.,]+)\s*([$€£¥zł]|PLN|EUR|USD)/);
                    if (match2) return { currency: match2[2], price: match2[1] };
                    const numMatch = raw.match(/([\d.,]+)/);
                    if (numMatch) return { price: numMatch[1], currency: '' };
                }
            }

            const scripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (const script of scripts) {
                try {
                    const data = JSON.parse(script.textContent || '');
                    const offer = data?.offers || data?.offers?.[0];
                    if (offer?.price) {
                        return { price: String(offer.price), currency: offer.priceCurrency || '€' };
                    }
                } catch { /* skip */ }
            }

            return { price: '', currency: '' };
        }

        function extractEan(): string {
            const eanSelectors = ['.ean', '[itemprop="gtin13"]', '[itemprop="gtin"]', '[data-ean]'];
            for (const sel of eanSelectors) {
                const el = document.querySelector(sel);
                const text = el?.textContent?.trim() || el?.getAttribute('content') || el?.getAttribute('data-ean') || '';
                const cleaned = text.replace(/[^\d]/g, '');
                if (cleaned.length >= 8) return cleaned;
            }
            const body = document.body.textContent || '';
            const eanMatch = body.match(/EAN[:\s]*(\d{8,13})/i);
            if (eanMatch) return eanMatch[1];
            return '';
        }

        function extractSku(): string {
            const skuSelectors = ['.sku', '[itemprop="sku"]', '.product-sku', '[data-sku]'];
            for (const sel of skuSelectors) {
                const el = document.querySelector(sel);
                const text = el?.textContent?.trim() || el?.getAttribute('content') || el?.getAttribute('data-sku') || '';
                if (text.length > 1 && text.length < 50) return text;
            }
            const body = document.body.textContent || '';
            const skuMatch = body.match(/(?:Artikelnummer|SKU|Item)[:\s]*([A-Za-z0-9_-]{3,30})/i);
            if (skuMatch) return skuMatch[1];
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
        isValidImageUrlStr: isValidImageUrl.toString(),
        isIconOrLogoStr: isIconOrLogo.toString(),
    });

    return { ...data, url };
};
