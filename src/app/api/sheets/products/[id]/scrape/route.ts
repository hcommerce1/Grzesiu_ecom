import { NextRequest, NextResponse } from 'next/server';
import { getProductById, setProductStatus } from '@/lib/db';
import { scrapeProduct } from '@/lib/scraper';
import { translateProduct } from '@/lib/translator';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

/**
 * POST /api/sheets/products/[id]/scrape
 * Scrape the product URL and translate, updating status along the way.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const product = getProductById(id);

  if (!product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  }

  if (!product.scrape_url) {
    return NextResponse.json({ error: 'No scrape URL set for this product' }, { status: 400 });
  }

  // Read optional systemPrompt from body
  let systemPrompt = '';
  try {
    const body = await request.json();
    if (body.systemPrompt) systemPrompt = body.systemPrompt;
  } catch {
    // empty body is fine
  }

  // Set status to scraping
  setProductStatus(id, 'scraping', { error_message: undefined });

  try {
    const result = await scrapeProduct(product.scrape_url);

    if (!result.success) {
      setProductStatus(id, 'error', { error_message: result.error });
      return NextResponse.json(
        { error: result.error, errorType: result.errorType },
        { status: 500 }
      );
    }

    // Translate
    let translatedData = result.data;
    let originalData = result.data;
    try {
      translatedData = await translateProduct(result.data, systemPrompt);
      originalData = result.data;
    } catch (translateErr) {
      console.warn('Translation failed for sheet product:', translateErr);
      // Continue with untranslated data — not a fatal error
    }

    // Enrich with sheet data: EAN, SKU, weight, dimensions, location
    if (product.ean && !translatedData.ean) translatedData.ean = product.ean;
    if (product.sku && !translatedData.sku) translatedData.sku = product.sku;

    // Store sheet-specific data in attributes for payload building
    const attrs = translatedData.attributes ?? {};
    if (product.waga) attrs['waga'] = product.waga;
    if (product.dlugosc) attrs['dlugosc'] = product.dlugosc;
    if (product.szerokosc) attrs['szerokosc'] = product.szerokosc;
    if (product.wysokosc) attrs['wysokosc'] = product.wysokosc;
    if (product.lokalizacja) attrs['lokalizacja'] = product.lokalizacja;
    translatedData.attributes = attrs;

    // Update status
    setProductStatus(id, 'in_progress');

    return NextResponse.json({
      success: true,
      data: translatedData,
      originalData,
      sheetMeta: {
        uwagiKrotkie: product.uwagi_krotkie ?? '',
        uwagiMagazynowe: product.uwagi_magazynowe ?? '',
        zdjecie: product.zdjecie ?? '',
        paleta: product.paleta ?? '',
        stanTechniczny: product.stan_techniczny ?? '',
        kolor: product.kolor ?? '',
        opakowanie: product.opakowanie ?? '',
        rozmiarGabaryt: product.rozmiar_gabaryt ?? '',
        model: product.model ?? '',
        waga: product.waga ?? '',
        dlugosc: product.dlugosc ?? '',
        szerokosc: product.szerokosc ?? '',
        wysokosc: product.wysokosc ?? '',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown scraping error';
    setProductStatus(id, 'error', { error_message: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
