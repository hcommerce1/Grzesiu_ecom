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
  const clientSecret = getClientSecret();
  const res = await fetch(`${ALLEGRO_AUTH}/device`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
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

// ─── Single-attempt device token exchange (for client-side polling) ───
export async function pollDeviceTokenOnce(
  deviceCode: string
): Promise<{ success: boolean; token?: AllegroToken; error?: string }> {
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
    return { success: true, token };
  }

  const err = await res.json().catch(() => ({}));
  if ((err as Record<string, string>).error === 'authorization_pending') {
    return { success: false, error: 'authorization_pending' };
  }
  return { success: false, error: JSON.stringify(err) };
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
const ALLEGRO_FETCH_TIMEOUT = 15_000; // 15s timeout

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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ALLEGRO_FETCH_TIMEOUT);

  try {
    const res = await fetch(`${ALLEGRO_BASE}${endpoint}`, {
      ...options,
      signal: controller.signal,
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
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Allegro API ${endpoint} timeout po ${ALLEGRO_FETCH_TIMEOUT / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
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
  if (!categoryId || categoryId === 'undefined') {
    throw new Error('Brak categoryId');
  }
  const data = await allegroFetch<{ parameters: AllegroParameter[] }>(
    `/sale/categories/${categoryId}/parameters`
  );
  return data.parameters ?? [];
}

// ─── Commission info via POST /pricing/offer-fee-preview ───
// Sends a minimal fake offer to Allegro's fee calculator and reads back the commission.
// Uses 100 PLN price so the returned fee amount directly equals the percentage.
export async function getCommissionInfo(categoryId: string): Promise<string> {
  if (!categoryId || categoryId === 'undefined') {
    throw new Error('Brak categoryId');
  }

  try {
    const body = {
      offer: {
        name: 'Fee preview',
        category: { id: categoryId },
        sellingMode: {
          format: 'BUY_NOW',
          price: { amount: '100.00', currency: 'PLN' },
        },
        publication: { duration: 'P30D' },
        parameters: [],
      },
      marketplaceId: 'allegro-pl',
    };

    const data = await allegroFetch<{
      commissions?: Array<{ name?: string; type?: string; fee?: { amount?: string; currency?: string; tax?: string } }>;
      quotes?: Array<{ name?: string; type?: string; fee?: { amount?: string; currency?: string; tax?: string } }>;
    }>('/pricing/offer-fee-preview', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    console.log(`[Commission] fee-preview for cat ${categoryId}:`, JSON.stringify(data).slice(0, 600));

    // Find the commission fee (prowizja od sprzedaży)
    if (data.commissions && data.commissions.length > 0) {
      const commFee = data.commissions.find(c =>
        c.type === 'commissionFee' || c.name?.toLowerCase().includes('prowizja')
      ) ?? data.commissions[0];

      if (commFee?.fee?.amount) {
        // With 100 PLN price, fee amount = percentage directly (gross)
        const grossPct = parseFloat(commFee.fee.amount);
        // Allegro returns GROSS (with 23% VAT), convert to netto
        const isGross = commFee.fee.tax === 'GROSS';
        const nettoPct = isGross ? Math.round((grossPct / 1.23) * 100) / 100 : grossPct;
        return `${nettoPct}% netto`;
      }
    }

    // Fallback: return raw commissions data for debugging
    if (data.commissions) {
      return JSON.stringify(data.commissions);
    }
  } catch (e) {
    console.log(`[Commission] fee-preview failed for ${categoryId}:`, e instanceof Error ? e.message : e);
  }

  return '';
}

// ─── Category tree cache & search ───
interface FlatCategory {
  id: string;
  name: string;
  fullPath: string;
  leaf: boolean;
  parentId: string;
}

const TREE_CACHE_FILE = path.join(process.cwd(), 'tmp', 'allegro-category-tree.json');
const TREE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

function loadCategoryCache(): FlatCategory[] | null {
  try {
    if (!fs.existsSync(TREE_CACHE_FILE)) return null;
    const stat = fs.statSync(TREE_CACHE_FILE);
    if (Date.now() - stat.mtimeMs > TREE_CACHE_TTL) return null;
    return JSON.parse(fs.readFileSync(TREE_CACHE_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function saveCategoryCache(categories: FlatCategory[]) {
  ensureTmpDir();
  fs.writeFileSync(TREE_CACHE_FILE, JSON.stringify(categories), 'utf-8');
}

/**
 * Recursively build a flat list of all Allegro categories.
 * Uses BFS with concurrency limit to avoid hammering the API.
 */
export async function buildCategoryTree(): Promise<FlatCategory[]> {
  const cached = loadCategoryCache();
  if (cached) return cached;

  const flat: FlatCategory[] = [];
  const rootCats = await getRootCategories();

  // BFS queue: [category, parentPath]
  type QueueItem = { id: string; name: string; leaf: boolean; parentId: string; pathSoFar: string };
  const queue: QueueItem[] = rootCats.map(c => ({
    id: c.id,
    name: c.name,
    leaf: c.leaf,
    parentId: '',
    pathSoFar: c.name,
  }));

  for (const item of queue) {
    flat.push({
      id: item.id,
      name: item.name,
      fullPath: item.pathSoFar,
      leaf: item.leaf,
      parentId: item.parentId,
    });
  }

  // Process non-leaf categories in batches
  const BATCH_SIZE = 5;
  const toExpand = queue.filter(q => !q.leaf);

  while (toExpand.length > 0) {
    const batch = toExpand.splice(0, BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (item) => {
        try {
          const children = await getChildCategories(item.id);
          return children.map(c => ({
            id: c.id,
            name: c.name,
            leaf: c.leaf,
            parentId: item.id,
            pathSoFar: `${item.pathSoFar} > ${c.name}`,
          }));
        } catch {
          return [];
        }
      })
    );

    for (const children of results) {
      for (const child of children) {
        flat.push({
          id: child.id,
          name: child.name,
          fullPath: child.pathSoFar,
          leaf: child.leaf,
          parentId: child.parentId,
        });
        if (!child.leaf) {
          toExpand.push(child);
        }
      }
    }
  }

  saveCategoryCache(flat);
  return flat;
}

/**
 * Fuzzy search categories by name.
 * Handles: case-insensitive, Polish diacritics, typos (Levenshtein),
 * singular/plural forms, partial word matches.
 */
export async function searchCategories(query: string, limit = 20, leafOnly = false): Promise<FlatCategory[]> {
  const tree = await buildCategoryTree();
  const normalizedQuery = normalizePolish(query.toLowerCase().trim());
  const words = normalizedQuery.split(/\s+/).filter(Boolean);
  const stemmedWords = words.map(stemPolish);

  const scored: (FlatCategory & { score: number })[] = [];

  for (const cat of tree) {
    const normName = normalizePolish(cat.name.toLowerCase());
    const normPath = normalizePolish(cat.fullPath.toLowerCase());
    const nameWords = normName.split(/[\s,/()-]+/).filter(Boolean);
    const pathWords = normPath.split(/[\s,/()>-]+/).filter(Boolean);
    const stemmedNameWords = nameWords.map(stemPolish);
    const stemmedPathWords = pathWords.map(stemPolish);

    let score = 0;
    let firstWordMatched = false;

    for (let wi = 0; wi < stemmedWords.length; wi++) {
      const sw = stemmedWords[wi];
      const origWord = words[wi];
      let bestWordScore = 0;

      // Check exact substring match in name/path
      if (normName.includes(origWord)) bestWordScore = Math.max(bestWordScore, 20);
      if (normPath.includes(origWord)) bestWordScore = Math.max(bestWordScore, 10);

      // Check stemmed match
      for (const snw of stemmedNameWords) {
        if (snw === sw) bestWordScore = Math.max(bestWordScore, 25);
        else if (snw.startsWith(sw) || sw.startsWith(snw)) bestWordScore = Math.max(bestWordScore, 15);
        else {
          const dist = levenshtein(sw, snw);
          const threshold = sw.length <= 4 ? 1 : 2;
          if (dist <= threshold) bestWordScore = Math.max(bestWordScore, 12 - dist * 3);
        }
      }
      for (const spw of stemmedPathWords) {
        if (spw === sw) bestWordScore = Math.max(bestWordScore, 15);
        else if (spw.startsWith(sw) || sw.startsWith(spw)) bestWordScore = Math.max(bestWordScore, 8);
        else {
          const dist = levenshtein(sw, spw);
          const threshold = sw.length <= 4 ? 1 : 2;
          if (dist <= threshold) bestWordScore = Math.max(bestWordScore, 6 - dist * 2);
        }
      }

      if (wi === 0 && bestWordScore > 0) firstWordMatched = true;
      score += bestWordScore;
    }

    // Pierwsze słowo musi pasować (najważniejszy sygnał), reszta słów opcjonalna
    if (!firstWordMatched) continue;

    // Exact full name match bonus
    if (normName === normalizedQuery) score += 100;
    else if (normName.includes(normalizedQuery)) score += 40;

    // Leaf bonus (user wants leaf categories)
    if (cat.leaf) score += 30;

    // Shorter paths = more specific
    score -= cat.fullPath.split(' > ').length * 0.5;

    scored.push({ ...cat, score });
  }

  return scored
    .filter(c => !leafOnly || c.leaf)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function normalizePolish(str: string): string {
  return str
    .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e')
    .replace(/ł/g, 'l').replace(/ń/g, 'n').replace(/ó/g, 'o')
    .replace(/ś/g, 's').replace(/ź/g, 'z').replace(/ż/g, 'z');
}

/** Basic Polish stemming — strips common suffixes for fuzzy matching */
function stemPolish(word: string): string {
  const w = normalizePolish(word.toLowerCase());
  // Common Polish noun/adjective endings (longest first)
  const suffixes = [
    'owego', 'owej', 'owym', 'owych', 'owym',
    'owe', 'owi', 'owa',
    'ach', 'ami', 'ow', 'om',
    'ie', 'ce', 'ki', 'ek', 'ka', 'ko',
    'ni', 'ne', 'ny', 'na', 'no',
    'y', 'i', 'e', 'a', 'o',
  ];
  for (const s of suffixes) {
    if (w.length > s.length + 2 && w.endsWith(s)) {
      return w.slice(0, -s.length);
    }
  }
  return w;
}

/** Levenshtein distance between two strings */
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[b.length][a.length];
}
