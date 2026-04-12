import { NextResponse } from 'next/server';
import { isConfigured } from '@/lib/cloud-storage';

export async function GET() {
  return NextResponse.json({
    r2: isConfigured('r2'),
    cloudinary: isConfigured('cloudinary'),
  });
}
