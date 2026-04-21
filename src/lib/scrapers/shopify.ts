import type { SiteExtractor } from '../scraper-types';
import { formatDescriptionHtml } from './utils';
import { extractGeneric } from './generic';

export const extractShopify: SiteExtractor = async (page, url) => {
    const tsData = await page.evaluate(({ formatDescriptionHtmlStr }) => {
        const formatDescriptionHtml = new Function('return ' + formatDescriptionHtmlStr)() as (element: HTMLElement) => string;

        // Try to get Shopify productData from window
        const productData = (window as unknown as Record<string, unknown>).productData as {
            title?: string;
            description?: string;
            media?: { src: string }[];
            variants?: { price: number; sku?: string }[];
        } | undefined;

        function extractTitle(): string {
            if (productData?.title) return productData.title;
            const h1 = document.querySelector('h1');
            return h1?.textContent?.trim() || 'Untitled Product';
        }

        function extractImages(): string[] {
            const images = new Set<string>();

            function addSrc(src: string) {
                if (!src || src.includes('1x1') || src.includes('placeholder') || src.includes('logo') || src.includes('icon')) return;
                let full = src.startsWith('//') ? 'https:' + src : src.startsWith('http') ? src : new URL(src, window.location.origin).href;
                // Remove Shopify size suffixes to get full-res image
                // e.g. image_100x.jpg -> image.jpg, image_600x600.jpg -> image.jpg
                full = full.replace(/_\d+x\d*\./g, '.');
                // Remove width/height query params that force small sizes
                try {
                    const u = new URL(full);
                    u.searchParams.delete('width');
                    u.searchParams.delete('height');
                    u.searchParams.delete('crop');
                    full = u.toString();
                } catch { /* keep as-is */ }
                images.add(full);
            }

            // Primary: Shopify productData.media
            if (productData?.media) {
                for (const item of productData.media) {
                    if (item.src) addSrc(item.src);
                }
            }

            // Always check DOM images (gallery thumbnails have all angles, not just one per variant)
            document.querySelectorAll('img').forEach((img) => {
                const el = img as HTMLImageElement;
                const src = el.dataset.src || el.dataset.lazySrc || el.src;
                // Only grab Shopify CDN product images
                if (src && src.includes('cdn/shop/') && (src.includes('/files/') || src.includes('/products/'))) {
                    addSrc(src);
                }
            });

            // Also check srcset for higher-res versions
            document.querySelectorAll('img[srcset], source[srcset]').forEach((el) => {
                const srcset = el.getAttribute('srcset') || '';
                // Get the largest image from srcset
                const entries = srcset.split(',').map(s => s.trim());
                const last = entries[entries.length - 1]?.split(' ')[0];
                if (last && last.includes('cdn/shop/')) addSrc(last);
            });

            // Parse Shopify product JSON from inline scripts (covers dynamically loaded images)
            if (images.size <= 1) {
                const scripts = document.querySelectorAll('script:not([src])');
                for (const script of scripts) {
                    const text = script.textContent || '';
                    // Match all cdn/shop image URLs in JSON
                    const srcMatches = text.matchAll(/"((?:https?:)?\/\/[^"]*cdn\/shop\/[^"]*\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"/gi);
                    for (const match of srcMatches) {
                        if (match[1]) addSrc(match[1]);
                    }
                }
            }

            // Fallback: og:image
            if (images.size === 0) {
                const og = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
                if (og) addSrc(og);
            }

            return Array.from(images).slice(0, 30);
        }

        function extractDescription(): string {
            // Use productData.description (HTML string)
            if (productData?.description) {
                const tmp = document.createElement('div');
                tmp.innerHTML = productData.description;
                return formatDescriptionHtml(tmp);
            }

            // Fallback: page DOM
            const descEl = document.querySelector('[itemprop="description"], .product-description, .product__description');
            if (descEl?.textContent?.trim()) {
                return formatDescriptionHtml(descEl as HTMLElement);
            }

            return '';
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

            // Tribesigns uses table.spc_table for specs
            document.querySelectorAll('table.spc_table, table[class*="spec"], table[class*="spc"]').forEach((table) => {
                table.querySelectorAll('tr').forEach((row) => {
                    const cells = row.querySelectorAll('th, td');
                    if (cells.length >= 2) {
                        addAttr(cells[0].textContent || '', cells[1].textContent || '');
                    }
                });
            });

            // Also try JSON-LD for brand/model
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (const script of scripts) {
                try {
                    const data = JSON.parse(script.textContent || '');
                    if (data['@type'] === 'Product') {
                        if (data.brand?.name) addAttr('Marke', data.brand.name);
                        if (data.sku) addAttr('SKU', data.sku);
                        if (data.aggregateRating?.ratingValue) {
                            addAttr('Bewertung', `${data.aggregateRating.ratingValue}/5 (${data.aggregateRating.reviewCount || ''} Bewertungen)`);
                        }
                    }
                } catch { /* skip */ }
            }

            return attrs;
        }

        function extractPrice(): { price: string; currency: string } {
            // From Shopify productData (price in cents)
            if (productData?.variants?.[0]?.price) {
                const cents = productData.variants[0].price;
                const euros = (cents / 100).toFixed(2).replace('.', ',');
                return { price: `€${euros}`, currency: 'EUR' };
            }

            // Fallback: JSON-LD
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (const script of scripts) {
                try {
                    const data = JSON.parse(script.textContent || '');
                    const offer = data?.offers?.[0] || data?.offers;
                    if (offer?.price) {
                        return { price: String(offer.price), currency: offer.priceCurrency || 'EUR' };
                    }
                } catch { /* skip */ }
            }

            // Fallback: DOM
            const priceEl = document.querySelector('.price--sale .price-item--sale, .price .price-item, [class*="price"] [class*="sale"]');
            if (priceEl?.textContent?.trim()) {
                return { price: priceEl.textContent.trim(), currency: 'EUR' };
            }

            return { price: '', currency: '' };
        }

        function extractSku(): string {
            if (productData?.variants?.[0]?.sku) return productData.variants[0].sku;
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (const script of scripts) {
                try {
                    const data = JSON.parse(script.textContent || '');
                    if (data['@type'] === 'Product' && data.sku) return data.sku;
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
    }, {
        formatDescriptionHtmlStr: formatDescriptionHtml.toString(),
    });

    // Fall back to generic for missing fields
    const genericData = await extractGeneric(page, url);

    return {
        url,
        title: tsData.title !== 'Untitled Product' ? tsData.title : genericData.title,
        images: tsData.images.length > 0 ? tsData.images : genericData.images,
        description: tsData.description || genericData.description,
        attributes: { ...genericData.attributes, ...tsData.attributes },
        price: tsData.price || genericData.price,
        currency: tsData.currency || genericData.currency,
        ean: tsData.ean || genericData.ean,
        sku: tsData.sku || genericData.sku,
    };
};
