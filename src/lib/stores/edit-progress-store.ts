import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface EditProgressEntry {
  productId: string;
  startedAt: number;
  lastTouchedAt: number;
  lastStep?: string;
  hasGeneratedDescription?: boolean;
  hasFilledParameters?: boolean;
}

interface EditProgressState {
  entries: Record<string, EditProgressEntry>;
  markProgress: (productId: string, patch?: Partial<Omit<EditProgressEntry, 'productId' | 'startedAt'>>) => void;
  clearProgress: (productId: string) => void;
  isInProgress: (productId: string) => boolean;
  getEntry: (productId: string) => EditProgressEntry | undefined;
}

export const useEditProgressStore = create<EditProgressState>()(
  persist(
    (set, get) => ({
      entries: {},
      markProgress: (productId, patch) => {
        const now = Date.now();
        set((state) => {
          const existing = state.entries[productId];
          return {
            entries: {
              ...state.entries,
              [productId]: {
                productId,
                startedAt: existing?.startedAt ?? now,
                lastTouchedAt: now,
                ...patch,
              },
            },
          };
        });
      },
      clearProgress: (productId) =>
        set((state) => {
          const next = { ...state.entries };
          delete next[productId];
          return { entries: next };
        }),
      isInProgress: (productId) => Boolean(get().entries[productId]),
      getEntry: (productId) => get().entries[productId],
    }),
    { name: 'bl-edit-progress' },
  ),
);
