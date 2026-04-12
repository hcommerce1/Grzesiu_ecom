import fs from 'fs';
import path from 'path';
import type { BLCache } from './types';
import {
  getInventories,
  getInventoryWarehouses,
  getInventoryPriceGroups,
  getInventoryExtraFields,
  getInventoryManufacturers,
  getInventoryIntegrations,
  getInventoryAvailableTextFieldKeys,
} from './baselinker';

const CACHE_FILE = path.join(process.cwd(), 'tmp', 'bl-cache.json');
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function ensureTmpDir() {
  const dir = path.dirname(CACHE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getCachedBLData(): BLCache | null {
  ensureTmpDir();
  if (!fs.existsSync(CACHE_FILE)) return null;
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    const cache = JSON.parse(raw) as BLCache;
    if (Date.now() - cache.timestamp > CACHE_TTL_MS) return null;
    return cache;
  } catch {
    return null;
  }
}

export function clearBLCache() {
  if (fs.existsSync(CACHE_FILE)) {
    fs.unlinkSync(CACHE_FILE);
  }
}

export async function bootstrapBLCache(inventoryId?: number): Promise<BLCache> {
  ensureTmpDir();

  const inventories = await getInventories();

  // Use provided inventory ID or first available from API
  const selectedInventoryId =
    inventoryId ??
    (inventories[0] as Record<string, unknown>)?.['inventory_id'] as number | undefined;

  if (!selectedInventoryId) {
    throw new Error('No inventory ID available — select an inventory first');
  }

  const [warehouses, priceGroups, extraFields, manufacturers, integrations, textFieldKeys] =
    await Promise.all([
      getInventoryWarehouses(selectedInventoryId),
      getInventoryPriceGroups(selectedInventoryId),
      getInventoryExtraFields(),
      getInventoryManufacturers(selectedInventoryId),
      getInventoryIntegrations(selectedInventoryId),
      getInventoryAvailableTextFieldKeys(selectedInventoryId),
    ]);

  const cache: BLCache = {
    timestamp: Date.now(),
    inventories: inventories as unknown as BLCache['inventories'],
    warehouses: warehouses as unknown as BLCache['warehouses'],
    priceGroups: priceGroups as unknown as BLCache['priceGroups'],
    extraFields: extraFields as unknown as BLCache['extraFields'],
    manufacturers: manufacturers as unknown as BLCache['manufacturers'],
    integrations,
    textFieldKeys,
  };

  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
  return cache;
}

export async function getBLCache(inventoryId?: number): Promise<BLCache> {
  const cached = getCachedBLData();
  if (cached) return cached;
  return bootstrapBLCache(inventoryId);
}
