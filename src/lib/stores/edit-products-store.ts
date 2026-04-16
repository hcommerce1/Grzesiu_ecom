import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BLProductType, ProductSession, GeneratedDescription } from '../types';

export interface EditBatchConfig {
  diffFields: string[];
  extraAttributesToExtract: string[];
  keepExistingImages: boolean;
}

export interface EditProductsFilters {
  search: string;
  manufacturer: string;
  productType: BLProductType | '';
  // Advanced filters
  priceMin: string;
  priceMax: string;
  stockStatus: '' | 'available' | 'unavailable';
  taxRate: string;
  location: string;
  descriptionSearch: string;
  quantityMin: string;
  quantityMax: string;
}

export type SortField = 'name' | 'ean' | 'sku' | 'id' | 'price' | 'quantity' | null;
export type SortDirection = 'asc' | 'desc';

interface EditProductsState {
  // Selection
  selectedIds: Set<string>;
  toggleSelection: (id: string) => void;
  selectIds: (ids: string[]) => void;
  deselectAll: () => void;

  // Filters
  filters: EditProductsFilters;
  setFilter: <K extends keyof EditProductsFilters>(key: K, value: EditProductsFilters[K]) => void;
  resetFilters: () => void;

  // Sorting
  sortField: SortField;
  sortDirection: SortDirection;
  setSort: (field: SortField) => void;

  // Filter-change tracking for warning
  selectionFilterHash: string | null;

  // Pagination
  currentPage: number;
  itemsPerPage: number;
  setCurrentPage: (page: number) => void;
  setItemsPerPage: (n: number) => void;

  // Batch edit (sequential)
  batchQueue: string[] | null;
  batchIndex: number;
  startBatch: (ids: string[]) => void;
  advanceBatch: () => void;
  cancelBatch: () => void;

  // Batch config (set before entering edit queue)
  editBatchConfig: EditBatchConfig | null;
  setEditBatchConfig: (config: EditBatchConfig | null) => void;

  // Auto-apply modal
  showApplyModal: boolean;
  setShowApplyModal: (v: boolean) => void;
  completedTemplateSession: ProductSession | null;
  setCompletedTemplateSession: (s: ProductSession | null) => void;
  completedDescriptionTemplate: GeneratedDescription | null;
  setCompletedDescriptionTemplate: (d: GeneratedDescription | null) => void;
  completedTitleTemplate: string | null;
  setCompletedTitleTemplate: (t: string | null) => void;

  // Edit batch job progress
  editBatchJobId: string | null;
  setEditBatchJobId: (id: string | null) => void;
}

const DEFAULT_FILTERS: EditProductsFilters = {
  search: '',
  manufacturer: '',
  productType: '',
  priceMin: '',
  priceMax: '',
  stockStatus: '',
  taxRate: '',
  location: '',
  descriptionSearch: '',
  quantityMin: '',
  quantityMax: '',
};

function filterHash(filters: EditProductsFilters): string {
  return JSON.stringify(filters);
}

export const useEditProductsStore = create<EditProductsState>()(
  persist(
    (set, get) => ({
      // Selection
      selectedIds: new Set<string>(),
      toggleSelection: (id) =>
        set((state) => {
          const next = new Set(state.selectedIds);
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          // Capture filter hash on first selection
          const hash = next.size > 0 && state.selectionFilterHash === null
            ? filterHash(state.filters)
            : state.selectionFilterHash;
          return { selectedIds: next, selectionFilterHash: next.size === 0 ? null : hash };
        }),
      selectIds: (ids) =>
        set((state) => {
          const next = new Set(state.selectedIds);
          for (const id of ids) next.add(id);
          const hash = next.size > 0 && state.selectionFilterHash === null
            ? filterHash(state.filters)
            : state.selectionFilterHash;
          return { selectedIds: next, selectionFilterHash: hash };
        }),
      deselectAll: () => set({ selectedIds: new Set(), selectionFilterHash: null }),

      // Filters
      filters: { ...DEFAULT_FILTERS },
      setFilter: (key, value) =>
        set((state) => ({
          filters: { ...state.filters, [key]: value },
          currentPage: 1,
        })),
      resetFilters: () => set({ filters: { ...DEFAULT_FILTERS }, currentPage: 1 }),

      // Sorting
      sortField: null,
      sortDirection: 'asc',
      setSort: (field) =>
        set((state) => {
          if (state.sortField === field) {
            return { sortDirection: state.sortDirection === 'asc' ? 'desc' : 'asc' };
          }
          return { sortField: field, sortDirection: 'asc' };
        }),

      // Filter hash
      selectionFilterHash: null,

      // Pagination
      currentPage: 1,
      itemsPerPage: 25,
      setCurrentPage: (page) => set({ currentPage: page }),
      setItemsPerPage: (n) => set({ itemsPerPage: n, currentPage: 1 }),

      // Batch edit (sequential)
      batchQueue: null,
      batchIndex: 0,
      startBatch: (ids) => set({ batchQueue: ids, batchIndex: 0 }),
      advanceBatch: () => {
        const { batchQueue, batchIndex } = get();
        if (!batchQueue) return;
        const nextIndex = batchIndex + 1;
        if (nextIndex >= batchQueue.length) {
          set({ batchQueue: null, batchIndex: 0, selectedIds: new Set(), selectionFilterHash: null });
        } else {
          set({ batchIndex: nextIndex });
        }
      },
      cancelBatch: () => set({ batchQueue: null, batchIndex: 0 }),

      // Batch config
      editBatchConfig: null,
      setEditBatchConfig: (config) => set({ editBatchConfig: config }),

      // Auto-apply modal
      showApplyModal: false,
      setShowApplyModal: (v) => set({ showApplyModal: v }),
      completedTemplateSession: null,
      setCompletedTemplateSession: (s) => set({ completedTemplateSession: s }),
      completedDescriptionTemplate: null,
      setCompletedDescriptionTemplate: (d) => set({ completedDescriptionTemplate: d }),
      completedTitleTemplate: null,
      setCompletedTitleTemplate: (t) => set({ completedTitleTemplate: t }),

      // Edit batch job progress
      editBatchJobId: null,
      setEditBatchJobId: (id) => set({ editBatchJobId: id }),
    }),
    {
      name: 'bl-edit-products',
      partialize: (state) => ({
        itemsPerPage: state.itemsPerPage,
        sortField: state.sortField,
        sortDirection: state.sortDirection,
      }),
      // Set needs custom serialization — only persist itemsPerPage + sort
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<EditProductsState>),
        // Ensure transient state is always reset
        selectedIds: new Set<string>(),
        selectionFilterHash: null,
        filters: { ...DEFAULT_FILTERS },
        currentPage: 1,
        batchQueue: null,
        batchIndex: 0,
        editBatchConfig: null,
        showApplyModal: false,
        completedTemplateSession: null,
        completedDescriptionTemplate: null,
        completedTitleTemplate: null,
        editBatchJobId: null,
      }),
    }
  )
);
