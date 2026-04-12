import { NextRequest, NextResponse } from 'next/server';
import { getProductById, updateProduct } from '@/lib/db';
import type { ProductPatch } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sheets/products/[id]
 * Fetch a single product by its sheet ID.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const product = getProductById(id);

  if (!product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  }

  return NextResponse.json({ product });
}

/**
 * PATCH /api/sheets/products/[id]
 * Update app-managed fields: scrape_url, status, bl_product_id, error_message, category_id
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existing = getProductById(id);

  if (!existing) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  }

  try {
    const body = await request.json();
    const patch: ProductPatch = {};

    if (typeof body.scrape_url === 'string') patch.scrape_url = body.scrape_url;
    if (typeof body.status === 'string') patch.status = body.status;
    if (typeof body.bl_product_id === 'string') patch.bl_product_id = body.bl_product_id;
    if (typeof body.category_id === 'string') patch.category_id = body.category_id;
    if (body.error_message === null || typeof body.error_message === 'string') {
      patch.error_message = body.error_message;
    }

    const updated = updateProduct(id, patch);
    return NextResponse.json({ product: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
