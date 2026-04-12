import { NextResponse } from 'next/server';
import { fetchAllRows } from '@/lib/google-sheets';
import { upsertFromSheet, getAllProducts } from '@/lib/db';
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
 * GET /api/sheets/products
 * Returns products from SQLite cache (instant).
 * No Google Sheets call — use POST to sync.
 */
export async function GET() {
  try {
    const all = getAllProducts();
    return NextResponse.json(groupProducts(all));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('GET /api/sheets/products error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/sheets/products
 * Syncs data from Google Sheets into SQLite, then returns updated products.
 */
export async function POST() {
  try {
    const sheetRows = await fetchAllRows();
    upsertFromSheet(sheetRows);

    const all = getAllProducts();
    return NextResponse.json({ ...groupProducts(all), synced: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('POST /api/sheets/products error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
