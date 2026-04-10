export interface ProductData {
  title: string;
  images: string[];
  description: string;
  attributes: Record<string, string>;
  price?: string;
  currency?: string;
  ean?: string;
  sku?: string;
  url: string;
}

export interface ScrapeResult {
  success: true;
  data: ProductData;
  originalData?: ProductData;
}

export interface ScrapeError {
  success: false;
  error: string;
  errorType: 'ACCESS_DENIED' | 'TIMEOUT' | 'INVALID_URL' | 'PARSE_ERROR' | 'UNKNOWN';
}

export type ScrapeResponse = ScrapeResult | ScrapeError;

export type SiteExtractor = (page: import('playwright').Page, url: string) => Promise<ProductData>;

// ─── Allegro Types ───
export interface AllegroCategory {
  id: string;
  name: string;
  path: string;
  leaf: boolean;
  parent?: { id: string };
}

export interface AllegroParameterOption {
  id: string;
  value: string;
}

export interface AllegroParameter {
  id: string;
  name: string;
  type: 'integer' | 'float' | 'string' | 'dictionary' | 'boolean' | 'date' | 'datetime';
  required: boolean;
  unit?: string;
  restrictions?: {
    min?: number;
    max?: number;
    allowedValues?: AllegroParameterOption[];
    multipleChoices?: boolean;
  };
  options?: AllegroParameterOption[];
}

export interface AllegroToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

// ─── BaseLinker Types ───
export interface BLInventory {
  inventory_id: number;
  name: string;
  description: string;
  languages: string[];
  default_language: string;
  price_groups: number[];
  warehouses: string[];
}

export interface BLWarehouse {
  warehouse_id: string;
  name: string;
  description: string;
}

export interface BLPriceGroup {
  price_group_id: number;
  name: string;
  description: string;
  currency: string;
}

export interface BLExtraField {
  extra_field_id: number;
  name: string;
  kind: 'text' | 'number' | 'list';
  editor: string;
}

export interface BLManufacturer {
  manufacturer_id: number;
  name: string;
}

export interface BLCache {
  timestamp: number;
  inventories: BLInventory[];
  warehouses: BLWarehouse[];
  priceGroups: BLPriceGroup[];
  extraFields: BLExtraField[];
  manufacturers: BLManufacturer[];
  integrations: unknown[];
  textFieldKeys: string[];
}

// ─── Product Session ───
export type ProductMode = 'new' | 'edit' | 'variant' | 'bundle';

export interface FieldSelection {
  // mandatory (always true)
  inventory_id: true;
  is_bundle: true;
  tax_rate: true;
  name: true;
  // optional
  sku: boolean;
  ean: boolean;
  asin: boolean;
  description: boolean;
  images: boolean;
  description_extra1: boolean;
  features: boolean;
  weight: boolean;
  dimensions: boolean;
  stock: boolean;
  prices: boolean;
  locations: boolean;
  manufacturer_id: boolean;
  category_id: boolean;
  average_cost: boolean;
  tags: boolean;
  // edit-only
  product_id?: boolean;
  // variant-only
  parent_id?: boolean;
  // bundle-only
  bundle_products?: boolean;
  // dynamic extra fields
  [key: string]: boolean | true | undefined;
}

export interface ProductSession {
  mode: ProductMode;
  product_id?: string;
  parent_id?: string;
  bundle_products?: Record<string, number>;
  data: ProductData;
  allegroCategory?: AllegroCategory;
  allegroParameters?: AllegroParameter[];
  filledParameters?: Record<string, string | string[]>;
  commissionInfo?: string;
  images: string[];
  tax_rate: number;
  inventoryId?: number;
  defaultWarehouse?: string;
  fieldSelection?: Partial<FieldSelection>;
  ready: boolean;
}
