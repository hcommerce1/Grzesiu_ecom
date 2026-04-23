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
  // Edit mode extras
  isBundle?: boolean;
  bundleProducts?: Record<string, number>;
  taxRate?: number;
  bundleContextText?: string;
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
    minLength?: number;
    maxLength?: number;
    allowedNumberOfValues?: number;
    range?: boolean;
    precision?: number;
  };
  options?: AllegroParameterOption[];
  /** Prawdziwe API Allegro zwraca opcje w polu dictionary, nie options */
  dictionary?: AllegroParameterOption[];
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
  is_bundle: boolean;
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
  is_bundle?: boolean;
  bundle_products?: Record<string, number>;
  data: ProductData;
  allegroCategory?: AllegroCategory | null;
  allegroParameters?: AllegroParameter[] | null;
  filledParameters?: Record<string, string | string[]> | null;
  commissionInfo?: string;
  images: string[];
  tax_rate: number | string;
  editableFieldValues?: Record<string, string>;
  inventoryId?: number;
  defaultWarehouse?: string;
  fieldSelection?: Partial<FieldSelection>;
  extraFieldValues?: Record<string, string>;
  ready: boolean;
  // Image management & description generation
  imagesMeta?: ImageMeta[];
  generatedTitle?: string;
  titleCandidates?: string[];
  generatedDescription?: GeneratedDescription;
  descriptionInputSnapshot?: DescriptionInputSnapshot;
  descriptionPrompt?: string;
  /** History of description versions (max 20, newest at end) — allows cofanie zmian */
  descriptionVersions?: DescriptionVersion[];
  // AI auto-fill results (persisted so they survive page reload)
  aiFillResults?: AutoFillEntry[];
  // Google Sheets integration
  sheetProductId?: string;
  sheetMeta?: SheetMeta;
  // Workflow step persistence (for resume)
  currentStep?: string;
  // Price group ID for BaseLinker (keyed prices payload)
  defaultPriceGroup?: string;
}

// ─── Google Sheets Types ───

export interface SheetMeta {
  uwagiKrotkie: string;
  uwagiMagazynowe: string;
  zdjecie: string;
  paleta: string;
  stanTechniczny: string;
  kolor: string;
  opakowanie: string;
  rozmiarGabaryt: string;
  model: string;
  waga: string;
  dlugosc: string;
  szerokosc: string;
  wysokosc: string;
  /** Dynamic extra columns from the sheet (header name → value) */
  [key: string]: string;
}

export interface ParameterMatchResult {
  parameterId: string;
  parameterName: string;
  sheetColumn: string;
  sheetValue: string;
  matchedOptionId: string | null;
  matchedOptionValue: string | null;
  confidence: number;
  matchType: 'exact' | 'normalized' | 'contains' | 'fuzzy' | 'direct' | 'none';
}

// ─── Image & Description Generation Types ───

export interface ImageMeta {
  url: string
  order: number
  removed: boolean
  aiDescription: string
  aiConfidence: number
  userDescription: string
  isFeatureImage: boolean
  features: string[]
  uploadedVia?: 'r2' | 'cloudinary'
}

export interface DescriptionSection {
  id: string
  imageUrls: string[]
  heading: string
  bodyHtml: string
  layout: 'image-text' | 'images-only' | 'text-only'
}

export interface GeneratedDescription {
  sections: DescriptionSection[]
  fullHtml: string
  generatedAt: string
  inputHash: string
}

export interface DescriptionInputSnapshot {
  title: string
  imagesMeta: ImageMeta[]
  filledParameters: Record<string, string | string[]>
  categoryId: string
  translatedAttributes: Record<string, string>
}

export type ChangeSeverity = 'none' | 'minor' | 'major'

export interface ChangeDetail {
  field: string
  label: string
  severity: 'minor' | 'major'
}

export interface ChangeClassification {
  severity: ChangeSeverity
  changes: ChangeDetail[]
}

export type ChatActionType =
  | 'update_title' | 'update_parameter' | 'update_section'
  | 'regenerate_description' | 'regenerate_title' | 'expand_section' | 'request_scrape'
  | 'reorder_section_images'
  | 'add_image_to_section' | 'remove_image_from_section'
  | 'remove_section' | 'add_section'
  | 'change_section_layout' | 'reorder_sections'
  | 'clear_targets'
  | 'update_price' | 'update_tax_rate' | 'update_sku' | 'update_ean'
  | 'update_inventory'
  | 'reorder_product_images' | 'add_product_image' | 'remove_product_image'
  | 'change_description_style'
  | 'ask_user'

export interface ChatAction {
  type: ChatActionType
  title?: string
  parameterId?: string
  parameterValue?: string | string[]
  sectionId?: string
  heading?: string
  bodyHtml?: string
  scrapeUrl?: string
  /** For reorder_section_images / reorder_product_images: new ordered list of image URLs */
  imageUrls?: string[]
  /** Single image URL for add/remove image actions */
  imageUrl?: string
  /** Section layout for change_section_layout */
  layout?: 'image-text' | 'images-only' | 'text-only'
  /** Ordered section IDs for reorder_sections */
  sectionIds?: string[]
  /** Insert after this section for add_section */
  afterSectionId?: string
  /** Price / SKU / EAN / tax / inventory payloads */
  priceValue?: string
  currencyValue?: string
  taxRateValue?: number | string
  skuValue?: string
  eanValue?: string
  inventoryId?: number
  warehouseId?: string
  /** Description style change */
  styleValue?: 'technical' | 'lifestyle' | 'simple'
  /** ask_user question + options shown as quick chips */
  question?: string
  options?: string[]
}

