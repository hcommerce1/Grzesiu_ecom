"use client"

import { useState, useCallback, useRef } from "react"
import { SearchBar } from "@/components/SearchBar"
import { CollapsibleProductItem, type ScrapedItem } from "@/components/CollapsibleProductItem"
import { AppHeader } from "@/components/AppHeader"
import { ProductSearch } from "@/components/ProductSearch"
import { WorkflowStarter } from "@/components/WorkflowStarter"
import { motion, AnimatePresence } from "framer-motion"
import { staggerContainer, staggerItem } from "@/components/motion/variants"
import { Package, Loader2, Plus, Search, BarChart2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ScrapeResponse } from "@/lib/types"

type Tab = "nowe" | "edytuj"

let idCounter = 0

export default function Home() {
  const [tab, setTab] = useState<Tab>("nowe")
  const [items, setItems] = useState<ScrapedItem[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState("")
  const [showWorkflowStarter, setShowWorkflowStarter] = useState(false)
  const [processedCount, setProcessedCount] = useState(0)

  const abortRef = useRef<AbortController | null>(null)

  const handlePromptChange = useCallback((p: string) => setSystemPrompt(p), [])

  const handleScrapeBatch = async (urls: string[]) => {
    if (urls.length === 0) return

    const newItems: ScrapedItem[] = urls.map((url) => ({
      id: `e${++idCounter}`,
      url,
      status: "pending",
    }))
    setItems(newItems)
    setIsProcessing(true)
    setProcessedCount(0)

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    for (let i = 0; i < urls.length; i++) {
      if (ctrl.signal.aborted) break

      setItems((prev) => prev.map((it, idx) => idx === i ? { ...it, status: "loading" } : it))

      try {
        const res = await fetch("/api/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: urls[i], systemPrompt }),
          signal: ctrl.signal,
        })
        const data: ScrapeResponse = await res.json()
        if (ctrl.signal.aborted) break

        if (data.success) {
          setItems((prev) =>
            prev.map((it, idx) =>
              idx === i ? { ...it, status: "success", product: data.data, originalProduct: data.originalData } : it
            )
          )
        } else {
          setItems((prev) =>
            prev.map((it, idx) => idx === i ? { ...it, status: "error", error: data.error } : it)
          )
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") break
        setItems((prev) =>
          prev.map((it, idx) =>
            idx === i ? { ...it, status: "error", error: err instanceof Error ? err.message : "Błąd sieci" } : it
          )
        )
      }

      setProcessedCount(i + 1)
      if (i < urls.length - 1 && !ctrl.signal.aborted) {
        await new Promise((r) => setTimeout(r, 1200))
      }
    }

    if (!ctrl.signal.aborted) setIsProcessing(false)
  }

  const handleRemove = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id))
  }

  const doneCount = items.filter((i) => i.status === "success" || i.status === "error").length

  return (
    <div className="min-h-screen bg-background">
      <AppHeader onPromptChange={handlePromptChange} />

      <main className="max-w-[1400px] mx-auto px-6 py-8 space-y-8">
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

          <div className="flex-1" />

          <Button
            size="sm"
            onClick={() => setShowWorkflowStarter(true)}
            className="gap-1.5 mb-2"
          >
            <Plus className="size-4" />
            <span className="hidden sm:inline">Ręczna oferta BL</span>
          </Button>
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
                  <Package className="size-8 text-muted-foreground/40" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Wklej linki powyżej i kliknij <strong>Scrapuj</strong>, aby pobrać dane produktów.
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1.5">
                  Obsługiwane: Amazon, Oninen, Costway, DWD, Aosom, Woltu i inne
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

        {/* Tab: Edytuj istniejące */}
        {tab === "edytuj" && <ProductSearch />}
      </main>

      {/* Workflow Starter Modal */}
      {showWorkflowStarter && (
        <WorkflowStarter
          onClose={() => setShowWorkflowStarter(false)}
          onStarted={({ sourceUrl }) => {
            setShowWorkflowStarter(false)
            if (sourceUrl) handleScrapeBatch([sourceUrl])
          }}
        />
      )}
    </div>
  )
}
