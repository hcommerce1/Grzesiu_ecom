import { NextResponse } from 'next/server';
import { getSession } from '@/lib/product-session';
import { buildBaselinkerPayload } from '@/lib/product-session';
import { addInventoryProduct, getInventoryProductsData } from '@/lib/baselinker';
import { resolveCategoryId, resolveManufacturerId, clearCache } from '@/lib/baselinker-resolver';
import {
  invalidateProductDetails,
  setCachedProductDetails,
} from '@/lib/product-details-cache';
import { invalidateProductListCache } from '@/lib/db';

// POST /api/bl-submit — build payload from session and submit to BaseLinker
export async function POST(req: Request) {
  const url = new URL(req.url);
  const productKey = url.searchParams.get('productKey') ?? undefined;
  const session = getSession(productKey);
  if (!session) {
    return NextResponse.json({ error: 'No active product session' }, { status: 400 });
  }

  // Sanity check: productKey musi zgadzać się z zawartością sesji
  if (productKey?.startsWith('bl_') && session.product_id) {
    if (String(session.product_id) !== productKey.slice(3)) {
      return NextResponse.json({ error: `Session mismatch: key=${productKey}, session.product_id=${session.product_id}` }, { status: 400 });
    }
  }
  if (productKey?.startsWith('sheet_') && session.sheetProductId) {
    if (String(session.sheetProductId) !== productKey.slice(6)) {
      return NextResponse.json({ error: `Session mismatch: key=${productKey}, session.sheetProductId=${session.sheetProductId}` }, { status: 400 });
    }
  }

  if (!session.inventoryId) {
    return NextResponse.json({ error: 'inventory_id not set in session' }, { status: 400 });
  }

  try {
    const payload = buildBaselinkerPayload(session);

    // Pre-resolve: Allegro category name → BL category_id (auto-create gdy brak w BL).
    if (session.allegroCategory?.name) {
      payload.category_id = await resolveCategoryId(session.allegroCategory.name, session.inventoryId);
    }

    // Pre-resolve: jeśli user wpisał nazwę producenta zamiast ID, utwórz/znajdź w BL.
    const rawManufacturer = session.editableFieldValues?.manufacturer_id;
    if (rawManufacturer && isNaN(parseInt(rawManufacturer, 10))) {
      payload.manufacturer_id = await resolveManufacturerId(rawManufacturer, session.inventoryId);
    }

    let result: { product_id: number };
    try {
      result = await addInventoryProduct(payload);
    } catch (err) {
      // Defense-in-depth: jeśli cache był stale i BL nadal mówi że category/manufacturer nie istnieje,
      // wyczyść cache, ponów resolver i retry raz.
      const message = err instanceof Error ? err.message : '';
      if (message.includes('ERROR_CATEGORY_ID') || message.includes('ERROR_MANUFACTURER_ID')) {
        clearCache();
        if (session.allegroCategory?.name) {
          payload.category_id = await resolveCategoryId(session.allegroCategory.name, session.inventoryId);
        }
        if (rawManufacturer && isNaN(parseInt(rawManufacturer, 10))) {
          payload.manufacturer_id = await resolveManufacturerId(rawManufacturer, session.inventoryId);
        }
        result = await addInventoryProduct(payload);
      } else {
        throw err;
      }
    }

    const productId = String(result.product_id);

    // Invalidate caches so the list shows the new product
    invalidateProductListCache();
    invalidateProductDetails([productId]);
    try {
      const fresh = await getInventoryProductsData([productId], session.inventoryId) as {
        products: Record<string, Record<string, unknown>>;
      };
      if (fresh.products) {
        setCachedProductDetails(fresh.products);
      }
    } catch {
      // Non-critical — cache will be refreshed on next list load
    }

    return NextResponse.json({ success: true, product_id: result.product_id, payload });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
