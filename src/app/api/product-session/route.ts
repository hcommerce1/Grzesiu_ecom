import { NextRequest, NextResponse } from 'next/server';
import { getSession, saveSession, clearSession, createDefaultFieldSelection } from '@/lib/product-session';
import type { ProductSession } from '@/lib/types';

// GET /api/product-session — retrieve current session
export async function GET() {
  const session = getSession();
  if (!session) {
    return NextResponse.json({ session: null });
  }
  return NextResponse.json({ session });
}

// POST /api/product-session — create or update session
export async function POST(req: NextRequest) {
  let body: Partial<ProductSession>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const existing = getSession();

  const session: ProductSession = {
    mode: body.mode ?? existing?.mode ?? 'new',
    product_id: body.product_id ?? existing?.product_id,
    parent_id: body.parent_id ?? existing?.parent_id,
    bundle_products: body.bundle_products ?? existing?.bundle_products,
    data: body.data ?? existing?.data ?? {
      title: '',
      images: [],
      description: '',
      attributes: {},
      url: '',
    },
    allegroCategory: body.allegroCategory ?? existing?.allegroCategory,
    allegroParameters: body.allegroParameters ?? existing?.allegroParameters,
    filledParameters: body.filledParameters ?? existing?.filledParameters,
    commissionInfo: body.commissionInfo ?? existing?.commissionInfo,
    images: body.images ?? existing?.images ?? [],
    tax_rate: body.tax_rate ?? existing?.tax_rate ?? 23,
    inventoryId: body.inventoryId ?? existing?.inventoryId,
    defaultWarehouse: body.defaultWarehouse ?? existing?.defaultWarehouse,
    fieldSelection: body.fieldSelection ?? existing?.fieldSelection ?? createDefaultFieldSelection(body.mode ?? existing?.mode ?? 'new'),
    ready: body.ready ?? existing?.ready ?? false,
  };

  saveSession(session);
  return NextResponse.json({ session });
}

// DELETE /api/product-session — clear session
export async function DELETE() {
  clearSession();
  return NextResponse.json({ success: true });
}
