import type { SiteExtractor } from '../types';

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

        // 2. Images — collect from og:image, preload hints, and gallery
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

        const images = Array.from(imgSet).slice(0, 30);

        // 3. Description — data-box-name attribute is stable across Allegro redesigns
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
                // Skip "Allegro" / first item, take the rest
                sourceCategory = crumbs.slice(1).join(' > ');
            }
        }
        if (!sourceCategory) {
            // Fallback: try meta or dataLayer
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
