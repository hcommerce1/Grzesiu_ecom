import { NextRequest, NextResponse } from 'next/server';
import { getSellerSession, batchToggleSelection } from '@/lib/db';

export async function POST(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  try {
    const session = getSellerSession(sessionId);
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    const body = await req.json();
    const { listingIds, all, selected } = body;

    if (typeof selected !== 'boolean') {
      return NextResponse.json({ error: 'selected (boolean) required' }, { status: 400 });
    }

    batchToggleSelection(sessionId, { listingIds, all, selected });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
