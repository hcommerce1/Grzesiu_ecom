"use client"

import { useState, useRef, useEffect } from "react"
import { SearchBar } from "@/components/SearchBar"
import { CollapsibleProductItem, type ScrapedItem } from "@/components/CollapsibleProductItem"
import { AppHeader } from "@/components/AppHeader"
import { EditProductsTab } from "@/components/EditProductsTab"
import { motion, AnimatePresence } from "framer-motion"
import { staggerContainer, staggerItem } from "@/components/motion/variants"
import { Package, Loader2, Search, BarChart2, FileSpreadsheet, Layers } from "lucide-react"
import { cn } from "@/lib/utils"
import { GoogleSheetsTab } from "@/components/GoogleSheetsTab"
import { AllegroAuthGate } from "@/components/AllegroAuthGate"
import { ScrapeHistoryPanel } from "@/components/ScrapeHistoryPanel"
import { useScrapeHistoryStore, type ScrapeHistoryEntry } from "@/lib/stores/scrape-history-store"
import { useUserStore } from "@/lib/stores/user-store"
import { MassListingTab } from "@/components/MassListingTab"
import type { ScrapeResponse } from "@/lib/types"

type Tab = "nowe" | "edytuj" | "sheets" | "mass-listing"

let idCounter = 0

export default function Home() {
  const [tab, setTab] = useState<Tab>("nowe")
  const [items, setItems] = useState<ScrapedItem[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [processedCount, setProcessedCount] = useState(0)

  const abortRef = useRef<AbortController | null>(null)
  const processingRef = useRef(false)
  const queueRef = useRef<{ id: string; url: string }[]>([])
  const { getEntry, addEntry } = useScrapeHistoryStore()
  const { user, fetchUser } = useUserStore()

  useEffect(() => {
    fetchUser()
  }, [])

  const handleLoadFromHistory = (entry: ScrapeHistoryEntry) => {
    const item: ScrapedItem = {
      id: `e${++idCounter}`,
      url: entry.url,
      status: "success",
      product: entry.product,
      originalProduct: entry.originalProduct,
    }
    setItems([item])
  }

  const processQueue = async (ctrl: AbortController) => {
    while (queueRef.current.length > 0 && !ctrl.signal.aborted) {
      const { id, url } = queueRef.current.shift()!

      // Check history cache
      const cached = getEntry(url)
      if (cached) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === id ? { ...it, status: "success", product: cached.product, originalProduct: cached.originalProduct } : it
          )
        )
        setProcessedCount((c) => c + 1)
        continue
      }

      setItems((prev) => prev.map((it) => it.id === id ? { ...it, status: "loading" } : it))

      try {
        const res = await fetch("/api/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
          signal: ctrl.signal,
        })
        const data: ScrapeResponse = await res.json()
        if (ctrl.signal.aborted) break

        if (data.success) {
          addEntry(url, data.data, data.originalData)
          setItems((prev) =>
            prev.map((it) =>
              it.id === id ? { ...it, status: "success", product: data.data, originalProduct: data.originalData } : it
            )
          )
        } else {
          setItems((prev) =>
            prev.map((it) => it.id === id ? { ...it, status: "error", error: data.error } : it)
          )
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") break
        setItems((prev) =>
          prev.map((it) =>
            it.id === id ? { ...it, status: "error", error: err instanceof Error ? err.message : "Błąd sieci" } : it
          )
        )
      }

      setProcessedCount((c) => c + 1)
      if (queueRef.current.length > 0 && !ctrl.signal.aborted) {
        await new Promise((r) => setTimeout(r, 1200))
      }
    }
  }

  const handleScrapeBatch = async (urls: string[]) => {
    if (urls.length === 0) return

    const newItems: ScrapedItem[] = urls.map((url) => ({
      id: `e${++idCounter}`,
      url,
      status: "pending" as const,
    }))

    // If already processing, append to queue
    if (processingRef.current) {
      setItems((prev) => [...prev, ...newItems])
      queueRef.current.push(...newItems.map((it) => ({ id: it.id, url: it.url })))
      return
    }

    setItems((prev) => [...prev.filter(it => it.status === "success" || it.status === "error"), ...newItems])
    setIsProcessing(true)
    setProcessedCount(0)
    processingRef.current = true

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    queueRef.current = newItems.map((it) => ({ id: it.id, url: it.url }))
    await processQueue(ctrl)

    if (!ctrl.signal.aborted) {
      setIsProcessing(false)
      processingRef.current = false
    }
  }

  const handleRemove = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id))
  }

  const doneCount = items.filter((i) => i.status === "success" || i.status === "error").length

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <main className="w-full max-w-[1920px] mx-auto px-4 md:px-6 lg:px-10 py-6 space-y-8">
        <AllegroAuthGate>
        {/* Tab switcher */}
        <div className="flex items-center gap-1 border-b border-border">
          <button
            onClick={() => setTab("nowe")}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
              tab === "nowe"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <BarChart2 className="size-4" />
            Nowe produkty
          </button>
          <button
            onClick={() => setTab("edytuj")}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
              tab === "edytuj"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Search className="size-4" />
            Edytuj istniejące
          </button>
          <button
            onClick={() => setTab("sheets")}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
              tab === "sheets"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <FileSpreadsheet className="size-4" />
            Google Sheets
          </button>

          <button
            onClick={() => setTab("mass-listing")}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
              tab === "mass-listing"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Layers className="size-4" />
            Wystawianie masowe
          </button>

          <div className="flex-1" />
        </div>

        {/* Tab: Nowe produkty */}
        {tab === "nowe" && (
          <div className="space-y-6">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Scrapuj produkty</h2>
              <p className="text-sm text-muted-foreground">
                Wklej linki do produktów — jeden per linia. Każdy zostanie przetworzony oddzielnie przez scraper i AI.
              </p>
            </div>

            <SearchBar onSubmit={handleScrapeBatch} isLoading={isProcessing} />

            <ScrapeHistoryPanel onLoadEntry={handleLoadFromHistory} />

            {/* Progress bar */}
            {items.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3"
              >
                <div className="flex items-center gap-2 text-sm">
                  {isProcessing && <Loader2 className="size-4 animate-spin text-primary" />}
                  <span className="font-medium">
                    {isProcessing ? "Przetwarzanie..." : "Gotowe"}
                  </span>
                </div>
                <span className="text-sm text-muted-foreground">
                  {doneCount} / {items.length} produktów
                </span>
              </motion.div>
            )}

            {/* Results */}
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="size-16 rounded-2xl bg-muted border border-border flex items-center justify-center mb-4">
                  <Package className="size-8 text-muted-foreground/60" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Wklej linki powyżej i kliknij <strong>Scrapuj</strong>, aby pobrać dane produktów.
                </p>
              </div>
            ) : (
              <motion.div
                variants={staggerContainer}
                initial="hidden"
                animate="visible"
                className="space-y-3"
              >
                <AnimatePresence>
                  {items.map((item, i) => (
                    <motion.div key={item.id} variants={staggerItem}>
                      <CollapsibleProductItem item={item} index={i} onRemove={handleRemove} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </div>
        )}

        {/* Tab: Edytuj istniejące — kept mounted to preserve detail cache */}
        <div style={{ display: tab === "edytuj" ? undefined : "none" }}>
          <EditProductsTab />
        </div>

        {/* Tab: Google Sheets — kept mounted to preserve state */}
        <div style={{ display: tab === "sheets" ? undefined : "none" }}>
          <GoogleSheetsTab />
        </div>

        {/* Tab: Wystawianie masowe */}
        <div style={{ display: tab === "mass-listing" ? undefined : "none" }}>
          <MassListingTab user={user} />
        </div>
        </AllegroAuthGate>
      </main>

    </div>
  )
}
