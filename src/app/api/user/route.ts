import { NextResponse } from 'next/server';
import { getAppUser } from '@/lib/user';

export async function GET() {
  return NextResponse.json({ user: getAppUser() });
}
