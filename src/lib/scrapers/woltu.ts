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
            if (gtmProduct?.name) return gtmProduct.name;
            const h1 = document.querySelector('h1');
            return h1?.textContent?.trim() || 'Untitled Product';
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
            if (gtmProduct?.brand) addAttr('Marke', gtmProduct.brand);
            if (gtmProduct?.category) addAttr('Kategorie', gtmProduct.category);

            return attrs;
        }

        function extractPrice(): { price: string; currency: string } {
            if (gtmProduct?.price) {
                return { price: `€${gtmProduct.price}`, currency: 'EUR' };
            }

            const priceEl = document.querySelector('.product-detail-price, [class*="price"] [class*="current"], [itemprop="price"]');
            if (priceEl?.textContent?.trim()) {
                const text = priceEl.textContent.trim();
                const match = text.match(/(€)\s*([\d.,]+)/);
                if (match) return { price: `€${match[2]}`, currency: 'EUR' };
                return { price: text, currency: 'EUR' };
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
