import type { SiteExtractor } from '../types';
import { formatDescriptionHtml } from './utils';
import { extractGeneric } from './generic';

export const extractWoltu: SiteExtractor = async (page, url) => {
    const data = await page.evaluate(({ formatDescriptionHtmlStr }) => {
        const formatDescriptionHtml = new Function('return ' + formatDescriptionHtmlStr)() as (element: HTMLElement) => string;

        // Try GTM dataLayer for structured product info
        const dataLayer = (window as unknown as Record<string, unknown>).dataLayer as Array<{
            ecommerce?: {
                detail?: {
                    products?: Array<{
                        name?: string;
                        id?: string;
                        price?: string;
                        brand?: string;
                        category?: string;
                    }>;
                };
                currencyCode?: string;
            };
        }> | undefined;

        const gtmProduct = dataLayer
            ?.find((e) => e.ecommerce?.detail?.products)
            ?.ecommerce?.detail?.products?.[0];

        function extractTitle(): string {
            if (gtmProduct?.name) return gtmProduct.name.replace(/\s*\n\s*/g, ' ').trim();
            const h1 = document.querySelector('h1');
            return h1?.textContent?.trim()?.replace(/\s*\n\s*/g, ' ') || 'Untitled Product';
        }

        function extractImages(): string[] {
            const images = new Set<string>();

            // Shopware gallery images
            document.querySelectorAll('.gallery-slider-container img, .image-slider img, [class*="gallery"] img, .product-detail-media img').forEach((img) => {
                const el = img as HTMLImageElement;
                const src = el.dataset.src || el.src;
                if (src && !src.includes('1x1') && !src.includes('placeholder')) {
                    let fullUrl = src.startsWith('http') ? src : new URL(src, window.location.origin).href;
                    // Shopware pattern: image_600x600.jpg -> try to get original
                    fullUrl = fullUrl.replace(/_\d+x\d+\./, '.');
                    images.add(fullUrl);
                }
            });

            // Also check anchor tags wrapping images (lightbox links)
            document.querySelectorAll('.gallery-slider-container a[href*="/media/"], a[data-full-image], a[href*="image"]').forEach((a) => {
                const href = (a as HTMLAnchorElement).href;
                if (href && href.includes('/media/')) {
                    images.add(href);
                }
            });

            // Fallback: og:image
            if (images.size === 0) {
                const og = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
                if (og) images.add(og);
            }

            return Array.from(images).slice(0, 30);
        }

        function extractDescription(): string {
            const descEl = document.querySelector('.product-detail-description-text, .product-description, [itemprop="description"]');
            if (descEl?.textContent?.trim() && descEl.textContent.trim().length > 30) {
                return formatDescriptionHtml(descEl as HTMLElement);
            }

            const meta = document.querySelector('meta[name="description"]')?.getAttribute('content');
            return meta || '';
        }

        function extractAttributes(): Record<string, string> {
            const attrs: Record<string, string> = {};

            function addAttr(key: string, value: string) {
                const k = key.trim().replace(/[:\s]+$/g, '').replace(/\s+/g, ' ');
                const v = value.trim().replace(/\s+/g, ' ');
                if (k && v && k.length < 100 && v.length < 500 && k !== v) {
                    attrs[k] = v;
                }
            }

            // Woltu: li.entry--sku with <strong>Key:</strong><span>Value</span>
            document.querySelectorAll('li.entry--sku').forEach((li) => {
                const strong = li.querySelector('strong');
                const span = li.querySelector('span');
                if (strong && span) {
                    addAttr(strong.textContent || '', span.textContent || '');
                }
            });

            // Woltu: <ul> with key:value li items (specs like "Material: Velvet", "Total height: 81cm")
            const allUls = document.querySelectorAll('ul');
            for (const ul of Array.from(allUls)) {
                const lis = ul.querySelectorAll('li');
                let kvCount = 0;
                const tmpAttrs: Record<string, string> = {};
                lis.forEach((li) => {
                    const t = li.textContent?.trim() || '';
                    const sep = t.match(/^(.+?)\s*:\s*(.+)$/);
                    if (sep) {
                        const k = sep[1].trim();
                        const v = sep[2].trim();
                        // Skip feature descriptions (long keys) — only keep short spec keys
                        if (k.length < 50 && v.length < 200 && k !== v) {
                            tmpAttrs[k] = v;
                            kvCount++;
                        }
                    }
                });
                if (kvCount >= 3) {
                    Object.assign(attrs, tmpAttrs);
                }
            }

            // Shopware uses <dl> <dt>/<dd> for specs
            document.querySelectorAll('dl').forEach((dl) => {
                const dts = dl.querySelectorAll('dt');
                dts.forEach((dt) => {
                    const dd = dt.nextElementSibling;
                    if (dd && dd.tagName === 'DD') {
                        addAttr(dt.textContent || '', dd.textContent || '');
                    }
                });
            });

            // Also try table rows
            document.querySelectorAll('.product-detail-properties tr, .product-properties tr').forEach((row) => {
                const cells = row.querySelectorAll('th, td');
                if (cells.length >= 2) {
                    addAttr(cells[0].textContent || '', cells[1].textContent || '');
                }
            });

            // GTM data
            if (gtmProduct?.brand) addAttr('Brand', gtmProduct.brand);
            if (gtmProduct?.category) addAttr('Category', gtmProduct.category);

            // Remove fields stored separately
            const removeKeys = ['Order number', 'Bestellnummer', 'Artikelnummer', 'EAN', 'ean'];
            for (const k of removeKeys) delete attrs[k];

            return attrs;
        }

        function extractPrice(): { price: string; currency: string } {
            if (gtmProduct?.price) {
                return { price: gtmProduct.price, currency: 'EUR' };
            }

            // meta[itemprop="price"] has value in content attribute
            const metaPrice = document.querySelector('meta[itemprop="price"]');
            if (metaPrice?.getAttribute('content')) {
                return { price: metaPrice.getAttribute('content')!, currency: 'EUR' };
            }

            // Shopware 5: .product--price.price--default, Shopware 6: .product-detail-price
            const priceEl = document.querySelector('.product--price.price--default, .product-detail-price, [class*="price"] [class*="current"]');
            if (priceEl?.textContent?.trim()) {
                const text = priceEl.textContent.trim();
                const match = text.match(/€\s*([\d.,]+)/);
                if (match) return { price: match[1], currency: 'EUR' };
                const match2 = text.match(/([\d.,]+)\s*€/);
                if (match2) return { price: match2[1], currency: 'EUR' };
                return { price: text.replace(/[^\d.,]/g, ''), currency: 'EUR' };
            }

            return { price: '', currency: '' };
        }

        function extractSku(): string {
            if (gtmProduct?.id) return gtmProduct.id;
            const skuEl = document.querySelector('[itemprop="sku"], .product-detail-ordernumber');
            return skuEl?.textContent?.trim() || '';
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
    }, {
        formatDescriptionHtmlStr: formatDescriptionHtml.toString(),
    });

    // Fall back to generic for missing fields
    const genericData = await extractGeneric(page, url);

    return {
        url,
        title: data.title !== 'Untitled Product' ? data.title : genericData.title,
        images: data.images.length > 0 ? data.images : genericData.images,
        description: data.description || genericData.description,
        attributes: { ...genericData.attributes, ...data.attributes },
        price: data.price || genericData.price,
        currency: data.currency || genericData.currency,
        ean: data.ean || genericData.ean,
        sku: data.sku || genericData.sku,
    };
};
