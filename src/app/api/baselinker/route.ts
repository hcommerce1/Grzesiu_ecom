import { NextRequest, NextResponse } from 'next/server';
import { callBaselinker } from '@/lib/baselinker';
import type { Priority } from '@/lib/rate-limiter';

export async function POST(req: NextRequest) {
  let body: { method: string; parameters?: Record<string, unknown>; priority?: Priority };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.method) {
    return NextResponse.json({ error: 'Missing method' }, { status: 400 });
  }

  try {
    const data = await callBaselinker(body.method, body.parameters ?? {}, body.priority ?? 'normal');
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
