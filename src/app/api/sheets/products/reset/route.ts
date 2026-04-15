import { NextResponse } from 'next/server';
import { resetAllProducts, getAllProducts } from '@/lib/db';
import type { SheetProductRow } from '@/lib/db';

export const dynamic = 'force-dynamic';

function groupProducts(all: SheetProductRow[]) {
  const active: SheetProductRow[] = [];
  const done: SheetProductRow[] = [];

  for (const product of all) {
    if (product.status === 'done') {
      done.push(product);
    } else {
      active.push(product);
    }
  }

  return { active, done, total: all.length };
}

/**
 * POST /api/sheets/products/reset
 * Resetuje wszystkie produkty do stanu "new" — czyści statusy, URL-e, powiązania z BL.
 */
export async function POST() {
  try {
    resetAllProducts();
    const all = getAllProducts();
    return NextResponse.json(groupProducts(all));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('POST /api/sheets/products/reset error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
