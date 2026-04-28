import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { ProductSession, FieldSelection } from './types';
export { createDefaultFieldSelection } from './field-selection';

const SESSIONS_DIR = path.join(process.cwd(), 'tmp', 'sessions');
const ACTIVE_POINTER = path.join(process.cwd(), 'tmp', 'session-active.json');
const SNAPSHOT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dni

function ensureDir() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

function sanitizeKey(key: string): string {
  // Whitelist: a-z, A-Z, 0-9, _, -. Reszta → hash do hex.
  if (/^[a-zA-Z0-9_-]+$/.test(key)) return key;
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 24);
}

function pathForKey(key: string): string {
  return path.join(SESSIONS_DIR, `${sanitizeKey(key)}.json`);
}

/**
 * Wyznacza productKey z sesji — preferuje BL product_id (edit), potem sheet, potem hash URL,
 * a w ostateczności '_default' (free-form scrape bez identyfikatora).
 */
export function deriveProductKey(session: Partial<ProductSession>): string {
  if (session.product_id) return `bl_${session.product_id}`;
  if (session.sheetProductId) return `sheet_${session.sheetProductId}`;
  if (session.data?.url) return `url_${crypto.createHash('sha1').update(session.data.url).digest('hex').slice(0, 16)}`;
  return '_default';
}

function getActiveKey(): string | null {
  try {
    const raw = fs.readFileSync(ACTIVE_POINTER, 'utf-8');
    const parsed = JSON.parse(raw) as { activeKey?: string };
    return parsed.activeKey ?? null;
  } catch {
    return null;
  }
}

function setActiveKey(key: string | null): void {
  ensureDir();
  if (key === null) {
    if (fs.existsSync(ACTIVE_POINTER)) fs.unlinkSync(ACTIVE_POINTER);
    return;
  }
  fs.writeFileSync(ACTIVE_POINTER, JSON.stringify({ activeKey: key }), 'utf-8');
}

/**
 * Pobiera sesję z konkretnego klucza (edytowany produkt) lub aktywną sesję (gdy klucz pominięty).
 * Wsteczna kompatybilność — istniejące callsite-y bez argumentu działają jak dotychczas.
 */
export function getSession(productKey?: string): ProductSession | null {
  ensureDir();
  const key = productKey ?? getActiveKey();
  if (!key) return null;
  const file = pathForKey(key);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    return JSON.parse(raw) as ProductSession;
  } catch {
    return null;
  }
}

export function saveSession(session: ProductSession, productKey?: string): void {
  ensureDir();
  const key = productKey ?? deriveProductKey(session);
  const file = pathForKey(key);
  fs.writeFileSync(file, JSON.stringify(session, null, 2), 'utf-8');
  setActiveKey(key);
}

export function clearSession(productKey?: string): void {
  const key = productKey ?? getActiveKey();
  if (!key) return;
  const file = pathForKey(key);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  // Gdy kasujemy aktywną — wyzeruj pointer.
  if (getActiveKey() === key) setActiveKey(null);
}

interface SessionSummary {
  productKey: string;
  lastTouched: number;
  step?: string;
  title?: string;
  hasGeneratedDescription: boolean;
  hasFilledParameters: boolean;
  productId?: string | number;
  sheetProductId?: string;
  url?: string;
}

/**
 * Lista wszystkich snapshot-ów (do badge "w trakcie edycji" + historia scrape).
 * Filtrowane do TTL 30 dni — starsze ignorujemy.
 */
