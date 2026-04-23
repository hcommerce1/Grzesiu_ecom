import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SellerScrapeSession, SellerScrapedListing, DiffFieldInfo, ProductSession } from '@/lib/types';

export type SellerScraperStep =
  | 'input'
  | 'scraping'
  | 'grid'
  | 'deep-scrape'
  | 'grouping'
  | 'diff-fields'
  | 'template'
  | 'desc-template'
  | 'review';

interface SellerScraperStore {
  sessionId: string | null;
  step: SellerScraperStep;
  session: SellerScrapeSession | null;
  listings: SellerScrapedListing[];
  groups: Record<string, string[]>; // groupName → listingIds[]
  activeGroup: string | null;       // group being configured for listing
  diffFields: DiffFieldInfo[];
  selectedDiffFields: string[];
  templateSession: ProductSession | null;
  currentPage: number;
  totalPages: number;
  /** URL of a reference product for description context */
  referenceProductUrl: string;
  /** Scraped text description from reference URL */
  referenceProductDescription: string;

  // Actions
  setStep: (step: SellerScraperStep) => void;
  setReferenceProductUrl: (url: string) => void;
  setReferenceProductDescription: (desc: string) => void;
  setSession: (session: SellerScrapeSession, sessionId: string) => void;
  setListings: (listings: SellerScrapedListing[]) => void;
  addListings: (listings: SellerScrapedListing[]) => void;
  updateListing: (id: string, patch: Partial<SellerScrapedListing>) => void;
  toggleSelected: (id: string) => void;
  selectAll: (selected: boolean) => void;
  setGroups: (groups: Record<string, string[]>) => void;
  moveToGroup: (listingIds: string[], groupName: string) => void;
  createGroup: (name: string) => void;
  setActiveGroup: (name: string | null) => void;
  setDiffFields: (fields: DiffFieldInfo[]) => void;
  setSelectedDiffFields: (fields: string[]) => void;
  toggleDiffField: (field: string) => void;
  setTemplateSession: (session: ProductSession) => void;
  setCurrentPage: (page: number) => void;
  setTotalPages: (pages: number) => void;
  reset: () => void;
}

const initialState = {
  sessionId: null,
  step: 'input' as SellerScraperStep,
  session: null,
  listings: [],
  groups: {},
  activeGroup: null,
  diffFields: [],
  selectedDiffFields: [],
  templateSession: null,
  currentPage: 1,
  totalPages: 0,
  referenceProductUrl: '',
  referenceProductDescription: '',
};

export const useSellerScraperStore = create<SellerScraperStore>()(
  persist(
    (set) => ({
      ...initialState,

      setStep: (step) => set({ step }),

      setReferenceProductUrl: (url) => set({ referenceProductUrl: url }),

      setReferenceProductDescription: (desc) => set({ referenceProductDescription: desc }),

      setSession: (session, sessionId) => set({ session, sessionId }),

      setListings: (listings) => set({ listings }),

      addListings: (newListings) => set(state => ({
        listings: [...state.listings, ...newListings.filter(nl => !state.listings.some(l => l.id === nl.id))],
      })),

      updateListing: (id, patch) => set(state => ({
        listings: state.listings.map(l => l.id === id ? { ...l, ...patch } : l),
      })),

      toggleSelected: (id) => set(state => ({
        listings: state.listings.map(l => l.id === id ? { ...l, selected: !l.selected } : l),
      })),

      selectAll: (selected) => set(state => ({
        listings: state.listings.map(l => ({ ...l, selected })),
      })),

      setGroups: (groups) => set({ groups }),

      moveToGroup: (listingIds, groupName) => set(state => {
        const newGroups: Record<string, string[]> = {};
        // Remove ids from all existing groups
        for (const [name, ids] of Object.entries(state.groups)) {
          const filtered = ids.filter(id => !listingIds.includes(id));
          if (filtered.length > 0 || name === groupName) {
            newGroups[name] = filtered;
          }
        }
        // Add to target group
        if (!newGroups[groupName]) newGroups[groupName] = [];
        newGroups[groupName] = [...new Set([...newGroups[groupName], ...listingIds])];
        // Clean up empty groups (e.g. leftover from createGroup with no items)
        const cleanedGroups = Object.fromEntries(
          Object.entries(newGroups).filter(([, ids]) => ids.length > 0)
        );
        // Update listing group names
        const updatedListings = state.listings.map(l =>
          listingIds.includes(l.id) ? { ...l, groupName } : l
        );
        return { groups: cleanedGroups, listings: updatedListings };
      }),

      createGroup: (name) => set(state => ({
        groups: { ...state.groups, [name]: state.groups[name] ?? [] },
      })),

      setActiveGroup: (name) => set({ activeGroup: name }),

      setDiffFields: (fields) => set({
        diffFields: fields,
        selectedDiffFields: fields.filter(f => f.isDiff).map(f => f.field),
      }),

      setSelectedDiffFields: (fields) => set({ selectedDiffFields: fields }),

      toggleDiffField: (field) => set(state => ({
        selectedDiffFields: state.selectedDiffFields.includes(field)
          ? state.selectedDiffFields.filter(f => f !== field)
          : [...state.selectedDiffFields, field],
      })),

      setTemplateSession: (session) => set({ templateSession: session }),

      setCurrentPage: (page) => set({ currentPage: page }),

      setTotalPages: (pages) => set({ totalPages: pages }),

      reset: () => set(initialState),
    }),
    {
      name: 'seller-scraper-store',
      partialize: (state) => ({
        sessionId: state.sessionId,
        step: state.step,
        session: state.session,
        listings: state.listings,
        groups: state.groups,
        activeGroup: state.activeGroup,
        diffFields: state.diffFields,
        selectedDiffFields: state.selectedDiffFields,
        templateSession: state.templateSession,
        currentPage: state.currentPage,
        totalPages: state.totalPages,
      }),
    }
  )
);
