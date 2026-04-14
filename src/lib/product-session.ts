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
    tf['features'] = JSON.stringify(session.filledParameters);
  }

  // Extra fields
  Object.entries(fieldSelection ?? {}).forEach(([key, val]) => {
    if (val && key.startsWith('extra_field_')) {
      const extraVal = session.extraFieldValues?.[key] ?? '';
      if (extraVal) tf[key] = extraVal;
    }
  });

  if (fieldSelection?.sku && data.sku) payload['sku'] = data.sku;
  if (fieldSelection?.ean && data.ean) payload['ean'] = data.ean;

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

  // Weight (kg)
  if (fieldSelection?.weight) {
    const w = data.attributes?.['waga'] || data.attributes?.['Waga'] || data.attributes?.['Weight'];
    if (w) {
      const parsed = parseFloat(String(w).replace(',', '.'));
      if (!isNaN(parsed)) payload['weight'] = parsed;
    }
  }

  // Dimensions (cm)
  if (fieldSelection?.dimensions) {
    const h = data.attributes?.['wysokosc'] || data.attributes?.['Wysokosc'] || data.attributes?.['Height'];
    const w = data.attributes?.['szerokosc'] || data.attributes?.['Szerokosc'] || data.attributes?.['Width'];
    const l = data.attributes?.['dlugosc'] || data.attributes?.['Dlugosc'] || data.attributes?.['Length'];
    if (h) { const v = parseFloat(String(h).replace(',', '.')); if (!isNaN(v)) payload['height'] = v; }
    if (w) { const v = parseFloat(String(w).replace(',', '.')); if (!isNaN(v)) payload['width'] = v; }
    if (l) { const v = parseFloat(String(l).replace(',', '.')); if (!isNaN(v)) payload['length'] = v; }
  }

  // Location
  if (fieldSelection?.locations) {
    const loc = data.attributes?.['lokalizacja'] || data.attributes?.['Lokalizacja'];
    if (loc && defaultWarehouse) {
      payload['locations'] = { [defaultWarehouse]: loc };
    }
  }

  if (fieldSelection?.stock !== false && defaultWarehouse) {
    payload['stock'] = { [defaultWarehouse]: 0 };
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
