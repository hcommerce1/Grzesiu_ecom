import fs from 'fs';
import path from 'path';

const CACHE_FILE = path.join(process.cwd(), 'tmp', 'bl-product-details-cache.json');
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedEntry {
  data: Record<string, unknown>;
  timestamp: number;
}

type CacheStore = Record<string, CachedEntry>;

function ensureTmpDir() {
  const dir = path.dirname(CACHE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readStore(): CacheStore {
  ensureTmpDir();
  if (!fs.existsSync(CACHE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as CacheStore;
  } catch {
    return {};
  }
}

function writeStore(store: CacheStore) {
  ensureTmpDir();
  fs.writeFileSync(CACHE_FILE, JSON.stringify(store), 'utf-8');
}

/**
 * Returns cached product details (if fresh) and a list of IDs that need fetching.
 */
export function getCachedProductDetails(productIds: string[]): {
  cached: Record<string, Record<string, unknown>>;
  missing: string[];
} {
  const store = readStore();
  const now = Date.now();
  const cached: Record<string, Record<string, unknown>> = {};
  const missing: string[] = [];

  for (const id of productIds) {
    const entry = store[id];
    if (entry && now - entry.timestamp < CACHE_TTL_MS) {
      cached[id] = entry.data;
    } else {
      missing.push(id);
    }
  }

  return { cached, missing };
}

/**
 * Stores product details in cache (keyed by product ID).
 */
export function setCachedProductDetails(products: Record<string, Record<string, unknown>>) {
  const store = readStore();
  const now = Date.now();

  for (const [id, data] of Object.entries(products)) {
    store[id] = { data, timestamp: now };
  }

  writeStore(store);
}

/**
 * Removes specific products from cache (call after editing a product).
 */
export function invalidateProductDetails(productIds: string[]) {
  const store = readStore();

  for (const id of productIds) {
    delete store[id];
  }

  writeStore(store);
}
