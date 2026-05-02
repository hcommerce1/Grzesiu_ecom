import type { SiteExtractor } from '../scraper-types';
import { formatDescriptionHtml } from './utils';
import { extractGeneric } from './generic';

export const extractFlexispot: SiteExtractor = async (page, url) => {
    const data = await page.evaluate(({ formatDescriptionHtmlStr }) => {
        const formatDescriptionHtml = new Function('return ' + formatDescriptionHtmlStr)() as (element: HTMLElement) => string;

        function extractTitle(): string {
            const h1 = document.querySelector('.product-info-main h1.page-title, h1.page-title, h1');
            return h1?.textContent?.trim() || '';
        }

        function extractImages(): string[] {
            const images = new Set<string>();

            // Flexispot uses Magento gallery — main swiper/fotorama images
            document.querySelectorAll(
                '.product-image-gallery img, .fotorama__stage img, .fotorama__nav img, ' +
                '[data-gallery-role="gallery"] img, .swiper-slide img, ' +
                '.gallery-placeholder img, .product-img img'
            ).forEach((img) => {
                const el = img as HTMLImageElement;
                const src =
                    el.getAttribute('data-zoom-image') ||
                    el.getAttribute('data-full') ||
                    el.dataset.src ||
                    el.dataset.lazySrc ||
                    el.src;
                if (src && !src.includes('1x1') && !src.includes('placeholder') &&
                    !src.includes('sprite') && !src.includes('logo') && src.startsWith('http')) {
                    images.add(src.split('?')[0]); // strip query params for dedup
                }
            });

            // Thumbnail strip
            document.querySelectorAll('.product-image-thumbs img, .fotorama__thumb img').forEach((img) => {
                const el = img as HTMLImageElement;
                const src = el.dataset.full || el.dataset.src || el.src;
                if (src && !src.includes('placeholder') && src.startsWith('http')) {
                    // Try to get full-size URL from thumbnail (Flexispot pattern: /cache/ vs /base/)
                    const full = src.replace(/\/cache\/[^/]+\//, '/');
                    images.add(full.split('?')[0]);
                }
            });

            // og:image fallback
            if (images.size === 0) {
                const og = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
                if (og) images.add(og);
            }

            return Array.from(images).filter(u => u.match(/\.(jpg|jpeg|png|webp)/i)).slice(0, 25);
        }

        function extractDescription(): string {
            // Flexispot: description tab or accordion
            const selectors = [
                '#description',
                '[data-role="content"]',
                '.product-attribute-description',
                '.product.data.items .item.content',
                '[itemprop="description"]',
                '.product-info-description',
                '.description .value',
            ];
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el?.textContent?.trim() && el.textContent.trim().length > 50) {
                    return formatDescriptionHtml(el as HTMLElement);
                }
            }
            const meta = document.querySelector('meta[name="description"]')?.getAttribute('content');
            return meta || '';
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

            // Magento additional attributes table
            document.querySelectorAll(
                '.additional-attributes tr, .product-attributes tr, table.data tr, ' +
                '.product-info-stock-sku table tr, .technical-spec tr'
            ).forEach((row) => {
                const cells = row.querySelectorAll('th, td');
                if (cells.length >= 2) {
                    addAttr(cells[0].textContent || '', cells[1].textContent || '');
                }
            });

            // Flexispot spec tables in description
            document.querySelectorAll('.product-detail-content table tr, .spec-table tr').forEach((row) => {
                const cells = row.querySelectorAll('td, th');
                if (cells.length >= 2) {
                    addAttr(cells[0].textContent || '', cells[1].textContent || '');
                }
            });

            // JSON-LD
            document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
                try {
                    const d = JSON.parse(script.textContent || '');
                    if (d['@type'] === 'Product') {
                        if (d.brand?.name) addAttr('Marka', d.brand.name);
                        if (d.sku) addAttr('SKU', d.sku);
                        if (d.mpn) addAttr('MPN', d.mpn);
                    }
                } catch { /* skip */ }
            });

            return attrs;
        }

        function extractPrice(): { price: string; currency: string } {
            const saleEl = document.querySelector('.special-price .price, .price-final_price .price');
            if (saleEl?.textContent?.trim()) {
                return { price: saleEl.textContent.trim(), currency: 'PLN' };
            }
            const priceEl = document.querySelector(
                '.price-wrapper .price, .product-info-price .price, [itemprop="price"]'
            );
            if (priceEl?.textContent?.trim()) {
                return { price: priceEl.textContent.trim(), currency: 'PLN' };
            }
            // JSON-LD
            for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
                try {
                    const d = JSON.parse(script.textContent || '');
                    const offer = Array.isArray(d.offers) ? d.offers[0] : d.offers;
                    if (offer?.price) {
                        return { price: String(offer.price), currency: offer.priceCurrency || 'PLN' };
                    }
                } catch { /* skip */ }
            }
            return { price: '', currency: '' };
        }

        function extractSku(): string {
            const el = document.querySelector('[itemprop="sku"], .product.attribute.sku .value');
            if (el?.textContent?.trim()) return el.textContent.trim();
            for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
                try {
                    const d = JSON.parse(script.textContent || '');
                    if (d['@type'] === 'Product' && d.sku) return d.sku;
                } catch { /* skip */ }
            }
            return '';
        }

        return {
            title: extractTitle(),
            images: extractImages(),
            description: extractDescription(),
            attributes: extractAttributes(),
            ...extractPrice(),
            ean: '',
            sku: extractSku(),
        };
    }, { formatDescriptionHtmlStr: formatDescriptionHtml.toString() });

    const genericData = await extractGeneric(page, url);

    return {
        url,
        title: data.title || genericData.title,
        images: data.images.length > 0 ? data.images : genericData.images,
        description: data.description || genericData.description,
        attributes: { ...genericData.attributes, ...data.attributes },
        price: data.price || genericData.price,
        currency: data.currency || genericData.currency,
        ean: data.ean || genericData.ean,
        sku: data.sku || genericData.sku,
    };
};
