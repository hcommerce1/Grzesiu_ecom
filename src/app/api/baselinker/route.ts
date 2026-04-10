import { NextRequest, NextResponse } from 'next/server';

const BL_API_URL = 'https://api.baselinker.com/connector.php';

export async function POST(req: NextRequest) {
  const token = process.env.BASELINKER_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'BASELINKER_TOKEN not configured' }, { status: 500 });
  }

  let body: { method: string; parameters?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.method) {
    return NextResponse.json({ error: 'Missing method' }, { status: 400 });
  }

  const formBody = new URLSearchParams();
  formBody.set('method', body.method);
  formBody.set('parameters', JSON.stringify(body.parameters ?? {}));

  try {
    const res = await fetch(BL_API_URL, {
      method: 'POST',
      headers: {
        'X-BLToken': token,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody.toString(),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
