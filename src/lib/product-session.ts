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
    is_bundle: mode === 'bundle',
    tax_rate: session.tax_rate,
    text_fields: {
      name: data.title,
    } as Record<string, string>,
  };

  const tf = payload['text_fields'] as Record<string, string>;

  if (fieldSelection?.description && data.description) {
    tf['description'] = data.description;
  }

  if (fieldSelection?.features && session.filledParameters) {
    tf['features'] = JSON.stringify(session.filledParameters);
  }

  // Extra fields
  Object.entries(fieldSelection ?? {}).forEach(([key, val]) => {
    if (val && key.startsWith('extra_field_')) {
      const extraVal = (data.attributes ?? {})[key];
      if (extraVal) tf[key] = extraVal;
    }
  });

  if (fieldSelection?.sku && data.sku) payload['sku'] = data.sku;
  if (fieldSelection?.ean && data.ean) payload['ean'] = data.ean;

  if (fieldSelection?.images && session.images.length > 0) {
    const images: Record<string, string> = {};
    session.images.slice(0, 16).forEach((img, i) => {
      images[String(i)] = img.startsWith('http') ? `url:${img}` : img;
    });
    payload['images'] = images;
  }

  if (fieldSelection?.stock !== false && defaultWarehouse) {
    payload['stock'] = { [defaultWarehouse]: 0 };
  }

  if (mode === 'edit' && session.product_id) {
    payload['product_id'] = session.product_id;
  }
  if (mode === 'variant' && session.parent_id) {
    payload['parent_id'] = session.parent_id;
  }
  if (mode === 'bundle' && session.bundle_products) {
    payload['bundle_products'] = session.bundle_products;
  }

  return payload;
}
