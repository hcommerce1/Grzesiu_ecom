import fs from 'fs';
import path from 'path';
import type { ProductSession, FieldSelection } from './types';
export { createDefaultFieldSelection } from './field-selection';

const SESSION_FILE = path.join(process.cwd(), 'tmp', 'product-session.json');

function ensureTmpDir() {
  const dir = path.dirname(SESSION_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getSession(): ProductSession | null {
  ensureTmpDir();
  if (!fs.existsSync(SESSION_FILE)) return null;
  try {
    const raw = fs.readFileSync(SESSION_FILE, 'utf-8');
    return JSON.parse(raw) as ProductSession;
  } catch {
    return null;
  }
}

export function saveSession(session: ProductSession): void {
  ensureTmpDir();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), 'utf-8');
}

export function clearSession(): void {
  if (fs.existsSync(SESSION_FILE)) {
    fs.unlinkSync(SESSION_FILE);
  }
}

export function buildBaselinkerPayload(session: ProductSession): Record<string, unknown> {
  const { data, fieldSelection, mode, inventoryId, defaultWarehouse } = session;
  const efv = session.editableFieldValues ?? {};
  const warehouseKey = defaultWarehouse
    ? (String(defaultWarehouse).startsWith('bl_') ? String(defaultWarehouse) : `bl_${defaultWarehouse}`)
    : undefined;

  const payload: Record<string, unknown> = {
    inventory_id: inventoryId,
    is_bundle: session.is_bundle ?? (mode === 'bundle'),
    tax_rate: session.tax_rate,
    text_fields: {
      name: data.title,
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
    // Buduj mapę: paramId -> { optionId -> polskiTekst }
    const paramDicts: Record<string, Record<string, string>> = {};
    for (const param of session.allegroParameters ?? []) {
      if (param.dictionary && param.dictionary.length > 0) {
        paramDicts[param.id] = Object.fromEntries(
          param.dictionary.map(opt => [opt.id, opt.value])
        );
      }
    }

    const filled: Record<string, string | string[]> = {};
    for (const [paramId, value] of Object.entries(session.filledParameters)) {
      const dict = paramDicts[paramId];
      if (Array.isArray(value)) {
        const resolved = value.map(v => (dict ? (dict[v] ?? v) : v)).filter(Boolean);
        if (resolved.length > 0) filled[paramId] = resolved;
      } else if (value !== '' && value != null) {
        filled[paramId] = dict ? (dict[value] ?? value) : value;
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

  // Prices — user override
  if (fieldSelection?.prices && warehouseKey) {
    const priceVal = efv['prices'] ? parseFloat(efv['prices'].replace(',', '.')) : null;
    if (priceVal && !isNaN(priceVal)) {
      payload['prices'] = { [warehouseKey]: priceVal };
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
  if (session.is_bundle && session.bundle_products) {
    payload['bundle_products'] = session.bundle_products;
  }

  return payload;
}
