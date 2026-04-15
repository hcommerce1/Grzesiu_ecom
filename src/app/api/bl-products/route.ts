import { NextRequest, NextResponse } from 'next/server';
import { callBaselinker, getInventories } from '@/lib/baselinker';
import { getCachedProductList, setCachedProductList } from '@/lib/db';
import type { BLProductListItem, BLProductType } from '@/lib/types';

interface ProductListPage {
  products: Record<string, Record<string, unknown>>;
}

async function getInventoryId(req: NextRequest): Promise<number> {
  const fromQuery = req.nextUrl.searchParams.get('inventory_id');
  if (fromQuery) return parseInt(fromQuery, 10);
  const inventories = await getInventories();
  const first = (inventories[0] as Record<string, unknown>)?.['inventory_id'] as number | undefined;
  if (first) return first;
  throw new Error('No inventory available — check your BaseLinker token');
}

/**
 * Fast product list — returns basic data from getInventoryProductsList only.
 * No getInventoryProductsData calls here — details are loaded progressively by the client.
 */
export async function GET(req: NextRequest) {
  try {
    const inventoryId = await getInventoryId(req);
    const force = req.nextUrl.searchParams.get('force') === 'true';

    // Check cache first (unless force refresh)
    if (!force) {
      const cached = getCachedProductList(inventoryId);
      if (cached) {
        return NextResponse.json(
          { products: cached.products, totalCount: cached.products.length, inventoryId, cachedAt: cached.cachedAt },
          { headers: { 'X-Cache': 'HIT' } }
        );
      }
    }

    const items: BLProductListItem[] = [];
    let page = 1;

    // Paginate through all products
    while (true) {
      const res = await callBaselinker<ProductListPage>(
        'getInventoryProductsList',
        { inventory_id: inventoryId, page }
      );

      const products = res.products ?? {};
      const keys = Object.keys(products);
      if (keys.length === 0) break;

      for (const [id, product] of Object.entries(products)) {
        // Detect variant IDs
        const variantIds: string[] = [];
        if (product.variants && typeof product.variants === 'object') {
          const vIds = Object.keys(product.variants as Record<string, unknown>);
          if (vIds.length > 0) {
            variantIds.push(...vIds);
          }
        }

        // Determine product type from list data
        let productType: BLProductType = 'basic';
        if (product.is_bundle) {
          productType = 'bundle';
        } else if (variantIds.length > 0) {
          productType = 'parent';
        }

        items.push({
          id,
          name: (product.name as string) ?? '',
          ean: (product.ean as string) ?? '',
          sku: (product.sku as string) ?? '',
          quantity: (product.quantity as number) ?? 0,
          price: 0,
          thumbnailUrl: null,
          manufacturerId: 0,
          manufacturerName: '',
          productType,
          isBundle: !!product.is_bundle,
        });

        // Add variants as separate rows
        if (product.variants && typeof product.variants === 'object') {
          for (const [vId, variant] of Object.entries(product.variants as Record<string, Record<string, unknown>>)) {
            items.push({
              id: vId,
              name: (variant.name as string) ?? '',
              ean: (variant.ean as string) ?? '',
              sku: (variant.sku as string) ?? '',
              quantity: (variant.quantity as number) ?? 0,
              price: 0,
              thumbnailUrl: null,
              manufacturerId: 0,
              manufacturerName: '',
              productType: 'variant',
              parentId: id,
              isBundle: false,
            });
          }
        }
      }

      page++;
    }

    // Save to cache
    setCachedProductList(inventoryId, items);
    const cachedAt = new Date().toISOString();

    return NextResponse.json(
      { products: items, totalCount: items.length, inventoryId, cachedAt },
      { headers: { 'X-Cache': 'MISS' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