// ─── Section Targeting ───

export interface TargetableSection {
  id: string
  label: string
  type: 'title' | 'description-section' | 'parameters' | 'images'
}

// ─── Description Versioning ───

export interface DescriptionVersion {
  sections: DescriptionSection[]
  fullHtml: string
  title: string
  timestamp: string
  label?: string
}

// ─── AI Auto-Fill Types ───

export interface AutoFillEntry {
  parameterId: string;
  value: string | string[];
  confidence: number;
  source: string;
}

export interface AutoFillResult {
  filled: Record<string, string | string[]>;
  details: AutoFillEntry[];
  unfilled: string[];
}

// ─── Edit Products Tab Types ───

export type BLProductType = 'basic' | 'parent' | 'variant' | 'bundle';

export interface BLProductListItem {
  id: string;
  ean: string;
  sku: string;
  name: string;
  quantity: number;
  price: number;
  thumbnailUrl: string | null;
  manufacturerId: number;
  manufacturerName: string;
  productType: BLProductType;
  parentId?: string;
  isBundle: boolean;
}

// ─── Image Generation Types ───

export type ImageGenIntent = 'background_removal' | 'simple_edit' | 'generation' | 'context_edit';
export type ImageGenProvider = 'removebg' | 'replicate' | 'nanobananapro' | 'fluxcontextpro';
export type ImageGenPreference = 'nanobananapro' | 'fluxcontextpro';

export interface PromptClassification {
  intent: ImageGenIntent;
  recommendedProvider: ImageGenProvider;
  translatedPrompt: string;
  originalPrompt: string;
  confidence: number;
  suggestion?: string;
  isValid: boolean;
  rejectionReason?: string;
}

export interface ImageGenRequest {
  prompt: string;
  sourceImageUrl?: string;
  provider?: ImageGenProvider;
  preference?: ImageGenPreference;
}

export interface ImageGenResult {
  success: boolean;
  imageUrl?: string;
  provider: ImageGenProvider;
  error?: string;
  costEstimate?: string;
}

// ─── Batch Jobs Types ───

export type BatchStatus = 'pending' | 'running' | 'paused' | 'done' | 'error'
export type BatchItemStatus = 'pending' | 'processing' | 'done' | 'error' | 'skipped'
export type BatchType = 'independent' | 'variants'

export interface BatchJob {
  id: string
  source: string
  sourceId?: string
  label: string
  status: BatchStatus
  batchType: BatchType
  templateSession: ProductSession
  diffFields: string[]
  descriptionTemplate?: GeneratedDescription
  titleTemplate?: string
  totalItems: number
  completedItems: number
  failedItems: number
  parentProductId?: string
  lastActivity?: string
  createdAt: string
  updatedAt: string
}

export interface BatchJobItem {
  id: string
  batchJobId: string
  orderIndex: number
  status: BatchItemStatus
  productData: ProductData
  blProductId?: string
  errorMessage?: string
  overrideData?: Partial<ProductData>
  label?: string
  thumbnailUrl?: string
  sourceListingId?: string
}

export interface BatchJobProgress {
  total: number
  done: number
  failed: number
  pending: number
  skipped: number
}

// ─── Seller Scraper Types ───

export interface SellerScrapeSession {
  id: string
  sellerUrl: string
  sellerUsername: string
  siteHostname: string
  queryFilter?: string
  status: 'pending' | 'scraping' | 'done' | 'error'
  totalPages: number
  scrapedPages: number
  totalProducts: number
  errorMessage?: string
  createdAt: string
  updatedAt: string
}

export interface SellerScrapedListing {
  id: string
  sessionId: string
  productUrl: string
  productIdExt?: string
  title: string
  thumbnailUrl?: string
  price?: string
  currency: string
  pageNumber: number
  selected: boolean
  groupName?: string
  deepScraped: boolean
  deepScrapeData?: ProductData
  deepScrapeError?: string
}

// ─── Listing Scraper Types ───

export interface ListingProduct {
  url: string
  externalId?: string
  title: string
  thumbnailUrl?: string
  price?: string
  currency?: string
}

export interface ListingPageResult {
  products: ListingProduct[]
  currentPage: number
  totalPages: number
}

// ─── Diff Fields Types ───

export interface DiffFieldInfo {
  field: string       // "title" | "images" | "ean" | "price" | "attr:Kolor" | ...
  label: string       // "Tytuł" | "Zdjęcia" | "EAN" | "Cena" | "Kolor" | ...
  isDiff: boolean
  uniqueValues: string[]
  totalUnique: number
  coverage: number    // 0-1
}
