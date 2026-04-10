import { create } from "zustand"
import type { ProductData } from "@/lib/types"

export type ScrapedEntry = {
  id: string
  url: string
  status: "pending" | "loading" | "success" | "error"
  data?: ProductData
  originalData?: ProductData
  error?: string
}

interface ProductStore {
  entries: ScrapedEntry[]
  addEntry: (url: string) => string
  updateEntry: (id: string, patch: Partial<ScrapedEntry>) => void
  removeEntry: (id: string) => void
  clearAll: () => void

  // Active workflow product
  activeProductId: string | null
  setActiveProduct: (id: string | null) => void
}

let idCounter = 0

export const useProductStore = create<ProductStore>((set) => ({
  entries: [],
  activeProductId: null,

  addEntry: (url: string) => {
    const id = `entry-${++idCounter}`
    set((s) => ({
      entries: [...s.entries, { id, url, status: "pending" }],
    }))
    return id
  },

  updateEntry: (id, patch) =>
    set((s) => ({
      entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    })),

  removeEntry: (id) =>
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),

  clearAll: () => set({ entries: [], activeProductId: null }),

  setActiveProduct: (id) => set({ activeProductId: id }),
}))
