import type { SiteExtractor } from '../scraper-types';
import { formatDescriptionHtml } from './utils';
import { extractGeneric } from './generic';

export const extractDWD: SiteExtractor = async (page, url) => {
    const dwdData = await page.evaluate(({ formatDescriptionHtmlStr }) => {
        const formatDescriptionHtml = new Function('return ' + formatDescriptionHtmlStr)() as (element: HTMLElement) => string;

        function normalizeText(value: string): string {
            return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        }

        function cleanBulletLabel(value: string): string {
            return normalizeText(value)
                .replace(/^[-•*]\s*/, '')
                .replace(/[:\-–]\s*$/, '');
        }

        function parseStructuredDescription(descriptionRoot: HTMLElement | null): {
            description: string;
            attributes: Record<string, string>;
        } {
            const attributes: Record<string, string> = {};
            const descriptionLines: string[] = [];

            const addAttr = (key: string, value: string) => {
                const normalizedKey = cleanBulletLabel(key);
                const normalizedValue = normalizeText(value);
                if (
                    normalizedKey &&
                    normalizedValue &&
                    normalizedKey !== normalizedValue &&
                    normalizedKey.length < 100 &&
                    normalizedValue.length < 500
                ) {
                    attributes[normalizedKey] = normalizedValue;
                }
            };

            if (!descriptionRoot) {
                return { description: '', attributes };
            }

            const lines = descriptionRoot.innerText
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean);

            let currentSection = '';
            let pendingSectionItems: string[] = [];

            const flushPendingSection = () => {
                if (currentSection && pendingSectionItems.length > 0) {
                    addAttr(currentSection, pendingSectionItems.join('; '));
                }
                pendingSectionItems = [];
            };

            for (const rawLine of lines) {
                const line = normalizeText(rawLine);
                if (!line) continue;

                const isSectionHeader = /^[^:]{2,80}:$/.test(line) && !/^[-•*]/.test(line);
                if (isSectionHeader) {
                    flushPendingSection();
                    currentSection = cleanBulletLabel(line);
                    continue;
                }

                const bulletLine = /^[-•*]\s*(.+)$/.exec(line);
                if (bulletLine) {
                    const bulletText = bulletLine[1].trim();
                    const keyValueMatch = /^([^:]{2,100}):\s*(.+)$/.exec(bulletText);
                    if (keyValueMatch) {
                        addAttr(keyValueMatch[1], keyValueMatch[2]);
                    } else if (/^(zalety produktu|material|zawartość zestawu)$/i.test(currentSection)) {
                        if (/^zawartość zestawu$/i.test(currentSection)) {
                            pendingSectionItems.push(cleanBulletLabel(bulletText));
                        } else {
                            addAttr(bulletText, 'Tak');
                        }
                    } else if (currentSection) {
                        pendingSectionItems.push(cleanBulletLabel(bulletText));
                    } else {
                        descriptionLines.push(`• ${bulletText}`);
                    }
                    continue;
                }

                flushPendingSection();
                currentSection = '';
                descriptionLines.push(line);
            }

            flushPendingSection();

            return {
                description: descriptionLines.join('\n\n').trim(),
                attributes,
            };
        }

        function extractTitle(): string {
            const el = document.querySelector('h1.product-title, h1[class*="product"]');
            return el?.textContent?.trim() || 'Untitled Product';
        }

        function extractImages(): string[] {
            const images = new Set<string>();
            const shopGalleryImgs = document.querySelectorAll('.s360-product-gallery-thumb img, .product-gallery img, .gallery-container img, [class*="gallery"] img');
            shopGalleryImgs.forEach((img) => {
                const el = img as HTMLImageElement;
                const src = el.getAttribute('data-zoom') || el.getAttribute('data-src') || el.getAttribute('data-full') || el.src;
                if (src && !src.includes('sprite') && !src.includes('1x1') && !src.includes('placeholder')) {
                    const fullUrl = src.startsWith('http') ? src : new URL(src, window.location.origin).href;
                    images.add(fullUrl);
                }
            });
            return Array.from(images).slice(0, 30);
        }

        function extractDescription(): string {
            let dwdText = '';
            const dwdHighlights = document.querySelector('.product-info-short-description');
            if (dwdHighlights) {
                dwdText += "Highlights:\n" + formatDescriptionHtml(dwdHighlights as HTMLElement) + "\n\n";
            }
            const dwdMainDesc = document.querySelector('.product-info-description');
            if (dwdMainDesc) {
                const parsed = parseStructuredDescription(dwdMainDesc as HTMLElement);
                if (parsed.description) {
                    dwdText += "Beschreibung:\n" + parsed.description;
                }
                const metadataElements = document.querySelectorAll('.product-info-main .product-info-wrapper > div');
                if (metadataElements.length > 0) {
                    dwdText += "\n\nMetadaten:\n";
                    metadataElements.forEach(el => {
                        const text = normalizeText((el as HTMLElement).innerText);
                        if (text && !text.toLowerCase().includes('bewertung') && !text.toLowerCase().includes('inkl. mwst')) {
                            dwdText += "- " + text + "\n";
                        }
                    });
                }
                return dwdText.trim();
            }

            const tabDesc = document.querySelector('#tab-description, .tab-description, [data-tab="description"]');
            if (tabDesc?.textContent?.trim()) {
                const cleaned = tabDesc.textContent.trim().replace(/\s+/g, ' ');
                if (cleaned.length > 30) return cleaned;
            }

            return '';
        }

        function extractAttributes(): Record<string, string> {
            const attrs: Record<string, string> = {};
            function addAttr(key: string, value: string) {
                const k = cleanBulletLabel(key);
                const v = normalizeText(value);
                if (k && v && k.length < 100 && v.length < 500 && k !== v) attrs[k] = v;
            }

            const merkmaleTab = document.querySelector('#tab-attributes, .tab-attributes, [data-tab="attributes"]');
            if (merkmaleTab) {
                const mRows = merkmaleTab.querySelectorAll('tr, .attr-row');
                mRows.forEach((row) => {
                    const cells = row.querySelectorAll('th, td, .attr-label, .attr-value');
                    if (cells.length >= 2) addAttr(cells[0].textContent || '', cells[1].textContent || '');
                });
                const dtElements = merkmaleTab.querySelectorAll('dt');
                dtElements.forEach((dt) => {
                    const dd = dt.nextElementSibling;
                    if (dd && dd.tagName === 'DD') {
                        addAttr(dt.textContent || '', dd.textContent || '');
                    }
                });
                const spans = merkmaleTab.querySelectorAll('span');
                for (let i = 0; i < spans.length - 1; i += 2) {
                    const k = spans[i].textContent?.trim();
                    const v = spans[i + 1].textContent?.trim();
                    if (k && v && k.length < 80) addAttr(k, v);
                }
            }

            // Extract from description text lines (e.g. "- Abmessungen: 36 x 25 x 33 cm (TxBxH)")
            const desc = document.querySelector('.product-info-description');
            if (desc) {
                const parsed = parseStructuredDescription(desc as HTMLElement);
                Object.entries(parsed.attributes).forEach(([key, value]) => addAttr(key, value));
            }

            return attrs;
        }

        function extractPrice(): { price: string; currency: string } {
            const dwdPriceEl = document.querySelector('.product-info-price .price');
            if (dwdPriceEl) {
                return { price: (dwdPriceEl as HTMLElement).innerText.trim(), currency: 'EUR' };
            }
            return { price: '', currency: '' };
        }

        function extractEan(): string {
            return ''; // DWD may not have obvious EANs
        }

        function extractSku(): string {
            return ''; // We extract SKU usually via generic fallback or description text
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

    // Fall back to generic scraper for missing fields
    const genericData = await extractGeneric(page, url);

    return {
        url,
        title: dwdData.title !== 'Untitled Product' ? dwdData.title : genericData.title,
        images: dwdData.images.length > 0 ? dwdData.images : genericData.images,
        description: dwdData.description || genericData.description,
        attributes: { ...genericData.attributes, ...dwdData.attributes },
        price: dwdData.price || genericData.price,
        currency: dwdData.currency || genericData.currency,
        ean: dwdData.ean || genericData.ean,
        sku: dwdData.sku || genericData.sku,
    };
};
