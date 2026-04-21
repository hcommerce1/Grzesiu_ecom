import type { SiteExtractor } from '../scraper-types';

export const extractAllegro: SiteExtractor = async (page, url) => {
    // Wait for page hydration
    await page.waitForSelector('[data-box-name], h1', { timeout: 10000 }).catch(() => {});

    const data = await page.evaluate(() => {
        // 1. dataLayer — SSR-rendered JSON, most reliable source
        const dl = (window as any).dataLayer?.[0] ?? {};
        const title: string = dl.offerName ?? document.querySelector('h1')?.textContent?.trim() ?? '';
        const price: string = dl.price != null ? String(dl.price) : '';
        const currency: string = dl.currency ?? 'PLN';
        const sku: string = dl.idItem ?? '';

        // 2. Images — priorytet: JSON galerii z hydration data
        const galleryImages: string[] = [];

        // Szukaj JSON galerii w inline scripts (React SSR hydration)
        // Format: "original":"https:\u002F\u002Fa.allegroimg.com\u002Foriginal\u002F..."
        document.querySelectorAll('script:not([src])').forEach((script) => {
            const text = script.textContent || '';
            // Szukaj wzorca "original":"url" z allegroimg.com
            const matches = text.matchAll(/"original"\s*:\s*"(https?:[^"]*allegroimg\.com[^"]*)"/gi);
            for (const match of matches) {
                let imgUrl = match[1];
                // Dekoduj \u002F → /
                imgUrl = imgUrl.replace(/\\u002F/g, '/');
                if (imgUrl && imgUrl.includes('/original/') && !galleryImages.includes(imgUrl)) {
                    galleryImages.push(imgUrl);
                }
            }
        });

        // Jeśli JSON galerii znaleziony — używamy go jako jedynego źródła
        let images: string[];
        if (galleryImages.length > 0) {
            images = galleryImages.slice(0, 30);
        } else {
            // Fallback: zbierz z DOM (og:image, preload, img tags)
            const imgSet = new Set<string>();

            const ogImg = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
            if (ogImg) imgSet.add(ogImg);

            document.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]').forEach((l) => {
                if (l.href?.includes('allegroimg.com')) imgSet.add(l.href);
            });

            document.querySelectorAll<HTMLImageElement>('img[src*="allegroimg.com"]').forEach((img) => {
                const src = img.src || img.dataset.src || '';
                if (src && !src.includes('1x1') && !src.includes('sprite')) imgSet.add(src);
            });

            document.querySelectorAll('[data-src*="allegroimg.com"], [srcset*="allegroimg.com"]').forEach((el) => {
                const dataSrc = el.getAttribute('data-src') || '';
                if (dataSrc && dataSrc.includes('allegroimg.com')) imgSet.add(dataSrc);
                const srcset = el.getAttribute('srcset') || '';
                srcset.split(',').forEach((s: string) => {
                    const imgUrl = s.trim().split(/\s+/)[0];
                    if (imgUrl?.includes('allegroimg.com')) imgSet.add(imgUrl);
                });
            });

            // Filtruj i deduplikuj fallback images
            const uiPatterns = [
                'action-common-', 'action-', 'illustration-', 'information-',
                'brand-subbrand-', 'thank-you-page-', 'dark-illustration-',
                'question-', 'star-full', 'star-empty', 'star-half',
                'round-tick', 'badge-check', 'arrowhead-', 'heart-',
                'share-', 'weighing-scale', 'flame-', 'low-price-',
                'company-', 'smart-',
            ];

            const ogImgUrl = document.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';
            const ogSlug = ogImgUrl.split('/').pop()?.toLowerCase() || '';

            const filtered = Array.from(imgSet).filter(u => {
                const lower = u.toLowerCase();
                if (!lower.includes('allegroimg.com')) return false;
                const sizeMatch = lower.match(/\/s(\d+)\//);
                if (sizeMatch) {
                    const size = parseInt(sizeMatch[1]);
                    if (size < 150) return false;
                    if (size <= 400 && ogSlug) {
                        const urlSlug = lower.split('/').pop() || '';
                        if (urlSlug && ogSlug && urlSlug !== ogSlug && !urlSlug.startsWith(ogSlug.substring(0, 20))) {
                            return false;
                        }
                    }
                }
                if (uiPatterns.some(p => lower.includes(p))) return false;
                if (lower.includes('/user/') || lower.includes('/avatar')) return false;
                if (lower.includes('/logo')) return false;
                if (lower.includes('/category/') || lower.includes('/banner/')) return false;
                const pathOnly = lower.split('?')[0];
                if (pathOnly.endsWith('.svg') || pathOnly.endsWith('.ico')) return false;
                if (lower.includes('ismultibrand')) return false;
                return true;
            });

            // Deduplikacja — /original/ > /s720/ > /s512/ itd.
            const byBase = new Map<string, string>();
            for (const u of filtered) {
                const base = u.replace(/\/(original|s\d+)\//, '/SIZE/');
                const existing = byBase.get(base);
                if (!existing) {
                    byBase.set(base, u);
                } else if (u.includes('/original/')) {
                    byBase.set(base, u);
                } else if (!existing.includes('/original/')) {
                    const existingSize = parseInt(existing.match(/\/s(\d+)\//)?.[1] || '0');
                    const newSize = parseInt(u.match(/\/s(\d+)\//)?.[1] || '0');
                    if (newSize > existingSize) byBase.set(base, u);
                }
            }
            images = Array.from(byBase.values()).slice(0, 30);
        }

        // 3. Description
        const descEl =
            document.querySelector('[data-box-name="Description"]') ??
            document.querySelector('[data-box-name*="escription"]');
        const description: string =
            (descEl as HTMLElement | null)?.innerText?.trim() ??
            document.querySelector('meta[name="description"]')?.getAttribute('content') ??
            '';

        // 4. Parameters/attributes
        const attributes: Record<string, string> = {};
        const paramsBox =
            document.querySelector('[data-box-name="Parameters"]') ??
            document.querySelector('[data-box-name*="aram"]');
        if (paramsBox) {
            paramsBox.querySelectorAll('li, tr').forEach((row) => {
                const spans = row.querySelectorAll('span, td, dt, dd');
                if (spans.length >= 2) {
                    const k = spans[0].textContent?.trim() ?? '';
                    const v = spans[1].textContent?.trim() ?? '';
                    if (k && v && k !== v && k.length < 100 && v.length < 500) {
                        attributes[k] = v;
                    }
                }
            });
        }

        // 5. Category from breadcrumbs
        let sourceCategory = '';
        const breadcrumbEl = document.querySelector('[data-box-name="Breadcrumb"], nav[aria-label="breadcrumb"], [data-role="breadcrumb"]');
        if (breadcrumbEl) {
            const crumbs = Array.from(breadcrumbEl.querySelectorAll('a, span'))
                .map(el => el.textContent?.trim())
                .filter(Boolean);
            if (crumbs.length > 1) {
                sourceCategory = crumbs.slice(1).join(' > ');
            }
        }
        if (!sourceCategory) {
            const catMeta = document.querySelector('meta[property="product:category"]')?.getAttribute('content');
            if (catMeta) sourceCategory = catMeta;
        }

        // 6. EAN from body text
        const bodyText = document.body.textContent ?? '';
        const eanMatch = bodyText.match(/EAN[:\s]*(\d{8,13})/i);
        const ean: string = eanMatch?.[1] ?? '';

        return { title, price, currency, sku, images, description, attributes: { ...attributes, ...(sourceCategory ? { _sourceCategory: sourceCategory } : {}) }, ean };
    });

    return { ...data, url };
};
