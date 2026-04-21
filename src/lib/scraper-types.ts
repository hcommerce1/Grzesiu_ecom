import type { ProductData } from './types';

export type SiteExtractor = (page: import('playwright').Page, url: string) => Promise<ProductData>;
