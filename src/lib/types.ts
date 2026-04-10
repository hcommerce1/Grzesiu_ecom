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
