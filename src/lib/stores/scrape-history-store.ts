import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProductData } from '../types';

const MAX_HISTORY = 50;

const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'msclkid', 'ref', 'ref_',
];

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hostname = u.hostname.replace(/^www\./, '').toLowerCase();
    for (const p of TRACKING_PARAMS) u.searchParams.delete(p);
    u.searchParams.sort();
    let out = u.toString();
    if (out.endsWith('/')) out = out.slice(0, -1);
    return out;
  } catch {
    return raw.trim().toLowerCase();
  }
}

export interface ScrapeHistoryEntry {
  url: string;
  product: ProductData;
  originalProduct?: ProductData | null;
  scrapedAt: number;
  hostname: string;
  thumbnail: string | null;
  title: string;
}

interface ScrapeHistoryState {
  entries: Record<string, ScrapeHistoryEntry>;
  order: string[]; // normalized URLs, newest first

  addEntry: (url: string, product: ProductData, originalProduct?: ProductData | null) => void;
  getEntry: (url: string) => ScrapeHistoryEntry | undefined;
  removeEntry: (url: string) => void;
  clearHistory: () => void;
}

export const useScrapeHistoryStore = create<ScrapeHistoryState>()(
  persist(
    (set, get) => ({
      entries: {},
      order: [],

      addEntry: (url, product, originalProduct) => {
        const key = normalizeUrl(url);
        let hostname = '';
        try { hostname = new URL(url).hostname.replace(/^www\./, ''); } catch { /* */ }

        const entry: ScrapeHistoryEntry = {
          url,
          product,
          originalProduct: originalProduct ?? null,
          scrapedAt: Date.now(),
          hostname,
          thumbnail: product.images?.[0] ?? null,
          title: product.title,
        };

        set((s) => {
          const newEntries = { ...s.entries, [key]: entry };
          let newOrder = [key, ...s.order.filter((k) => k !== key)];

          // trim to MAX_HISTORY
          if (newOrder.length > MAX_HISTORY) {
            const removed = newOrder.slice(MAX_HISTORY);
            newOrder = newOrder.slice(0, MAX_HISTORY);
            for (const r of removed) delete newEntries[r];
          }

          return { entries: newEntries, order: newOrder };
        });
      },

      getEntry: (url) => {
        const key = normalizeUrl(url);
        return get().entries[key];
      },

      removeEntry: (url) => {
        const key = normalizeUrl(url);
        set((s) => {
          const newEntries = { ...s.entries };
          delete newEntries[key];
          return { entries: newEntries, order: s.order.filter((k) => k !== key) };
        });
      },

      clearHistory: () => set({ entries: {}, order: [] }),
    }),
    {
      name: 'bl-scrape-history',
    }
  )
);
