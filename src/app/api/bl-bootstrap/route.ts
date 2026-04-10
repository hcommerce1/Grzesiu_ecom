import { NextRequest, NextResponse } from 'next/server';
import { getBLCache, clearBLCache, bootstrapBLCache } from '@/lib/bl-cache';

// GET /api/bl-bootstrap?inventoryId=<id> — get cached BL data
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const inventoryId = searchParams.get('inventoryId')
    ? parseInt(searchParams.get('inventoryId')!, 10)
    : undefined;

  try {
    const cache = await getBLCache(inventoryId);
    return NextResponse.json({ cache });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/bl-bootstrap — clear cache + refetch
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const inventoryId = searchParams.get('inventoryId')
    ? parseInt(searchParams.get('inventoryId')!, 10)
    : undefined;

  clearBLCache();
  try {
    const cache = await bootstrapBLCache(inventoryId);
    return NextResponse.json({ cache });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
