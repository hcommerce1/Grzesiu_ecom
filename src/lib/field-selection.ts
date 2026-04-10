// Pure functions for field selection — safe to import in both client and server code
import type { FieldSelection, ProductMode } from './types';

export function createDefaultFieldSelection(mode: ProductMode): Partial<FieldSelection> {
  const base: Partial<FieldSelection> = {
    sku: true,
    ean: true,
    asin: false,
    description: true,
    images: true,
    description_extra1: false,
    features: true,
    weight: false,
    dimensions: false,
    stock: true,
    prices: true,
    locations: false,
    manufacturer_id: false,
    category_id: true,
    average_cost: false,
    tags: false,
  };

  if (mode === 'edit') {
    base['product_id'] = true;
  }
  if (mode === 'variant') {
    base['parent_id'] = true;
  }
  if (mode === 'bundle') {
    base['bundle_products'] = true;
  }

  return base;
}
