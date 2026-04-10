import { NextRequest, NextResponse } from 'next/server';
import { startDeviceFlow, pollDeviceToken, loadToken } from '@/lib/allegro';

function isDemoMode() {
  return !process.env.ALLEGRO_CLIENT_ID;
}

// GET /api/allegro/auth?action=status|init
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  if (action === 'status') {
    if (isDemoMode()) {
      return NextResponse.json({ authenticated: true, _demo: true });
    }
    const token = loadToken();
    return NextResponse.json({ authenticated: !!token });
  }

  if (action === 'init') {
    if (isDemoMode()) {
      return NextResponse.json({
        _demo: true,
        message: 'TRYB DEMO — ustaw ALLEGRO_CLIENT_ID i ALLEGRO_CLIENT_SECRET w .env.local',
      });
    }
    try {
      const flow = await startDeviceFlow();
      return NextResponse.json({
        verification_uri_complete: flow.verification_uri_complete,
        device_code: flow.device_code,
        interval: flow.interval,
        message: `Otwórz w przeglądarce: ${flow.verification_uri_complete}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Unknown action. Use ?action=status or ?action=init' }, { status: 400 });
}

// POST /api/allegro/auth — poll for token
export async function POST(req: NextRequest) {
  if (isDemoMode()) {
    return NextResponse.json({ success: true, _demo: true, expires_at: Date.now() + 12 * 3600 * 1000 });
  }

  let body: { device_code: string; interval?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.device_code) {
    return NextResponse.json({ error: 'Missing device_code' }, { status: 400 });
  }

  try {
    const token = await pollDeviceToken(body.device_code, body.interval ?? 5);
    return NextResponse.json({ success: true, expires_at: token.expires_at });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
