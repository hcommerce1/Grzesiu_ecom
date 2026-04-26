import { NextResponse } from 'next/server';
import { getUsdToPln } from '@/lib/fx-rate';

export async function GET() {
  const pln = await getUsdToPln();
  return NextResponse.json({ pln });
}
