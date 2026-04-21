import type { SiteExtractor } from '../scraper-types';
import { formatDescriptionHtml } from './utils';
import { extractGeneric } from './generic';

export const extractCostway: SiteExtractor = async (page, url) => {
    const cwData = await page.evaluate(({ formatDescriptionHtmlStr }) => {
        const formatDescriptionHtml = new Function('return ' + formatDescriptionHtmlStr)() as (element: HTMLElement) => string;

        function extractTitle(): string {
            const h1 = document.querySelector('.product-info-main h1, h1');
            return h1?.textContent?.trim() || 'Untitled Product';
        }

        function extractImages(): string[] {
            const images = new Set<string>();

            // Magento gallery images
            document.querySelectorAll('.product-img img, .gallery-placeholder img, .fotorama__stage img, [data-gallery-role="gallery"] img').forEach((img) => {
                const el = img as HTMLImageElement;
                const src = el.dataset.src || el.dataset.lazySrc || el.getAttribute('data-zoom-image') || el.src;
                if (src && !src.includes('1x1') && !src.includes('placeholder') && !src.includes('sprite')) {
                    const fullUrl = src.startsWith('http') ? src : new URL(src, window.location.origin).href;
                    images.add(fullUrl);
                }
            });

            // Thumbnail images often have full-size URLs in data attributes
            document.querySelectorAll('.img-row img, .product-image-thumbs img, [class*="thumb"] img').forEach((img) => {
                const el = img as HTMLImageElement;
                const src = el.dataset.src || el.src;
                if (src && !src.includes('1x1') && !src.includes('placeholder')) {
                    const fullUrl = src.startsWith('http') ? src : new URL(src, window.location.origin).href;
                    images.add(fullUrl);
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
            // Magento description tab
            const descEl = document.querySelector('#description, .product.data.items .item.content, [data-role="content"]');
            if (descEl?.textContent?.trim() && descEl.textContent.trim().length > 30) {
                return formatDescriptionHtml(descEl as HTMLElement);
            }

            // Fallback: product info
            const productDesc = document.querySelector('.product.attribute.description, [itemprop="description"]');
            if (productDesc?.textContent?.trim()) {
                return formatDescriptionHtml(productDesc as HTMLElement);
            }

            // Fallback: meta
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

            // Magento product attributes table
            document.querySelectorAll('.additional-attributes tr, .product-attributes tr, table.data tr').forEach((row) => {
                const cells = row.querySelectorAll('th, td');
                if (cells.length >= 2) {
                    addAttr(cells[0].textContent || '', cells[1].textContent || '');
                }
            });

            // Parse specs from description content (Costway embeds specs as <strong>Key:</strong> Value)
            const descEl = document.querySelector('#description, .product.data.items .item.content');
            if (descEl) {
                const strongEls = descEl.querySelectorAll('strong, b');
                strongEls.forEach((strong) => {
                    const label = strong.textContent?.trim().replace(/:$/, '') || '';
                    let valueText = '';
                    let sibling = strong.nextSibling;
                    while (sibling) {
                        if (sibling.nodeType === Node.TEXT_NODE) {
                            valueText += sibling.textContent || '';
                        } else if (sibling.nodeType === Node.ELEMENT_NODE) {
                            const el = sibling as HTMLElement;
                            if (el.tagName === 'STRONG' || el.tagName === 'B' || el.tagName === 'BR') break;
                            valueText += el.textContent || '';
                        }
                        sibling = sibling.nextSibling;
                    }
                    valueText = valueText.trim().replace(/^[:\s]+/, '');
                    if (label && valueText && label.length < 80) {
                        addAttr(label, valueText);
                    }
                });
            }

            // JSON-LD
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (const script of scripts) {
                try {
                    const data = JSON.parse(script.textContent || '');
                    if (data['@type'] === 'Product') {
                        if (data.brand?.name) addAttr('Marke', data.brand.name);
                        if (data.sku) addAttr('SKU', data.sku);
                    }
                } catch { /* skip */ }
            }

            return attrs;
        }

        function extractPrice(): { price: string; currency: string } {
            // Sale price first
            const saleEl = document.querySelector('.special-price .price, .price-final_price .price');
            if (saleEl?.textContent?.trim()) {
                return { price: saleEl.textContent.trim(), currency: 'EUR' };
            }

            // Regular price
            const priceEl = document.querySelector('.price-wrapper .price, .product-info-price .price, [itemprop="price"]');
            if (priceEl?.textContent?.trim()) {
                return { price: priceEl.textContent.trim(), currency: 'EUR' };
            }

            // JSON-LD
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

            return { price: '', currency: '' };
        }

        function extractSku(): string {
            const skuEl = document.querySelector('[itemprop="sku"], .product.attribute.sku .value');
            if (skuEl?.textContent?.trim()) return skuEl.textContent.trim();
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
        title: cwData.title !== 'Untitled Product' ? cwData.title : genericData.title,
        images: cwData.images.length > 0 ? cwData.images : genericData.images,
        description: cwData.description || genericData.description,
        attributes: { ...genericData.attributes, ...cwData.attributes },
        price: cwData.price || genericData.price,
        currency: cwData.currency || genericData.currency,
        ean: cwData.ean || genericData.ean,
        sku: cwData.sku || genericData.sku,
    };
};
