import { NextRequest, NextResponse } from 'next/server';
import { getSellerSession, getListings, deleteSellerSession } from '@/lib/db';

export async function GET(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const session = getSellerSession(sessionId);
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  const listings = getListings(sessionId);
  return NextResponse.json({ session, listings });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const session = getSellerSession(sessionId);
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  deleteSellerSession(sessionId);
  return NextResponse.json({ success: true });
}
