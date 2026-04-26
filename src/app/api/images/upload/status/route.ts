import { NextResponse } from 'next/server';
import { getStorageHealth } from '@/lib/cloud-storage';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get('refresh') === '1';
  const health = await getStorageHealth(force);
  return NextResponse.json({
    r2: health.r2,
    cloudinary: health.cloudinary,
    checkedAt: health.checkedAt,
    bothOffline: !health.r2 && !health.cloudinary,
  });
}
