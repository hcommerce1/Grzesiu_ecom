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
            const images = new Set<string>();
            const aosomThumbnails = Array.from(document.querySelectorAll('img.lazy[data-src*="aosomcdn.com"]'));
            for (const img of aosomThumbnails) {
                const dataSrc = img.getAttribute('data-src');
                if (dataSrc && dataSrc.includes('/product/')) {
                    let highRes = dataSrc.replace(/\/thumbnail\/\d+\/[a-z0-9]+\//i, '/100/');
                    if (isValidImageUrl(highRes) && !images.has(highRes)) {
                        images.add(highRes);
                    }
                }
            }
            return Array.from(images).slice(0, 30);
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

            const tables = document.querySelectorAll('.product-detail-attributes table, .product-detail-description table');
            for (const table of tables) {
                const rows = table.querySelectorAll('tr');
                rows.forEach((row) => {
                    const cells = row.querySelectorAll('th, td');
                    if (cells.length >= 2) {
                        addAttr(cells[0].textContent || '', cells[1].textContent || '');
                    }
                });
            }
            return attrs;
        }

        function extractPrice(): { price: string; currency: string } {
            const aosomPriceEl = document.querySelector('.price-now, .now.js-set-price, .price');
            if (aosomPriceEl) {
                let pText = (aosomPriceEl as HTMLElement).innerText.trim();
                pText = pText.replace(/\s*€$/, '');
                return { price: pText, currency: 'EUR' };
            }
            return { price: '', currency: '' };
        }

        function extractEan(): string {
            return ''; // Handled by generic
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
