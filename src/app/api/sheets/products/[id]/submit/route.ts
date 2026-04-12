import { NextRequest, NextResponse } from 'next/server';
import { getProductById, markDone, setProductStatus } from '@/lib/db';
import { getSession, buildBaselinkerPayload } from '@/lib/product-session';
import { addInventoryProduct } from '@/lib/baselinker';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sheets/products/[id]/submit
 * Submit the current product session to BaseLinker and mark as done.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const product = getProductById(id);

  if (!product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  }

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
    const blProductId = String(result.product_id);

    // Mark done in SQLite
    markDone(id, blProductId);

    return NextResponse.json({ success: true, product_id: result.product_id, payload });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    setProductStatus(id, 'error', { error_message: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
