import { NextResponse } from 'next/server';
import { getSession } from '@/lib/product-session';
import { buildBaselinkerPayload } from '@/lib/product-session';
import { addInventoryProduct, getInventoryProductsData } from '@/lib/baselinker';
import {
  invalidateProductDetails,
  setCachedProductDetails,
} from '@/lib/product-details-cache';

// POST /api/bl-submit — build payload from session and submit to BaseLinker
export async function POST() {
  const session = getSession();
  if (!session) {
    return NextResponse.json({ error: 'No active product session' }, { status: 400 });
  }

  if (!session.inventoryId) {
    return NextResponse.json({ error: 'inventory_id not set in session' }, { status: 400 });
  }

  try {
    const payload = buildBaselinkerPayload(session);
    const result = await addInventoryProduct(payload);
    const productId = String(result.product_id);

    // Invalidate cache and re-fetch fresh data so the list shows updated info
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
