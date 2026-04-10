import type { SiteExtractor } from '../types';

export const extractAmazon: SiteExtractor = async (page, url) => {
    return await page.evaluate((urlArg) => {
        function extractTitle(): string {
            const amazonTitle = document.querySelector('#productTitle');
            if (amazonTitle?.textContent?.trim()) return amazonTitle.textContent.trim();
            const dataTitle = document.querySelector('[data-feature-name="title"] span, [data-automation-id="title"]');
            if (dataTitle?.textContent?.trim()) return dataTitle.textContent.trim();
            return 'Untitled Amazon Product';
        }

        function extractImages(): string[] {
            const images = new Set<string>();
            const scripts = Array.from(document.querySelectorAll('script'));
            for (const script of scripts) {
                const text = script.textContent || '';
                const matches = text.matchAll(/"(?:hiRes|large)"\s*:\s*"(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi);
                for (const match of matches) {
                    if (match[1] && !match[1].includes('sprite') && !match[1].includes('transparent')) {
                        images.add(match[1]);
                    }
                }
            }
            const amazonImgs = document.querySelectorAll('#altImages img, #imageBlock img, #imgTagWrapperId img');
            amazonImgs.forEach((img) => {
                const src = (img as HTMLImageElement).src;
                if (src && !src.includes('sprite') && !src.includes('transparent') && !src.includes('grey-pixel')) {
                    const hiRes = src.replace(/\._[A-Z]{2}\d+_\./, '.');
                    images.add(hiRes);
                }
            });
            return Array.from(images).slice(0, 30);
        }

        function extractDescription(): string {
            const parts: string[] = [];
            const featureBullets = document.querySelector('#feature-bullets');
            if (featureBullets) {
                const items = featureBullets.querySelectorAll('li span.a-list-item');
                const bulletTexts: string[] = [];
                items.forEach((item) => {
                    const t = item.textContent?.trim();
                    if (t && t.length > 5 && !t.toLowerCase().includes('see more')) {
                        bulletTexts.push('• ' + t);
                    }
                });
                if (bulletTexts.length > 0) parts.push('Key Features:\n' + bulletTexts.join('\n'));
            }

            const productDesc = document.querySelector('#productDescription');
            if (productDesc?.textContent?.trim()) {
                const cleaned = productDesc.textContent.trim().replace(/\s+/g, ' ');
                if (cleaned.length > 30) parts.push(cleaned);
            }

            const aplusSection = document.querySelector('#aplus_feature_div, #aplus, .aplus-v2');
            if (aplusSection) {
                const aplusTexts: string[] = [];
                const modules = aplusSection.querySelectorAll('.aplus-module, [class*="aplus"] .celwidget, .apm-tablemodule-table, [class*="aplus"] p, [class*="aplus"] h3, [class*="aplus"] h4, [class*="aplus"] li');
                if (modules.length > 0) {
                    modules.forEach((mod) => {
                        const text = mod.textContent?.trim();
                        if (text && text.length > 10) {
                            const normalized = text.replace(/\s+/g, ' ');
                            if (!aplusTexts.some(existing => existing.includes(normalized) || normalized.includes(existing))) {
                                aplusTexts.push(normalized);
                            }
                        }
                    });
                } else {
                    const fullText = aplusSection.textContent?.trim();
                    if (fullText && fullText.length > 30) {
                        aplusTexts.push(fullText.replace(/\s+/g, ' ').replace(/\n\s*\n/g, '\n'));
                    }
                }
                if (aplusTexts.length > 0) parts.push('Product Description:\n' + aplusTexts.join('\n\n'));
            }

            return parts.join('\n\n');
        }

        function extractAttributes(): Record<string, string> {
            const attrs: Record<string, string> = {};
            function addAttr(key: string, value: string) {
                const k = key.trim().replace(/\s+/g, ' ');
                const v = value.trim().replace(/\s+/g, ' ');
                if (k && v && k.length < 100 && v.length < 500 && k !== v) attrs[k] = v;
            }

            const overviewTable = document.querySelector('#productOverview_feature_div');
            if (overviewTable) {
                const rows = overviewTable.querySelectorAll('tr');
                rows.forEach((row) => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length >= 2) addAttr(cells[0].textContent || '', cells[1].textContent || '');
                });
                const labels = overviewTable.querySelectorAll('.a-text-bold, .po-break-word');
                for (let i = 0; i < labels.length - 1; i += 2) {
                    addAttr(labels[i].textContent || '', labels[i + 1].textContent || '');
                }
            }

            const detailRows = document.querySelectorAll(
                '#productDetails_techSpec_section_1 tr, ' +
                '#productDetails_detailBullets_sections1 tr, ' +
                '#productDetails_db_sections tr, ' +
                '.prodDetTable tr, ' +
                '#poExpander table tr, ' +
                '#detailBulletsWrapper_feature_div table tr, ' +
                '#productDetails_feature_div table tr, .a-keyvalue tr'
            );
            detailRows.forEach((row) => {
                const cells = row.querySelectorAll('th, td');
                if (cells.length >= 2) addAttr(cells[0].textContent || '', cells[1].textContent || '');
            });

            const bullets = document.querySelectorAll('#detailBullets_feature_div li, .detail-bullet-list li');
            bullets.forEach((li) => {
                const spans = li.querySelectorAll('span span');
                if (spans.length >= 2) {
                    addAttr(spans[0].textContent?.replace(/[:\s]+$/, '') || '', spans[1].textContent || '');
                } else {
                    const text = li.textContent?.trim() || '';
                    const sepMatch = text.match(/^(.+?)\s*[:\u200F\u200E]\s*(.+)$/);
                    if (sepMatch) addAttr(sepMatch[1], sepMatch[2]);
                }
            });

            return attrs;
        }

        function extractPrice(): { price: string; currency: string } {
            const priceSelectors = [
                '.a-price .a-offscreen', '#priceblock_ourprice', '#priceblock_dealprice', '.a-price-whole', '[data-feature-name="priceInsideBuyBox"]'
            ];
            for (const sel of priceSelectors) {
                const el = document.querySelector(sel);
                const raw = el?.textContent?.trim() || '';
                if (raw) {
                    const match = raw.match(/([$€£¥zł])\s*([\d.,]+)/);
                    if (match) return { currency: match[1], price: match[2] };
                    const match2 = raw.match(/([\d.,]+)\s*([$€£¥zł]|PLN|EUR|USD)/);
                    if (match2) return { currency: match2[2], price: match2[1] };
                    const numMatch = raw.match(/([\d.,]+)/);
                    if (numMatch) return { price: numMatch[1], currency: '' };
                }
            }
            return { price: '', currency: '' };
        }

        function extractEan(): string {
            const body = document.body.textContent || '';
            const eanMatch = body.match(/EAN[:\s]*(\d{8,13})/i);
            if (eanMatch) return eanMatch[1];
            return '';
        }

        function extractSku(): string {
            return ''; // Normally Amazon relies on ASINs, not generic SKUs.
        }

        return {
            title: extractTitle(),
            images: extractImages(),
            description: extractDescription(),
            attributes: extractAttributes(),
            ...extractPrice(),
            ean: extractEan(),
            sku: extractSku(),
            url: urlArg,
        };
    }, url);
};
