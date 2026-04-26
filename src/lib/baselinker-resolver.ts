import {
  getInventoryCategories,
  addInventoryCategory,
  addInventoryManufacturer,
} from './baselinker';
import { callBaselinker } from './baselinker';

const TTL_MS = 5 * 60 * 1000;

interface CategoryEntry {
  category_id: number;
  name: string;
}

interface ManufacturerEntry {
  manufacturer_id: number;
  name: string;
}

const categoriesCache = new Map<number, { items: CategoryEntry[]; fetchedAt: number }>();
const manufacturersCache = new Map<number, { items: ManufacturerEntry[]; fetchedAt: number }>();

function isFresh(fetchedAt: number): boolean {
  return Date.now() - fetchedAt < TTL_MS;
}

async function fetchCategoriesFromBL(inventoryId: number): Promise<CategoryEntry[]> {
  const list = await getInventoryCategories(inventoryId);
  return list.map((c) => ({ category_id: c.category_id, name: c.name }));
}

async function fetchManufacturersFromBL(inventoryId: number): Promise<ManufacturerEntry[]> {
  // BL zwraca obiekt {id: {name}}, używamy callBaselinker bezpośrednio żeby zachować klucze (ID).
  const res = await callBaselinker<{ manufacturers: Record<string, { name: string }> }>(
    'getInventoryManufacturers',
    { inventory_id: inventoryId },
  );
  return Object.entries(res.manufacturers ?? {}).map(([id, val]) => ({
    manufacturer_id: parseInt(id, 10),
    name: val?.name ?? '',
  }));
}

async function getCachedCategories(inventoryId: number): Promise<CategoryEntry[]> {
  const cached = categoriesCache.get(inventoryId);
  if (cached && isFresh(cached.fetchedAt)) return cached.items;
  const items = await fetchCategoriesFromBL(inventoryId);
  categoriesCache.set(inventoryId, { items, fetchedAt: Date.now() });
  return items;
}

async function getCachedManufacturers(inventoryId: number): Promise<ManufacturerEntry[]> {
  const cached = manufacturersCache.get(inventoryId);
  if (cached && isFresh(cached.fetchedAt)) return cached.items;
  const items = await fetchManufacturersFromBL(inventoryId);
  manufacturersCache.set(inventoryId, { items, fetchedAt: Date.now() });
  return items;
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

export async function resolveCategoryId(name: string, inventoryId: number): Promise<number> {
  const target = normalize(name);
  if (!target) throw new Error('resolveCategoryId: nazwa kategorii pusta');

  const cats = await getCachedCategories(inventoryId);
  const existing = cats.find((c) => normalize(c.name) === target);
  if (existing) return existing.category_id;

  // Brak — utwórz w BL i odśwież cache
  const created = await addInventoryCategory({
    inventory_id: inventoryId,
    name: name.trim(),
    parent_id: 0,
  });
  categoriesCache.set(inventoryId, {
    items: [...cats, { category_id: created.category_id, name: name.trim() }],
    fetchedAt: Date.now(),
  });
  return created.category_id;
}

export async function resolveManufacturerId(name: string, inventoryId: number): Promise<number> {
  const target = normalize(name);
  if (!target) throw new Error('resolveManufacturerId: nazwa producenta pusta');

  const mfrs = await getCachedManufacturers(inventoryId);
  const existing = mfrs.find((m) => normalize(m.name) === target);
  if (existing) return existing.manufacturer_id;

  const created = await addInventoryManufacturer({
    inventory_id: inventoryId,
    manufacturer_name: name.trim(),
  });
  manufacturersCache.set(inventoryId, {
    items: [...mfrs, { manufacturer_id: created.manufacturer_id, name: name.trim() }],
    fetchedAt: Date.now(),
  });
  return created.manufacturer_id;
}

// Eksportowane do testów / awaryjnego invalidate (np. po user edit w panelu BL).
export function clearCache(): void {
  categoriesCache.clear();
  manufacturersCache.clear();
}
