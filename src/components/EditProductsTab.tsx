"use client"

import { useMemo, useState, useCallback, useRef, useEffect } from "react"
import {
  RefreshCw,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Package,
  Send,
  SkipForward,
  XCircle,
  Search,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  SlidersHorizontal,
  X,
  FolderOpen,
} from "lucide-react"
// import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { PaginationControls } from "@/components/ui/pagination"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  FilterableSelect,
} from "@/components/ui/select"
import { BaselinkerWorkflowPanel } from "./BaselinkerWorkflowPanel"
import { EditBatchConfigModal } from "./EditBatchConfigModal"
import { EditBatchApplyModal } from "./EditBatchApplyModal"
import { BatchImageAssignModal } from "./BatchImageAssignModal"
import { cn } from "@/lib/utils"
import { useBLProductList } from "@/lib/hooks/use-bl-products"
import { useEditProductsStore, type SortField } from "@/lib/stores/edit-products-store"
import { useUserStore } from "@/lib/stores/user-store"
import { useBatchJobPoller } from "@/hooks/useBatchJobPoller"
import type { BLProductListItem, BLProductType, ProductData, ProductSession } from "@/lib/types"
import type { ExtractionResult } from "@/app/api/ai-extract-variants/route"

// ─── Constants ───

const PRODUCT_TYPE_LABELS: Record<BLProductType, string> = {
  basic: "Produkt",
  parent: "Parent",
  variant: "Wariant",
  bundle: "Zestaw",
}

const PRODUCT_TYPE_BADGE_VARIANT: Record<BLProductType, "secondary" | "default" | "outline" | "warning"> = {
  basic: "secondary",
  parent: "default",
  variant: "outline",
  bundle: "warning",
}

function formatCacheAge(cachedAt: string): string {
  const diff = Date.now() - new Date(cachedAt).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "przed chwilą"
  if (minutes === 1) return "1 min temu"
  return `${minutes} min temu`
}

// ─── Main Component ───

