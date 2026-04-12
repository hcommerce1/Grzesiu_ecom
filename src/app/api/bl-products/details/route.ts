import { NextRequest, NextResponse } from 'next/server';
import { getInventoryProductsData } from '@/lib/baselinker';
import { getBLCache } from '@/lib/bl-cache';
import {
  getCachedProductDetails,
  setCachedProductDetails,
} from '@/lib/product-details-cache';

interface FullProduct {
  name: string;
  ean: string;
  sku: string;
  quantity: number;
  price_brutto: number;
  images: Record<string, string>;
  manufacturer_id: number;
  is_bundle: boolean;
  variants?: Record<string, unknown>;
  stock?: Record<string, number>;
  tax_rate?: number;
  locations?: Record<string, string>;
  text_fields?: Record<string, string>;
}

/**
 * POST /api/bl-products/details
 * Fetches full product data for a batch of IDs (images, manufacturer, price, etc.)
 * Called progressively by the client after the fast list loads.
 * Results are cached for 1 hour per product.
 */
export async function POST(req: NextRequest) {
  try {
    const { inventory_id, product_ids } = (await req.json()) as {
      inventory_id: number;
      product_ids: string[];
    };

    if (!inventory_id || !Array.isArray(product_ids) || product_ids.length === 0) {
      return NextResponse.json({ error: 'Missing inventory_id or product_ids' }, { status: 400 });
    }

    // Cap batch size at 100 (BaseLinker limit)
    const ids = product_ids.slice(0, 100);

    // Check cache first — only fetch missing products from API
    const { cached, missing } = getCachedProductDetails(ids);
    let allProducts: Record<string, FullProduct> = cached as unknown as Record<string, FullProduct>;

    if (missing.length > 0) {
      const res = await getInventoryProductsData(missing, inventory_id, 'low') as {
        products: Record<string, FullProduct>;
      };
      const freshProducts = res.products ?? {};
      setCachedProductDetails(freshProducts as unknown as Record<string, Record<string, unknown>>);
      allProducts = { ...allProducts, ...freshProducts };
    }

    // Build manufacturer lookup
    const cache = await getBLCache(inventory_id);
    const manufacturerMap = new Map<number, string>();
    for (const m of cache.manufacturers) {
      manufacturerMap.set(m.manufacturer_id, m.name);
    }

    // Build detail map
    const details: Record<string, {
      thumbnailUrl: string | null;
      manufacturerId: number;
      manufacturerName: string;
      price: number;
      isBundle: boolean;
      variantIds: string[];
      stock: Record<string, number>;
      taxRate: number;
      locations: Record<string, string>;
      textFields: Record<string, string>;
      quantity: number;
    }> = {};

    for (const [id, product] of Object.entries(allProducts)) {
      const images = product.images ? Object.values(product.images) : [];
      const variantIds = product.variants && typeof product.variants === 'object'
        ? Object.keys(product.variants)
        : [];
      details[id] = {
        thumbnailUrl: images[0] ?? null,
        manufacturerId: product.manufacturer_id ?? 0,
        manufacturerName: manufacturerMap.get(product.manufacturer_id) ?? '',
        price: product.price_brutto ?? 0,
        isBundle: !!product.is_bundle,
        variantIds,
        stock: product.stock ?? {},
        taxRate: product.tax_rate ?? 23,
        locations: product.locations ?? {},
        textFields: product.text_fields ?? {},
        quantity: product.quantity ?? 0,
      };
    }

    return NextResponse.json({ details });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
