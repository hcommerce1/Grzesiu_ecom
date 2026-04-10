"use client"

import { useState } from "react"
import { Search, Loader2, Send, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { BaselinkerWorkflowPanel } from "./BaselinkerWorkflowPanel"
import { cn } from "@/lib/utils"
import type { ProductData } from "@/lib/types"

type SearchType = "id" | "ean" | "sku" | "name"
type SearchMode = "single" | "list"

const SEARCH_TYPE_LABELS: Record<SearchType, string> = {
  id: "ID produktu",
  ean: "EAN",
  sku: "SKU",
  name: "Nazwa",
}

interface FoundProduct {
  id: string
  name: string
  ean?: string
  sku?: string
  images?: string[]
}

export function ProductSearch() {
  const [searchMode, setSearchMode] = useState<SearchMode>("single")
  const [searchType, setSearchType] = useState<SearchType>("id")
  const [singleQuery, setSingleQuery] = useState("")
  const [listQuery, setListQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<FoundProduct[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [workflowProductId, setWorkflowProductId] = useState<string | null>(null)
  const [workflowProduct, setWorkflowProduct] = useState<ProductData | null>(null)
  const [typeOpen, setTypeOpen] = useState(false)

  const handleSearch = async () => {
    const queries =
      searchMode === "list"
        ? listQuery.split("\n").map((l) => l.trim()).filter(Boolean)
        : [singleQuery.trim()]

    if (queries.length === 0) return
    setLoading(true)
    setError(null)
    setResults([])
    setSelected(new Set())

    try {
      // Determine BL filter parameter based on search type
      const params: Record<string, unknown> = {}
      if (searchType === "id") {
        params.inventory_product_id = queries.map(Number).filter(Boolean)
      } else if (searchType === "ean") {
        params.filter_ean = queries[0]
      } else if (searchType === "sku") {
        params.filter_sku = queries[0]
      } else {
        params.filter_name = queries[0]
      }

      const res = await fetch("/api/baselinker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "getInventoryProductsList", parameters: params }),
      })
      const data = await res.json()

      if (data.status === "ERROR") {
        throw new Error(data.error_message || "Błąd BaseLinker")
      }

      // BL returns products as object { product_id: { name, ean, sku, ... } }
      const products: FoundProduct[] = Object.entries(
        (data.products as Record<string, { name: string; ean?: string; sku?: string; images?: Record<string, string> }>) ?? {}
      ).map(([id, p]) => ({
        id,
        name: p.name,
        ean: p.ean,
        sku: p.sku,
        images: p.images ? Object.values(p.images).slice(0, 1) : [],
      }))

      setResults(products)
      if (products.length === 0) setError("Nie znaleziono produktów")
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nieznany błąd")
    } finally {
      setLoading(false)
    }
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleEditSelected = async () => {
    const ids = [...selected]
    if (ids.length === 0) return
    // For now open first selected in workflow
    const firstId = ids[0]
    setWorkflowProductId(firstId)

    // Build stub ProductData from found product info
    const found = results.find((r) => r.id === firstId)
    if (found) {
      setWorkflowProduct({
        title: found.name,
        images: found.images || [],
        description: "",
        attributes: {},
        url: "",
        ean: found.ean,
        sku: found.sku,
      })
    }
  }

  if (workflowProductId && workflowProduct) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setWorkflowProductId(null); setWorkflowProduct(null) }}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Wróć do wyszukiwania
          </button>
        </div>
        <BaselinkerWorkflowPanel
          productData={workflowProduct}
          editProductId={workflowProductId}
          onClose={() => { setWorkflowProductId(null); setWorkflowProduct(null) }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Edytuj istniejące produkty</h2>
        <p className="text-sm text-muted-foreground">
          Wyszukaj produkty w BaseLinker po ID, EAN, SKU lub nazwie. Możesz wkleić listę wartości.
        </p>
      </div>

      {/* Search mode toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setSearchMode("single")}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
            searchMode === "single"
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border text-muted-foreground hover:text-foreground"
          )}
        >
          Jedno zapytanie
        </button>
        <button
          onClick={() => setSearchMode("list")}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
            searchMode === "list"
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border text-muted-foreground hover:text-foreground"
          )}
        >
          Lista (wiele wartości)
        </button>
      </div>

      <div className="space-y-3">
        {/* Search type selector */}
        <div className="flex items-center gap-3">
          <Label className="shrink-0">Szukaj po:</Label>
          <div className="relative">
            <button
              onClick={() => setTypeOpen((v) => !v)}
              className="flex items-center gap-2 h-9 px-3 rounded-lg border border-input bg-background text-sm hover:bg-muted transition-colors"
            >
              {SEARCH_TYPE_LABELS[searchType]}
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </button>
            {typeOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setTypeOpen(false)} />
                <div className="absolute top-full mt-1 z-20 bg-popover border border-border rounded-lg shadow-lg p-1 min-w-[140px]">
                  {(Object.keys(SEARCH_TYPE_LABELS) as SearchType[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => { setSearchType(t); setTypeOpen(false) }}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm rounded-md transition-colors",
                        searchType === t ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                      )}
                    >
                      {SEARCH_TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Input */}
        {searchMode === "single" ? (
          <div className="flex gap-2">
            <Input
              value={singleQuery}
              onChange={(e) => setSingleQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder={`Wpisz ${SEARCH_TYPE_LABELS[searchType].toLowerCase()}...`}
              className="flex-1"
            />
            <Button onClick={handleSearch} disabled={loading || !singleQuery.trim()} className="gap-1.5">
              {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              Szukaj
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <textarea
              value={listQuery}
              onChange={(e) => setListQuery(e.target.value)}
              rows={6}
              placeholder={`Wklej listę ${SEARCH_TYPE_LABELS[searchType].toLowerCase()}ów — jeden per linia`}
              className="w-full rounded-xl border border-input bg-white px-4 py-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 resize-none"
            />
            <Button onClick={handleSearch} disabled={loading || !listQuery.trim()} className="gap-1.5 w-full sm:w-auto">
              {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              Szukaj ({listQuery.split("\n").filter((l) => l.trim()).length} wartości)
            </Button>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="text-sm text-destructive bg-destructive/10 px-4 py-3 rounded-lg border border-destructive/20">
          {error}
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Wyniki</span>
              <Badge variant="secondary">{results.length}</Badge>
            </div>
            {selected.size > 0 && (
              <Button size="sm" onClick={handleEditSelected} className="gap-1.5">
                <Send className="size-3.5" />
                Edytuj zaznaczone ({selected.size})
              </Button>
            )}
          </div>

          <div className="space-y-2">
            {results.map((product) => (
              <div
                key={product.id}
                onClick={() => toggleSelect(product.id)}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-colors",
                  selected.has(product.id)
                    ? "border-primary bg-accent"
                    : "border-border bg-card hover:bg-muted/50"
                )}
              >
                {/* Checkbox */}
                <div className={cn(
                  "size-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                  selected.has(product.id) ? "bg-primary border-primary" : "border-border"
                )}>
                  {selected.has(product.id) && (
                    <svg viewBox="0 0 12 12" fill="none" className="size-3 text-white">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>

                {/* Thumbnail */}
                {product.images?.[0] ? (
                  <img src={product.images[0]} alt="" className="size-10 rounded-lg object-contain border border-border bg-white shrink-0" />
                ) : (
                  <div className="size-10 rounded-lg bg-muted border border-border shrink-0" />
                )}

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{product.name}</p>
                  <div className="flex gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground">ID: {product.id}</span>
                    {product.ean && <span className="text-xs text-muted-foreground">EAN: {product.ean}</span>}
                    {product.sku && <span className="text-xs text-muted-foreground">SKU: {product.sku}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
