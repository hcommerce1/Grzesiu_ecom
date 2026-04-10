import fs from 'fs';
import path from 'path';
import type { AllegroToken, AllegroCategory, AllegroParameter } from './types';

const ALLEGRO_BASE = 'https://api.allegro.pl';
const ALLEGRO_AUTH = 'https://allegro.pl/auth/oauth';
const TOKEN_FILE = path.join(process.cwd(), 'tmp', 'allegro-token.json');

function getClientId(): string {
  const id = process.env.ALLEGRO_CLIENT_ID;
  if (!id) throw new Error('ALLEGRO_CLIENT_ID not set in environment');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.ALLEGRO_CLIENT_SECRET;
  if (!secret) throw new Error('ALLEGRO_CLIENT_SECRET not set in environment');
  return secret;
}

function ensureTmpDir() {
  const dir = path.dirname(TOKEN_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ─── Token persistence ───
export function loadToken(): AllegroToken | null {
  ensureTmpDir();
  // Check env vars first
  if (process.env.ALLEGRO_ACCESS_TOKEN) {
    return {
      access_token: process.env.ALLEGRO_ACCESS_TOKEN,
      refresh_token: process.env.ALLEGRO_REFRESH_TOKEN ?? '',
      expires_at: Date.now() + 12 * 3600 * 1000,
    };
  }
  if (!fs.existsSync(TOKEN_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8')) as AllegroToken;
  } catch {
    return null;
  }
}

export function saveToken(token: AllegroToken) {
  ensureTmpDir();
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2), 'utf-8');
}

// ─── Device Authorization Flow ───
export async function startDeviceFlow(): Promise<{ verification_uri_complete: string; device_code: string; interval: number }> {
  const clientId = getClientId();
  const res = await fetch(`${ALLEGRO_AUTH}/device`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ client_id: clientId }).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Device flow start failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function pollDeviceToken(deviceCode: string, intervalSeconds = 5): Promise<AllegroToken> {
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((r) => setTimeout(r, intervalSeconds * 1000));

    const res = await fetch(`${ALLEGRO_AUTH}/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
      }).toString(),
    });

    if (res.ok) {
      const data = await res.json();
      const token: AllegroToken = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + data.expires_in * 1000,
      };
      saveToken(token);
      return token;
    }

    const err = await res.json().catch(() => ({}));
    if ((err as Record<string, string>).error !== 'authorization_pending') {
      throw new Error(`Token poll failed: ${JSON.stringify(err)}`);
    }
  }

  throw new Error('Device authorization timed out — user did not confirm in time');
}

// ─── Token refresh ───
async function refreshToken(token: AllegroToken): Promise<AllegroToken> {
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(`${ALLEGRO_AUTH}/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
    }).toString(),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status}`);
  }

  const data = await res.json();
  const newToken: AllegroToken = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? token.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  saveToken(newToken);
  return newToken;
}

// ─── Authenticated fetch ───
export async function allegroFetch<T = unknown>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  let token = loadToken();
  if (!token) throw new Error('Not authenticated with Allegro — run device flow first');

  // Refresh if expiring in < 5 minutes
  if (Date.now() > token.expires_at - 5 * 60 * 1000) {
    token = await refreshToken(token);
  }

  const res = await fetch(`${ALLEGRO_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: 'application/vnd.allegro.public.v1+json',
      'Content-Type': 'application/vnd.allegro.public.v1+json',
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Allegro API ${endpoint} failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<T>;
}

// ─── Category helpers ───
export async function getRootCategories(): Promise<AllegroCategory[]> {
  const data = await allegroFetch<{ categories: AllegroCategory[] }>('/sale/categories');
  return data.categories;
}

export async function getChildCategories(parentId: string): Promise<AllegroCategory[]> {
  const data = await allegroFetch<{ categories: AllegroCategory[] }>(
    `/sale/categories?parent.id=${parentId}`
  );
  return data.categories;
}

export async function getCategoryParameters(categoryId: string): Promise<AllegroParameter[]> {
  const data = await allegroFetch<{ parameters: AllegroParameter[] }>(
    `/sale/categories/${categoryId}/parameters`
  );
  return data.parameters ?? [];
}

// ─── Commission info (best-effort) ───
export async function getCommissionInfo(categoryId: string): Promise<string> {
  try {
    const data = await allegroFetch<{ offerTypes?: unknown[] }>(
      `/billing/offer-types?category.id=${categoryId}`
    );
    if (data.offerTypes && data.offerTypes.length > 0) {
      return JSON.stringify(data.offerTypes[0]);
    }
  } catch {
    // Endpoint may not be available for all accounts
  }
  return 'Sprawdź stawki prowizji na https://allegro.pl/dla-sprzedajacych/platnosci-i-oplaty/prowizja';
}