export function EditProductsTab() {
  const { products, inventoryId, isLoading, isFetching, isRefreshing, error, forceRefresh, cachedAt, detailsProgress } = useBLProductList()

  const {
    selectedIds,
    toggleSelection,
    selectIds,
    deselectAll,
    filters,
    setFilter,
    resetFilters,
    selectionFilterHash,
    currentPage,
    itemsPerPage,
    setCurrentPage,
    setItemsPerPage,
    batchQueue,
    batchIndex,
    startBatch,
    advanceBatch,
    cancelBatch,
    editBatchConfig,
    setEditBatchConfig,
    showApplyModal,
    setShowApplyModal,
    completedTemplateSession,
    setCompletedTemplateSession,
    completedDescriptionTemplate,
    completedTitleTemplate,
    editBatchJobId,
    setEditBatchJobId,
    sortField,
    sortDirection,
    setSort,
  } = useEditProductsStore()

  const { user } = useUserStore()
  const isGrzesiek = user === 'grzesiek'

  // ─── Filtering ───

  const filteredProducts = useMemo(() => {
    let result = products
    if (filters.search) {
      const q = filters.search.toLowerCase()
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.ean.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q)
      )
    }
    if (filters.manufacturer) {
      result = result.filter((p) => p.manufacturerName === filters.manufacturer)
    }
    if (filters.productType) {
      result = result.filter((p) => p.productType === filters.productType)
    }
    // Advanced filters (require details loaded)
    if (filters.priceMin) {
      const min = parseFloat(filters.priceMin)
      if (!isNaN(min)) result = result.filter((p) => (p.price ?? 0) >= min)
    }
    if (filters.priceMax) {
      const max = parseFloat(filters.priceMax)
      if (!isNaN(max)) result = result.filter((p) => (p.price ?? 0) <= max)
    }
    if (filters.stockStatus === 'available') {
      result = result.filter((p) => (p.quantity ?? 0) > 0)
    } else if (filters.stockStatus === 'unavailable') {
      result = result.filter((p) => (p.quantity ?? 0) === 0)
    }
    if (filters.taxRate) {
      const tr = parseFloat(filters.taxRate)
      result = result.filter((p) => {
        const pTax = (p as unknown as Record<string, unknown>).taxRate as number | undefined
        return pTax != null && pTax === tr
      })
    }
    if (filters.location) {
      const loc = filters.location.toLowerCase()
      result = result.filter((p) => {
        const locs = (p as unknown as Record<string, unknown>).locations as Record<string, string> | undefined
        if (!locs) return false
        return Object.values(locs).some(v => v.toLowerCase().includes(loc))
      })
    }
    if (filters.descriptionSearch) {
      const ds = filters.descriptionSearch.toLowerCase()
      result = result.filter((p) => {
        const tf = (p as unknown as Record<string, unknown>).textFields as Record<string, string> | undefined
        if (!tf) return p.name.toLowerCase().includes(ds)
        return Object.values(tf).some(v => v.toLowerCase().includes(ds)) || p.name.toLowerCase().includes(ds)
      })
    }
    if (filters.quantityMin) {
      const min = parseInt(filters.quantityMin)
      if (!isNaN(min)) result = result.filter((p) => (p.quantity ?? 0) >= min)
    }
    if (filters.quantityMax) {
      const max = parseInt(filters.quantityMax)
      if (!isNaN(max)) result = result.filter((p) => (p.quantity ?? 0) <= max)
    }
    return result
  }, [products, filters])

  // ─── Sorting ───

  const sortedProducts = useMemo(() => {
    if (!sortField) return filteredProducts
    const dir = sortDirection === 'asc' ? 1 : -1
    return [...filteredProducts].sort((a, b) => {
      let aVal: string | number | null = null
      let bVal: string | number | null = null
      switch (sortField) {
        case 'name': aVal = a.name; bVal = b.name; break
        case 'ean': aVal = a.ean; bVal = b.ean; break
        case 'sku': aVal = a.sku; bVal = b.sku; break
        case 'id': aVal = Number(a.id); bVal = Number(b.id); break
        case 'price': aVal = a.price ?? null; bVal = b.price ?? null; break
        case 'quantity': aVal = a.quantity ?? null; bVal = b.quantity ?? null; break
      }
      if (aVal == null && bVal == null) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return aVal.localeCompare(bVal, 'pl') * dir
      }
      return ((aVal as number) - (bVal as number)) * dir
    })
  }, [filteredProducts, sortField, sortDirection])

  // ─── Manufacturer options for filter ───

  const manufacturerOptions = useMemo(() => {
    const unique = new Map<string, string>()
    for (const p of products) {
      if (p.manufacturerName && !unique.has(p.manufacturerName)) {
        unique.set(p.manufacturerName, p.manufacturerName)
      }
    }
    return Array.from(unique.values())
      .sort((a, b) => a.localeCompare(b, "pl"))
      .map((name) => ({ id: name, label: name }))
  }, [products])

  // ─── Pagination ───

  const totalPages = Math.max(1, Math.ceil(sortedProducts.length / itemsPerPage))
  const safePage = Math.min(currentPage, totalPages)
  const pageProducts = sortedProducts.slice(
    (safePage - 1) * itemsPerPage,
    safePage * itemsPerPage
  )

  // Keep page in bounds when filters change
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages, setCurrentPage])

  // ─── Selection logic ───

  const currentFilterHash = JSON.stringify(filters)
  const hasFilterMismatch =
    selectedIds.size > 0 &&
    selectionFilterHash !== null &&
    currentFilterHash !== selectionFilterHash

  const pageIds = pageProducts.map((p) => p.id)
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id))

  function handleSelectAllPage() {
    if (allPageSelected) {
      // Deselect page items
      const next = new Set(selectedIds)
      for (const id of pageIds) next.delete(id)
      // We need to use store methods properly
      deselectAll()
      const remaining = [...selectedIds].filter((id) => !pageIds.includes(id))
      if (remaining.length > 0) selectIds(remaining)
    } else {
      selectIds(pageIds)
    }
  }

  function handleSelectAllFiltered() {
    selectIds(filteredProducts.map((p) => p.id))
  }

  // ─── Batch edit state ───

  const [batchProductData, setBatchProductData] = useState<ProductData | null>(null)
  const [batchLoading, setBatchLoading] = useState(false)
  const fetchingRef = useRef(false)
  const productsRef = useRef(products)
  const [showImageAssignModal, setShowImageAssignModal] = useState(false)
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [applyExtractions, setApplyExtractions] = useState<ExtractionResult[]>([])
  const [extractionsLoading, setExtractionsLoading] = useState(false)

  // Poller for the auto-apply batch job
  const batchPoller = useBatchJobPoller(editBatchJobId, {
    autoStart: true,
    onDone: () => {
      // Job complete — stay on progress view, user clicks "Zakończ"
    },
  })

  const currentBatchId = batchQueue ? batchQueue[batchIndex] : null

  // Keep productsRef in sync without triggering fetch re-runs
  useEffect(() => { productsRef.current = products }, [products])

  // Fetch product details when batch moves to next product
  useEffect(() => {
    if (!currentBatchId || !inventoryId || fetchingRef.current) return
    fetchingRef.current = true
    setBatchLoading(true)
    setBatchProductData(null)

    const loadProduct = async () => {
      try {
        const res = await fetch("/api/baselinker", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            method: "getInventoryProductsData",
            parameters: { inventory_id: inventoryId, products: [currentBatchId] },
          }),
        })
        const data = await res.json()
        const productData = data.products?.[currentBatchId]

        if (productData) {
          const images = productData.images
            ? Object.values(productData.images as Record<string, string>)
            : []

          // Map features → attributes
          const rawFeatures: Array<{ name: string; values: Array<{ name: string }> }> =
            productData.features ?? []
          const attributes: Record<string, string> = {}
          for (const f of rawFeatures) {
            attributes[f.name] = f.values?.map((v) => v.name).join(', ') ?? ''
          }

          // Bundle data
          const isBundle = productData.is_bundle === 1 || productData.is_bundle === true
          const bundleProducts: Record<string, number> = {}
          if (productData.bundles) {
            for (const b of productData.bundles as Array<{ product_id: string | number; quantity: number }>) {
              bundleProducts[String(b.product_id)] = b.quantity
            }
          }

          // Fetch bundle component context for AI
          let bundleContextText: string | undefined
          const bundleIds = Object.keys(bundleProducts)
          if (isBundle && bundleIds.length > 0) {
            try {
              const compRes = await fetch("/api/baselinker", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  method: "getInventoryProductsData",
                  parameters: { inventory_id: inventoryId, products: bundleIds },
                }),
              })
              const compData = await compRes.json()
              const parts: string[] = []
              for (const [compId, comp] of Object.entries(compData.products ?? {})) {
                const c = comp as Record<string, unknown>
                const compFeatures = (c.features as Array<{ name: string; values: Array<{ name: string }> }> ?? [])
                const compAttrs = compFeatures.map(f => `${f.name}: ${f.values?.map(v => v.name).join(', ')}`).join('; ')
                parts.push(`Składnik (ID: ${compId}): ${c.name ?? ''}. Opis: ${String(c.description ?? '').slice(0, 200)}. Atrybuty: ${compAttrs || '(brak)'}`)
              }
              if (parts.length > 0) bundleContextText = parts.join('\n')
            } catch {
              // Bundle context is best-effort
            }
          }

          setBatchProductData({
            title: productData.name ?? "",
            images,
            description: productData.description ?? "",
            attributes,
            url: "",
            ean: productData.ean ?? undefined,
            sku: productData.sku ?? undefined,
            isBundle,
            bundleProducts,
            taxRate: productData.tax_rate ?? 23,
            bundleContextText,
          })
        } else {
          const listItem = productsRef.current.find((p) => p.id === currentBatchId)
          setBatchProductData({
            title: listItem?.name ?? "",
            images: listItem?.thumbnailUrl ? [listItem.thumbnailUrl] : [],
            description: "",
            attributes: {},
            url: "",
            ean: listItem?.ean ?? undefined,
            sku: listItem?.sku ?? undefined,
          })
        }
      } catch {
        const listItem = productsRef.current.find((p) => p.id === currentBatchId)
        setBatchProductData({
          title: listItem?.name ?? "",
          images: listItem?.thumbnailUrl ? [listItem.thumbnailUrl] : [],
          description: "",
          attributes: {},
          url: "",
          ean: listItem?.ean ?? undefined,
          sku: listItem?.sku ?? undefined,
        })
      } finally {
        setBatchLoading(false)
        fetchingRef.current = false
      }
    }

    loadProduct()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBatchId, inventoryId])

  const handleAdvanceBatch = useCallback(async () => {
    fetchingRef.current = false
    setBatchProductData(null)
    await fetch('/api/product-session', { method: 'DELETE' })
    advanceBatch()
  }, [advanceBatch])

  const handleCancelBatch = useCallback(async () => {
    fetchingRef.current = false
    setBatchProductData(null)
    await fetch('/api/product-session', { method: 'DELETE' })
    cancelBatch()
  }, [cancelBatch])

  const handleStartEdit = useCallback(async () => {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    if (ids.length > 1) {
      // Show config modal to set up diff fields before starting
      setShowConfigModal(true)
    } else {
      await fetch('/api/product-session', { method: 'DELETE' })
      startBatch(ids)
    }
  }, [selectedIds, startBatch])

  const handleConfigConfirm = useCallback(async (config: Parameters<typeof setEditBatchConfig>[0]) => {
    setShowConfigModal(false)
    setEditBatchConfig(config)
    await fetch('/api/product-session', { method: 'DELETE' })
    startBatch([...selectedIds])
  }, [selectedIds, startBatch, setEditBatchConfig])

  const handleSubmitSuccess = useCallback(async (session: ProductSession) => {
    // Called after product 1 is successfully submitted
    // Save template session and trigger AI extraction for remaining products
    setCompletedTemplateSession(session)

    const remainingIds = batchQueue ? batchQueue.slice(batchIndex + 1) : []
    if (remainingIds.length === 0 || !editBatchConfig) {
      // No remaining products or single-product edit — just advance normally
      handleAdvanceBatch()
      return
    }

    const remainingProducts = remainingIds
      .map(id => products.find(p => p.id === id))
      .filter(Boolean) as BLProductListItem[]

    // Fetch extractions for remaining products
    setExtractionsLoading(true)
    setShowApplyModal(true)
    try {
      const res = await fetch('/api/ai-extract-variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          products: remainingProducts.map(p => ({ id: p.id, name: p.name, ean: p.ean, sku: p.sku })),
          diffFields: editBatchConfig.diffFields,
          templateTitle: session.data?.title,
        }),
      })
      if (res.ok) {
        const data = await res.json() as { extractions: ExtractionResult[] }
        setApplyExtractions(data.extractions)
      }
    } finally {
      setExtractionsLoading(false)
    }
  }, [batchQueue, batchIndex, products, editBatchConfig, setCompletedTemplateSession, setShowApplyModal, handleAdvanceBatch])

  const handleApplyToAll = useCallback(async (correctedExtractions: ExtractionResult[]) => {
    if (!completedTemplateSession || !editBatchConfig) return

    const remainingIds = batchQueue ? batchQueue.slice(batchIndex + 1) : []
    const remainingProducts = remainingIds
      .map(id => products.find(p => p.id === id))
      .filter(Boolean) as BLProductListItem[]

    // Merge extraction values back into products
    const productsWithValues = remainingProducts.map(p => {
      const ext = correctedExtractions.find(e => e.productId === p.id)
      return {
        blProductId: p.id,
        name: p.name,
        ean: ext?.values['ean'] || p.ean || undefined,
        sku: ext?.values['sku'] || p.sku || undefined,
        productType: p.productType,
        parentId: p.parentId || undefined,
      }
    })

    setShowApplyModal(false)

    const res = await fetch('/api/batch-jobs/from-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateSession: completedTemplateSession,
        remainingProducts: productsWithValues,
        diffFields: editBatchConfig.diffFields,
        keepExistingImages: editBatchConfig.keepExistingImages,
        titleTemplate: completedTitleTemplate,
        descriptionTemplate: completedDescriptionTemplate,
        label: `Edycja masowa — ${remainingProducts.length} produktów`,
      }),
    })

    if (res.ok) {
      const { jobId } = await res.json() as { jobId: string }
      setEditBatchJobId(jobId)
      // Clear batch queue — we're now in auto-mode
      cancelBatch()
    }
  }, [completedTemplateSession, editBatchConfig, completedTitleTemplate, completedDescriptionTemplate, batchQueue, batchIndex, products, setShowApplyModal, setEditBatchJobId, cancelBatch])

  const handleRefresh = useCallback(() => {
    forceRefresh()
  }, [forceRefresh])

  // inventoryId comes from the hook now (resolved by the list API)

  // ─── Advanced filters state ───
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const advancedFilterCount = [
    filters.priceMin, filters.priceMax, filters.stockStatus, filters.taxRate,
    filters.location, filters.descriptionSearch, filters.quantityMin, filters.quantityMax,
  ].filter(Boolean).length

  // ─── Debounced search ───

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null)
  const [searchInput, setSearchInput] = useState(filters.search)

  function handleSearchChange(value: string) {
    setSearchInput(value)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => {
      setFilter("search", value)
    }, 300)
  }

  // Sync external filter changes
  useEffect(() => {
    setSearchInput(filters.search)
  }, [filters.search])

  // ─── Render: Auto-apply batch job progress ───

  if (editBatchJobId !== null) {
    const progress = batchPoller.progress
    const done = batchPoller.status === 'done'
    const total = progress?.total ?? 0
    const completed = progress?.done ?? 0
    const failed = progress?.failed ?? 0

    return (
      <div className="space-y-6 py-8 max-w-lg mx-auto">
        <div className="text-center space-y-2">
          <h3 className="text-lg font-semibold">Edycja masowa w toku...</h3>
          <p className="text-sm text-muted-foreground">
            Produkty są aktualizowane automatycznie w BaseLinker.
          </p>
        </div>

        <div className="border border-border rounded-xl p-6 space-y-4">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Postęp</span>
            <span className="font-medium">{completed}/{total}</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div
              className={cn("h-2 rounded-full transition-all", done ? "bg-green-500" : "bg-primary")}
              style={{ width: total > 0 ? `${(completed / total) * 100}%` : '0%' }}
            />
          </div>
          {failed > 0 && (
            <p className="text-sm text-destructive">{failed} produktów z błędem</p>
          )}
          {done && (
            <p className="text-sm text-green-600 font-medium text-center">
              ✓ Wszystkie produkty zaktualizowane!
            </p>
          )}
        </div>

        <Button
          onClick={() => {
            batchPoller.stop()
            setEditBatchJobId(null)
            setEditBatchConfig(null)
            setCompletedTemplateSession(null)
            deselectAll()
          }}
          variant={done ? "default" : "outline"}
          className="w-full"
        >
          {done ? 'Zakończ' : 'Zatrzymaj i wróć do listy'}
        </Button>
      </div>
    )
  }

  // ─── Render: Batch workflow ───

  if (batchQueue !== null) {
    const currentListItem = products.find((p) => p.id === currentBatchId)

    if (batchLoading || !batchProductData) {
      return (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-sm font-medium">
            Pobieranie danych produktu {batchIndex + 1}/{batchQueue.length}
          </p>
          <p className="text-xs text-muted-foreground">{currentListItem?.name ?? "..."}</p>
          <Button size="sm" variant="ghost" onClick={handleCancelBatch} className="gap-1.5 text-xs text-destructive">
            <XCircle className="size-3.5" />
            Anuluj
          </Button>
        </div>
      )
    }

    return (
      <div className="space-y-4">
        {/* Batch progress bar */}
        <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Package className="size-4 text-primary" />
              Produkt {batchIndex + 1}/{batchQueue.length}
            </div>
            <span className="text-sm text-muted-foreground truncate max-w-[300px]">
              {currentListItem?.name ?? currentBatchId}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowImageAssignModal(true)} className="gap-1.5 text-xs">
              <FolderOpen className="size-3.5" />
              Wgraj zdjęcia
            </Button>
            <Button size="sm" variant="ghost" onClick={handleAdvanceBatch} className="gap-1.5 text-xs">
              <SkipForward className="size-3.5" />
              Pomiń
            </Button>
            <Button size="sm" variant="ghost" onClick={handleCancelBatch} className="gap-1.5 text-xs text-destructive">
              <XCircle className="size-3.5" />
              Anuluj
            </Button>
          </div>
        </div>

        {/* Progress bar visual */}
        <div className="w-full bg-muted rounded-full h-1.5">
          <div
            className="bg-primary h-1.5 rounded-full transition-all duration-500"
            style={{ width: `${((batchIndex + 1) / batchQueue.length) * 100}%` }}
          />
        </div>

        {/* Workflow panel */}
        <BaselinkerWorkflowPanel
          key={currentBatchId}
          productData={batchProductData}
          editProductId={currentBatchId!}
          editProductType={currentListItem?.productType}
          editParentId={currentListItem?.parentId}
          onClose={handleAdvanceBatch}
          onSubmitSuccess={batchQueue && batchQueue.length > 1 && batchIndex === 0 ? handleSubmitSuccess : undefined}
        />
      </div>
    )
  }

  // ─── Render: Product browser ───

  const selectedProducts = [...selectedIds].map(id => products.find(p => p.id === id)).filter(Boolean) as BLProductListItem[]
  const remainingForApply: BLProductListItem[] = batchQueue
    ? (batchQueue as string[]).slice(batchIndex + 1).map((id: string) => products.find(p => p.id === id)).filter((p): p is BLProductListItem => Boolean(p))
    : []

  return (
    <>
    {showConfigModal && (
      <EditBatchConfigModal
        products={selectedProducts}
        onConfirm={handleConfigConfirm}
        onCancel={() => setShowConfigModal(false)}
        onManual={() => { setShowConfigModal(false); }}
      />
    )}
    {showImageAssignModal && (
      <BatchImageAssignModal
        products={batchQueue ? (batchQueue as string[]).map(id => products.find(p => p.id === id)).filter(Boolean) as BLProductListItem[] : selectedProducts}
        currentProductId={(batchQueue as string[] | null)?.length === 1 ? currentBatchId ?? undefined : undefined}
        onAssigned={(assignments) => {
          // Merge assigned images into batchProductData for the current product
          if (currentBatchId && assignments[currentBatchId]) {
            setBatchProductData(prev => prev ? {
              ...prev,
              images: [...(prev.images ?? []), ...assignments[currentBatchId].map(m => m.url)],
            } : prev)
          }
          setShowImageAssignModal(false)
        }}
        onCancel={() => setShowImageAssignModal(false)}
      />
    )}
    {showApplyModal && (
      <EditBatchApplyModal
        products={remainingForApply}
        diffFields={editBatchConfig?.diffFields ?? []}
        extractions={applyExtractions}
        isLoading={extractionsLoading}
        onApprove={handleApplyToAll}
        onBack={() => {
          setShowApplyModal(false)
          // Continue to next product manually
          handleAdvanceBatch()
        }}
      />
    )}
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Edytuj istniejące produkty</h2>
          <p className="text-sm text-muted-foreground">
            Przeglądaj produkty z BaseLinker, filtruj i zaznacz do edycji.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {cachedAt && !isFetching && (
            <span className="text-xs text-muted-foreground">
              Cache · {formatCacheAge(cachedAt)}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isFetching}
            className="gap-1.5"
          >
            <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} />
            Odśwież
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 px-4 py-3 rounded-lg border border-destructive/20">
          <AlertCircle className="size-4 shrink-0" />
          {error instanceof Error ? error.message : "Błąd pobierania produktów"}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Szukaj</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Nazwa, EAN lub SKU..."
              className="pl-9"
            />
          </div>
        </div>

        <div className="min-w-[180px]">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Producent</label>
          <FilterableSelect
            value={filters.manufacturer || "__all__"}
            onValueChange={(v) => setFilter("manufacturer", v === "__all__" ? "" : v)}
            options={[{ id: "__all__", label: "Wszyscy" }, ...manufacturerOptions]}
            placeholder="Wszyscy"
          />
        </div>

        <div className="min-w-[160px]">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Typ produktu</label>
          <Select
            value={filters.productType || "__all__"}
            onValueChange={(v) => setFilter("productType", v === "__all__" ? "" as BLProductType | "" : v as BLProductType)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Wszystkie" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Wszystkie</SelectItem>
              <SelectItem value="basic">Produkt podstawowy</SelectItem>
              <SelectItem value="parent">Parent</SelectItem>
              <SelectItem value="variant">Wariant</SelectItem>
              <SelectItem value="bundle">Zestaw</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {(filters.search || filters.manufacturer || filters.productType) && (
          <Button variant="ghost" size="sm" onClick={resetFilters} className="text-xs">
            Wyczyść filtry
          </Button>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => setAdvancedOpen(prev => !prev)}
          className="gap-1.5 text-xs"
        >
          <SlidersHorizontal className="size-3.5" />
          Zaawansowane
          {advancedFilterCount > 0 && (
            <Badge variant="default" className="text-[10px] px-1 py-0 ml-1">{advancedFilterCount}</Badge>
          )}
        </Button>
      </div>

      {/* Active filter chips */}
      {advancedFilterCount > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {filters.priceMin && <FilterChip label={`Cena od ${filters.priceMin}`} onRemove={() => setFilter("priceMin", "")} />}
          {filters.priceMax && <FilterChip label={`Cena do ${filters.priceMax}`} onRemove={() => setFilter("priceMax", "")} />}
          {filters.stockStatus === "available" && <FilterChip label="Dostępne" onRemove={() => setFilter("stockStatus", "")} />}
          {filters.stockStatus === "unavailable" && <FilterChip label="Niedostępne" onRemove={() => setFilter("stockStatus", "")} />}
          {filters.taxRate && <FilterChip label={`VAT: ${filters.taxRate}%`} onRemove={() => setFilter("taxRate", "")} />}
          {filters.location && <FilterChip label={`Lokalizacja: ${filters.location}`} onRemove={() => setFilter("location", "")} />}
          {filters.descriptionSearch && <FilterChip label={`Tekst: ${filters.descriptionSearch}`} onRemove={() => setFilter("descriptionSearch", "")} />}
          {filters.quantityMin && <FilterChip label={`Stan od ${filters.quantityMin}`} onRemove={() => setFilter("quantityMin", "")} />}
          {filters.quantityMax && <FilterChip label={`Stan do ${filters.quantityMax}`} onRemove={() => setFilter("quantityMax", "")} />}
        </div>
      )}

      {/* Advanced filters (collapsible) */}
      {advancedOpen && (
        <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Zaawansowane filtry</div>
          {!detailsProgress.loading ? null : (
            <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
              <Loader2 className="size-3 animate-spin" />
              Ładowanie danych... Niektóre filtry mogą nie działać w pełni.
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Cena od (PLN)</label>
              <Input type="number" value={filters.priceMin} onChange={(e) => setFilter("priceMin", e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Cena do (PLN)</label>
              <Input type="number" value={filters.priceMax} onChange={(e) => setFilter("priceMax", e.target.value)} placeholder="999" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Stan magazynowy</label>
              <Select value={filters.stockStatus || "__all__"} onValueChange={(v) => setFilter("stockStatus", v === "__all__" ? "" : v as "available" | "unavailable")}>
                <SelectTrigger><SelectValue placeholder="Wszyscy" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Wszyscy</SelectItem>
                  <SelectItem value="available">Dostępne (qty &gt; 0)</SelectItem>
                  <SelectItem value="unavailable">Niedostępne (qty = 0)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Stawka VAT</label>
              <Select value={filters.taxRate || "__all__"} onValueChange={(v) => setFilter("taxRate", v === "__all__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Wszystkie" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Wszystkie</SelectItem>
                  <SelectItem value="23">23%</SelectItem>
                  <SelectItem value="8">8%</SelectItem>
                  <SelectItem value="5">5%</SelectItem>
                  <SelectItem value="0">0%</SelectItem>
                  <SelectItem value="-1">ZW (zwolniony)</SelectItem>
                  <SelectItem value="-0.02">NP</SelectItem>
                  <SelectItem value="-0.03">OO</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Lokalizacja</label>
              <Input value={filters.location} onChange={(e) => setFilter("location", e.target.value)} placeholder="np. A-5-2" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Tekst w opisie</label>
              <Input value={filters.descriptionSearch} onChange={(e) => setFilter("descriptionSearch", e.target.value)} placeholder="Szukaj w opisach..." />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Stan od</label>
              <Input type="number" value={filters.quantityMin} onChange={(e) => setFilter("quantityMin", e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Stan do</label>
              <Input type="number" value={filters.quantityMax} onChange={(e) => setFilter("quantityMax", e.target.value)} placeholder="999" />
            </div>
          </div>
        </div>
      )}

      {/* Selection toolbar — ukryty dla Grzesieka (tylko edycja pojedyncza) */}
      {products.length > 0 && !isGrzesiek && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-3">
              <button
                onClick={selectedIds.size > 0 ? deselectAll : handleSelectAllFiltered}
                className="text-xs text-primary hover:underline"
              >
                {selectedIds.size > 0 ? "Odznacz wszystko" : "Zaznacz wszystkie"}
              </button>
              {selectedIds.size > 0 && (
                <span className="text-xs text-muted-foreground">
                  Zaznaczono: <strong>{selectedIds.size}</strong>
                </span>
              )}
            </div>
            {selectedIds.size > 0 && (
              <Button size="sm" onClick={handleStartEdit} className="gap-1.5">
                <Send className="size-3.5" />
                Edytuj zaznaczone ({selectedIds.size})
              </Button>
            )}
          </div>

          {/* Filter mismatch warning */}
          {hasFilterMismatch && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-700">
              <AlertTriangle className="size-4 shrink-0" />
              Na liście zaznaczonych znajdują się produkty z innego filtru.
            </div>
          )}
        </div>
      )}

      {/* Background refresh indicator */}
      {isRefreshing && detailsProgress.loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
          <Loader2 className="size-3 animate-spin text-primary" />
          Odświeżanie w tle...
        </div>
      )}

      {/* Details loading progress */}
      {detailsProgress.loading && detailsProgress.total > 0 && !isRefreshing && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <div className="flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin text-primary" />
              <span>Ładowanie szczegółów (zdjęcia, producent)...</span>
            </div>
            <span className="tabular-nums font-medium">
              {detailsProgress.loaded}/{detailsProgress.total}
            </span>
          </div>
          <div className="w-full bg-muted rounded-full h-1.5">
            <div
              className="bg-primary h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${(detailsProgress.loaded / detailsProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground px-1">
            <Loader2 className="size-4 animate-spin" />
            Pobieranie listy produktów z BaseLinker...
          </div>
          {/* Skeleton rows */}
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="w-10 px-3 py-2.5" />
                  <th className="w-12 px-3 py-2.5" />
                  <th className="px-3 py-2.5 text-left"><div className="h-3 w-16 skeleton rounded" /></th>
                  <th className="px-3 py-2.5 text-left"><div className="h-3 w-10 skeleton rounded" /></th>
                  <th className="px-3 py-2.5 text-left"><div className="h-3 w-10 skeleton rounded" /></th>
                  <th className="px-3 py-2.5 text-left"><div className="h-3 w-20 skeleton rounded" /></th>
                  <th className="px-3 py-2.5 text-left"><div className="h-3 w-14 skeleton rounded" /></th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b last:border-b-0">
                    <td className="px-3 py-2.5"><div className="size-4 skeleton rounded" /></td>
                    <td className="px-3 py-2.5"><div className="size-10 skeleton rounded-lg" /></td>
                    <td className="px-3 py-2.5"><div className="h-4 w-48 skeleton rounded" /></td>
                    <td className="px-3 py-2.5"><div className="h-4 w-24 skeleton rounded" /></td>
                    <td className="px-3 py-2.5"><div className="h-4 w-20 skeleton rounded" /></td>
                    <td className="px-3 py-2.5"><div className="h-4 w-28 skeleton rounded" /></td>
                    <td className="px-3 py-2.5"><div className="h-5 w-16 skeleton rounded-full" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && products.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="size-16 rounded-2xl bg-muted border border-border flex items-center justify-center mb-4">
            <Package className="size-8 text-muted-foreground/40" />
          </div>
          <p className="text-sm text-muted-foreground">
            Brak produktów w inwentarzu. Sprawdź konfigurację BaseLinker.
          </p>
        </div>
      )}

      {/* No results for filter */}
      {!isLoading && products.length > 0 && filteredProducts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Search className="size-8 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">
            Brak produktów pasujących do filtrów.
          </p>
          <Button variant="ghost" size="sm" onClick={resetFilters} className="mt-2 text-xs">
            Wyczyść filtry
          </Button>
        </div>
      )}

      {/* Table with pagination */}
      {!isLoading && filteredProducts.length > 0 && (
        <>
          {/* Pagination - top */}
          <PaginationControls
            currentPage={safePage}
            totalPages={totalPages}
            itemsPerPage={itemsPerPage}
            onPageChange={setCurrentPage}
            onItemsPerPageChange={setItemsPerPage}
            totalItems={filteredProducts.length}
          />

          {/* Table */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="w-10 px-3 py-2.5 text-center">
                      <input
                        type="checkbox"
                        checked={allPageSelected}
                        onChange={handleSelectAllPage}
                        className="rounded border-border"
                      />
                    </th>
                    <th className="w-12 px-3 py-2.5" />
                    <SortableHeader field="name" label="Nazwa" current={sortField} direction={sortDirection} onSort={setSort} />
                    <SortableHeader field="ean" label="EAN" current={sortField} direction={sortDirection} onSort={setSort} />
                    <SortableHeader field="sku" label="SKU" current={sortField} direction={sortDirection} onSort={setSort} />
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Producent
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Typ
                    </th>
                    <SortableHeader field="price" label="Cena" current={sortField} direction={sortDirection} onSort={setSort} />
                    <SortableHeader field="quantity" label="Stan" current={sortField} direction={sortDirection} onSort={setSort} />
                  </tr>
                </thead>
                <tbody>
                  {pageProducts.map((product) => (
                    <ProductRow
                      key={product.id}
                      product={product}
                      isSelected={selectedIds.has(product.id)}
                      onToggle={() => toggleSelection(product.id)}
                      onDirectEdit={isGrzesiek ? async () => {
                        await fetch('/api/product-session', { method: 'DELETE' })
                        startBatch([product.id])
                      } : undefined}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination - bottom */}
          <PaginationControls
            currentPage={safePage}
            totalPages={totalPages}
            itemsPerPage={itemsPerPage}
            onPageChange={setCurrentPage}
            onItemsPerPageChange={setItemsPerPage}
            totalItems={filteredProducts.length}
          />
        </>
      )}
    </div>
    </>
  )
}

// ─── Filter Chip ───

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent text-accent-foreground px-2.5 py-1 text-xs">
      {label}
      <button onClick={onRemove} className="hover:text-destructive">
        <X className="size-3" />
      </button>
    </span>
  )
}

// ─── Sortable Header ───

function SortableHeader({ field, label, current, direction, onSort }: {
  field: SortField
  label: string
  current: SortField
  direction: 'asc' | 'desc'
  onSort: (f: SortField) => void
}) {
  const isActive = current === field
  return (
    <th
      className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:text-foreground transition-colors"
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive ? (
          direction === 'asc' ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />
        ) : (
          <ChevronsUpDown className="size-3.5 opacity-30" />
        )}
      </span>
    </th>
  )
}

// ─── Memoized row ───

import { memo } from "react"

interface ProductRowProps {
  product: BLProductListItem
  isSelected: boolean
  onToggle: () => void
  onDirectEdit?: () => void
}

const ProductRow = memo(function ProductRow({ product, isSelected, onToggle, onDirectEdit }: ProductRowProps) {
  return (
    <tr
      onClick={onDirectEdit ?? onToggle}
      className={cn(
        "border-b last:border-b-0 cursor-pointer transition-colors",
        isSelected ? "bg-accent/40" : "hover:bg-muted/30"
      )}
    >
      <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggle}
          className="rounded border-border"
        />
      </td>
      <td className="px-3 py-2">
        {product.thumbnailUrl ? (
          <img
            src={product.thumbnailUrl}
            alt=""
            className="size-10 rounded-lg object-contain border border-border bg-white shrink-0"
            loading="lazy"
          />
        ) : (
          <div className="size-10 rounded-lg bg-muted border border-border" />
        )}
      </td>
      <td className="px-3 py-2 font-medium max-w-[280px]">
        <p className="truncate" title={product.name}>{product.name || "—"}</p>
        <span className="text-[11px] text-muted-foreground">ID: {product.id}</span>
      </td>
      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
        {product.ean || "—"}
      </td>
      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
        {product.sku || "—"}
      </td>
      <td className="px-3 py-2 text-xs">
        {product.manufacturerName || "—"}
      </td>
      <td className="px-3 py-2">
        <Badge variant={PRODUCT_TYPE_BADGE_VARIANT[product.productType]} className="text-[11px]">
          {PRODUCT_TYPE_LABELS[product.productType]}
        </Badge>
      </td>
      <td className="px-3 py-2 text-xs tabular-nums text-right">
        {product.price != null ? `${product.price.toFixed(2)} zł` : "—"}
      </td>
      <td className="px-3 py-2 text-xs tabular-nums text-right">
        {product.quantity != null ? product.quantity : "—"}
      </td>
    </tr>
  )
})