export function listSessions(): SessionSummary[] {
  ensureDir();
  const now = Date.now();
  const out: SessionSummary[] = [];
  for (const fname of fs.readdirSync(SESSIONS_DIR)) {
    if (!fname.endsWith('.json')) continue;
    const full = path.join(SESSIONS_DIR, fname);
    try {
      const stat = fs.statSync(full);
      const lastTouched = stat.mtimeMs;
      if (now - lastTouched > SNAPSHOT_TTL_MS) continue;
      const session = JSON.parse(fs.readFileSync(full, 'utf-8')) as ProductSession;
      out.push({
        productKey: fname.replace(/\.json$/, ''),
        lastTouched,
        step: session.currentStep,
        title: session.data?.title || session.generatedTitle,
        hasGeneratedDescription: !!session.generatedDescription?.fullHtml,
        hasFilledParameters: Object.keys(session.filledParameters ?? {}).length > 0,
        productId: session.product_id,
        sheetProductId: session.sheetProductId,
        url: session.data?.url,
      });
    } catch {
      // ignoruj uszkodzone pliki
    }
  }
  return out.sort((a, b) => b.lastTouched - a.lastTouched);
}

export function buildBaselinkerPayload(session: ProductSession): Record<string, unknown> {
  const { data, mode, inventoryId, defaultWarehouse } = session;
  const efv = session.editableFieldValues ?? {};
  const warehouseKey = defaultWarehouse
    ? (String(defaultWarehouse).startsWith('bl_') ? String(defaultWarehouse) : `bl_${defaultWarehouse}`)
    : undefined;

  // fieldSelection wymuszone — opis/zdjęcia/parametry zawsze TAK, bundle zawsze NIE.
  // User usunął te checkboxy z UI bo i tak zawsze są wysyłane.
  const fieldSelection: Partial<FieldSelection> = {
    ...(session.fieldSelection ?? {}),
    description: true,
    images: true,
    features: true,
  };

  const payload: Record<string, unknown> = {
    inventory_id: inventoryId,
    is_bundle: false, // wymuszone — bundle nie jest już używany w workflow
    tax_rate: session.tax_rate,
    text_fields: {
      name: session.generatedTitle || data.title,
    } as Record<string, string>,
  };

  const tf = payload['text_fields'] as Record<string, string>;

  // Użyj wygenerowanego opisu strukturalnego jeśli dostępny, w przeciwnym razie surowy opis
  if (fieldSelection?.description) {
    const descHtml = session.generatedDescription?.fullHtml;
    if (descHtml) {
      tf['description'] = descHtml;
    } else if (data.description) {
      tf['description'] = data.description;
    }
  }

  if (fieldSelection?.features && session.filledParameters) {
    // Buduj mapę: paramId -> { optionId -> polskiTekst } oraz paramId -> nazwa
    const paramDicts: Record<string, Record<string, string>> = {};
    const paramNames: Record<string, string> = {};
    for (const param of session.allegroParameters ?? []) {
      paramNames[param.id] = param.name;
      if (param.dictionary && param.dictionary.length > 0) {
        paramDicts[param.id] = Object.fromEntries(
          param.dictionary.map(opt => [opt.id, opt.value])
        );
      }
    }

    const filled: Record<string, string | string[]> = {};
    for (const [paramId, value] of Object.entries(session.filledParameters)) {
      const dict = paramDicts[paramId];
      const key = paramNames[paramId] ?? paramId;
      if (Array.isArray(value)) {
        const resolved = value.map(v => (dict ? (dict[v] ?? v) : v)).filter(Boolean);
        if (resolved.length > 0) filled[key] = resolved.join(', ');
      } else if (value !== '' && value != null) {
        filled[key] = dict ? (dict[value] ?? value) : value;
      }
    }

    if (Object.keys(filled).length > 0) {
      tf['features'] = JSON.stringify(filled);
    }
  }

  if (fieldSelection?.category_id && session.allegroCategory?.id) {
    payload['category_id'] = parseInt(session.allegroCategory.id, 10) || session.allegroCategory.id;
  }

  // Extra fields
  Object.entries(fieldSelection ?? {}).forEach(([key, val]) => {
    if (val && key.startsWith('extra_field_')) {
      const extraVal = session.extraFieldValues?.[key] ?? '';
      if (extraVal) tf[key] = extraVal;
    }
  });

  if (fieldSelection?.sku) payload['sku'] = efv['sku'] || data.sku || '';
  if (fieldSelection?.ean) payload['ean'] = efv['ean'] || data.ean || '';

  if (fieldSelection?.images) {
    // Użyj posortowanych, nieusunietych zdjęć z imagesMeta jeśli dostępne
    const imageUrls = session.imagesMeta
      ? session.imagesMeta
          .filter(m => !m.removed)
          .sort((a, b) => a.order - b.order)
          .map(m => m.url)
      : session.images;

    if (imageUrls.length > 0) {
      const images: Record<string, string> = {};
      imageUrls.slice(0, 16).forEach((img, i) => {
        images[String(i)] = img.startsWith('http') ? `url:${img}` : img;
      });
      payload['images'] = images;
    }
  }

  // Weight (kg) — user override > scraped data
  if (fieldSelection?.weight) {
    const w = efv['weight'] || data.attributes?.['waga'] || data.attributes?.['Waga'] || data.attributes?.['Weight'];
    if (w) {
      const parsed = parseFloat(String(w).replace(',', '.'));
      if (!isNaN(parsed)) payload['weight'] = parsed;
    }
  }

  // Dimensions (cm) — user override > scraped data
  if (fieldSelection?.dimensions) {
    const h = efv['height'] || data.attributes?.['wysokosc'] || data.attributes?.['Wysokosc'] || data.attributes?.['Height'];
    const w = efv['width'] || data.attributes?.['szerokosc'] || data.attributes?.['Szerokosc'] || data.attributes?.['Width'];
    const l = efv['length'] || data.attributes?.['dlugosc'] || data.attributes?.['Dlugosc'] || data.attributes?.['Length'];
    if (h) { const v = parseFloat(String(h).replace(',', '.')); if (!isNaN(v)) payload['height'] = v; }
    if (w) { const v = parseFloat(String(w).replace(',', '.')); if (!isNaN(v)) payload['width'] = v; }
    if (l) { const v = parseFloat(String(l).replace(',', '.')); if (!isNaN(v)) payload['length'] = v; }
  }

  // Location — user override > scraped data
  if (fieldSelection?.locations) {
    const loc = efv['locations'] || data.attributes?.['lokalizacja'] || data.attributes?.['Lokalizacja'];
    if (loc && warehouseKey) {
      payload['locations'] = { [warehouseKey]: loc };
    }
  }

  // Stock — user override > default 0
  if (fieldSelection?.stock !== false && warehouseKey) {
    const stockVal = efv['stock'] ? parseInt(efv['stock'], 10) : 0;
    payload['stock'] = { [warehouseKey]: isNaN(stockVal) ? 0 : stockVal };
  }

  // Prices — user override (keyed by price group ID, NOT warehouse)
  const priceGroupKey = session.defaultPriceGroup;
  if (fieldSelection?.prices && priceGroupKey) {
    const priceVal = efv['prices'] ? parseFloat(efv['prices'].replace(',', '.')) : null;
    if (priceVal && !isNaN(priceVal)) {
      payload['prices'] = { [priceGroupKey]: priceVal };
    }
  }

  // Manufacturer
  if (fieldSelection?.manufacturer_id && efv['manufacturer_id']) {
    payload['manufacturer_id'] = parseInt(efv['manufacturer_id'], 10) || 0;
  }

  // Average cost
  if (fieldSelection?.average_cost && efv['average_cost']) {
    const cost = parseFloat(efv['average_cost'].replace(',', '.'));
    if (!isNaN(cost)) payload['average_cost'] = cost;
  }

  if (mode === 'edit' && session.product_id) {
    payload['product_id'] = session.product_id;
  }
  if (mode === 'variant') {
    if (session.parent_id) payload['parent_id'] = session.parent_id;
    if (session.product_id) payload['product_id'] = session.product_id;
  }
  // bundle_products pomijamy — is_bundle wymuszone na false

  return payload;
}
