import type { SiteExtractor } from '../scraper-types';
import { extractAmazon } from './amazon';
import { extractDWD } from './dwd';
import { extractAosom } from './aosom';
import { extractGeneric } from './generic';
import { extractShopify } from './shopify';
import { extractCostway } from './costway';
import { extractWoltu } from './woltu';
import { extractAllegro } from './allegro';
import { extractVidaXL } from './vidaxl';
import { extractFlexispot } from './flexispot';

/**
 * Orchestrator Router: Resolves the domain from the URL and routes to the correct scraper.
 */
export const getExtractorForUrl = (url: string): SiteExtractor => {
    try {
        const hostname = new URL(url).hostname.toLowerCase();

        if (hostname.includes('amazon.')) {
            return extractAmazon;
        }
        if (hostname.includes('dwd-company.de') || hostname.includes('shop.dwd-company.de')) {
            return extractDWD;
        }
        if (hostname.includes('aosom.')) {
            return extractAosom;
        }
        if (hostname.includes('tribesigns.') || hostname.includes('songmics.')) {
            return extractShopify;
        }

        if (hostname.includes('costway.')) {
            return extractCostway;
        }
        if (hostname.includes('flexispot.')) {
            return extractFlexispot;
        }
        if (hostname.includes('woltu.')) {
            return extractWoltu;
        }
        if (hostname.includes('allegro.pl')) {
            return extractAllegro;
        }
        if (hostname.includes('vidaxl.')) {
            return extractVidaXL;
        }

        // Fallback for all other sites
        return extractGeneric;
    } catch {
        return extractGeneric; // Default fallback if URL parsing fails
    }
};
