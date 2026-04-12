const APIFY_TOKEN = process.env.APIFY_TOKEN || '';

/**
 * Konwertuje Amazon ASIN na EAN/UPC za pomocą Apify API.
 * Zwraca EAN jako string lub pusty string jeśli nie znaleziono.
 */
export async function convertAsinToEan(asin: string): Promise<string> {
    if (!APIFY_TOKEN) {
        console.warn('[ASIN→EAN] Brak APIFY_TOKEN — pominięto konwersję');
        return '';
    }
    if (!asin || asin.length !== 10) {
        console.warn(`[ASIN→EAN] Nieprawidłowy ASIN: "${asin}"`);
        return '';
    }

    console.log(`[ASIN→EAN] Konwersja ASIN ${asin}...`);

    try {
        // Uruchom actor synchronicznie (waitForFinish=120s)
        const runRes = await fetch(
            `https://api.apify.com/v2/acts/easyparser~asin-to-ean-converter/runs?waitForFinish=120`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${APIFY_TOKEN}`,
                },
                body: JSON.stringify({ asin }),
                signal: AbortSignal.timeout(130000),
            },
        );

        if (!runRes.ok) {
            console.error(`[ASIN→EAN] Apify run error: HTTP ${runRes.status}`);
            return '';
        }

        const runData = await runRes.json();
        const datasetId = runData?.data?.defaultDatasetId;
        if (!datasetId) {
            console.warn('[ASIN→EAN] Brak datasetId w odpowiedzi Apify');
            return '';
        }

        // Pobierz wyniki z datasetu
        const dataRes = await fetch(
            `https://api.apify.com/v2/datasets/${datasetId}/items?format=json`,
            {
                headers: { Authorization: `Bearer ${APIFY_TOKEN}` },
                signal: AbortSignal.timeout(10000),
            },
        );

        if (!dataRes.ok) {
            console.error(`[ASIN→EAN] Apify dataset error: HTTP ${dataRes.status}`);
            return '';
        }

        const items = await dataRes.json();
        if (!Array.isArray(items) || items.length === 0) {
            console.log(`[ASIN→EAN] Brak wyników dla ASIN ${asin}`);
            return '';
        }

        // Szukaj EAN/UPC/GTIN w wynikach
        const item = items[0];
        const ean = item.ean || item.EAN || item.upc || item.UPC || item.gtin || item.GTIN || item.barcode || '';
        if (ean) {
            console.log(`[ASIN→EAN] Znaleziono: ASIN ${asin} → EAN ${ean}`);
        } else {
            console.log(`[ASIN→EAN] Nie znaleziono EAN dla ASIN ${asin}`);
        }
        return String(ean);
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[ASIN→EAN] Błąd: ${msg}`);
        return '';
    }
}
