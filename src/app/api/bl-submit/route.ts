import { NextResponse } from 'next/server';
import { getSession } from '@/lib/product-session';
import { buildBaselinkerPayload } from '@/lib/product-session';
import { addInventoryProduct } from '@/lib/baselinker';

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
    return NextResponse.json({ success: true, product_id: result.product_id, payload });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
