"use client"

import { useState, useEffect } from "react"
import { Settings2, Tag, CheckSquare, Eye, Send, RefreshCw, Loader2, Sparkles, X, CheckCircle2, History, RotateCcw, Edit3 } from "lucide-react"
import { CategorySelector } from "./CategorySelector"
import { ParameterForm } from "./ParameterForm"
import { FieldSelector } from "./FieldSelector"
import { ApprovalDrawer } from "./ApprovalDrawer"
import { AllegroPreviewFrame } from "./AllegroPreviewFrame"
import { ClaudeChat } from "./ClaudeChat"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { ProductSession, AllegroCategory, AllegroParameter, BLCache, BLExtraField, ProductData } from "@/lib/types"

interface Props {
  productData: ProductData
  editProductId?: string
  onClose: () => void
}

type Step = "inventory" | "category" | "parameters" | "fields" | "preview" | "ai" | "approval"

const STEPS: { key: Step; label: string; icon: React.ReactNode }[] = [
  { key: "inventory", label: "Magazyn", icon: <Settings2 className="size-3.5" /> },
  { key: "category", label: "Kategoria", icon: <Tag className="size-3.5" /> },
  { key: "parameters", label: "Parametry", icon: <Settings2 className="size-3.5" /> },
  { key: "fields", label: "Pola", icon: <CheckSquare className="size-3.5" /> },
  { key: "preview", label: "Podgląd", icon: <Eye className="size-3.5" /> },
  { key: "ai", label: "Asystent AI", icon: <Sparkles className="size-3.5" /> },
  { key: "approval", label: "Wyślij", icon: <Send className="size-3.5" /> },
]

interface OfferVersion {
  id: number
  label: string
  title: string
  description: string
}

export function BaselinkerWorkflowPanel({ productData, editProductId, onClose }: Props) {
  const [currentStep, setCurrentStep] = useState<Step>("inventory")
  const [session, setSession] = useState<ProductSession | null>(null)
  const [blCache, setBlCache] = useState<BLCache | null>(null)
  const [parameters, setParameters] = useState<AllegroParameter[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [showApproval, setShowApproval] = useState(false)
  const [successId, setSuccessId] = useState<number | null>(null)
  const [selectedInventoryId, setSelectedInventoryId] = useState<number | undefined>()
  const [selectedWarehouse, setSelectedWarehouse] = useState<string | undefined>()

  // Local editable product (for AI chat)
  const [localTitle, setLocalTitle] = useState(productData.title)
  const [localDescription, setLocalDescription] = useState(productData.description)

  // Version history for AI step
  const [versions, setVersions] = useState<OfferVersion[]>([])

  useEffect(() => {
    loadBLCache()
    fetch("/api/product-session")
      .then((r) => r.json())
      .then((d) => setSession(d.session))
  }, [])

  async function loadBLCache(inventoryId?: number) {
    setLoading(true)
    setError("")
    try {
      const url = inventoryId ? `/api/bl-bootstrap?inventoryId=${inventoryId}` : "/api/bl-bootstrap"
      const res = await fetch(url)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setBlCache(data.cache)
      if (!selectedInventoryId && data.cache.inventories?.length > 0) {
        setSelectedInventoryId(data.cache.inventories[0].inventory_id)
      }
      if (!selectedWarehouse && data.cache.warehouses?.length > 0) {
        setSelectedWarehouse(data.cache.warehouses[0].warehouse_id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd bootstrap BaseLinker")
    } finally {
      setLoading(false)
    }
  }

  async function updateSession(patch: Partial<ProductSession>) {
    const res = await fetch("/api/product-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
    const data = await res.json()
    setSession(data.session)
    return data.session as ProductSession
  }

  async function handleInventoryConfirm() {
    if (!selectedInventoryId) { setError("Wybierz katalog"); return }
    setLoading(true)
    try {
      await updateSession({
        data: { ...productData, title: localTitle, description: localDescription },
        images: productData.images,
        inventoryId: selectedInventoryId,
        defaultWarehouse: selectedWarehouse,
        ...(editProductId ? { mode: "edit", product_id: editProductId } : {}),
      })
      setCurrentStep("category")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd")
    } finally {
      setLoading(false)
    }
  }

  async function handleCategorySelect(cat: AllegroCategory) {
    setLoading(true)
    setError("")
    try {
      const paramsRes = await fetch(`/api/allegro/parameters?categoryId=${cat.id}`)
      const paramsData = await paramsRes.json()
      setParameters(paramsData.parameters ?? [])
      await updateSession({
        allegroCategory: cat,
        allegroParameters: paramsData.parameters,
        commissionInfo: paramsData.commissionInfo,
      })
      setCurrentStep("parameters")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd pobierania parametrów")
    } finally {
      setLoading(false)
    }
  }

  async function handleParametersSubmit(values: Record<string, string | string[]>) {
    await updateSession({ filledParameters: values })
    setCurrentStep("fields")
  }

  async function handleFieldsChange(selection: Partial<import("@/lib/types").FieldSelection>) {
    await updateSession({ fieldSelection: selection })
  }

  function restoreVersion(v: OfferVersion) {
    setLocalTitle(v.title)
    setLocalDescription(v.description)
  }

  /** Compute preview values for FieldSelector so the user knows what will be sent */
  function buildFieldValues(): Record<string, string> {
    const attrs = productData.attributes ?? {}
    const manufacturer =
      attrs["Marka"] || attrs["Producent"] || attrs["Manufacturer"] || attrs["Brand"] || ""
    const weight = attrs["Waga"] || attrs["Weight"] || attrs["Masa"] || ""
    const priceStr = [productData.price, productData.currency].filter(Boolean).join(" ")

    return {
      name: localTitle,
      sku: productData.sku || "",
      ean: productData.ean || "",
      asin: productData.sku || "",
      description: productData.description
        ? productData.description.slice(0, 60).replace(/\s+/g, " ") + (productData.description.length > 60 ? "…" : "")
        : "",
      images: productData.images?.length ? `${productData.images.length} zdjęć` : "",
      prices: priceStr,
      manufacturer_id: manufacturer,
      category_id: session?.allegroCategory?.name || "",
      features: session?.filledParameters
        ? `${Object.keys(session.filledParameters).length} parametrów`
        : "",
      weight,
    }
  }

  const currentStepIndex = STEPS.findIndex((s) => s.key === currentStep)

  function renderStep() {
    switch (currentStep) {
      case "inventory":
        return (
          <div className="space-y-4">
            {editProductId && (
              <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                <span className="font-medium">Tryb edycji</span>
                <span className="text-amber-600">— ID: {editProductId}</span>
              </div>
            )}
            <p className="text-sm text-muted-foreground">Wybierz katalog i magazyn BaseLinker:</p>

            {loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Ładowanie danych...
              </div>
            )}
            {error && (
              <div className="text-sm text-destructive bg-destructive/10 px-3 py-2.5 rounded-lg">{error}</div>
            )}

            {blCache && !loading && (
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Katalog (Inventory)</p>
                  <div className="space-y-1.5">
                    {blCache.inventories.map((inv) => (
                      <button
                        key={inv.inventory_id}
                        onClick={() => setSelectedInventoryId(inv.inventory_id)}
                        className={cn(
                          "w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors",
                          selectedInventoryId === inv.inventory_id
                            ? "border-primary bg-accent text-accent-foreground"
                            : "border-border hover:bg-muted"
                        )}
                      >
                        <span className="font-medium">{inv.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">ID: {inv.inventory_id}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {blCache.warehouses.length > 1 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">Magazyn</p>
                    <div className="space-y-1.5">
                      {blCache.warehouses.map((wh) => (
                        <button
                          key={wh.warehouse_id}
                          onClick={() => setSelectedWarehouse(wh.warehouse_id)}
                          className={cn(
                            "w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors",
                            selectedWarehouse === wh.warehouse_id
                              ? "border-primary bg-accent text-accent-foreground"
                              : "border-border hover:bg-muted"
                          )}
                        >
                          <span className="font-medium">{wh.name}</span>
                          <span className="text-xs text-muted-foreground ml-2">{wh.warehouse_id}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  onClick={() => loadBLCache(selectedInventoryId)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <RefreshCw className="size-3" />
                  Odśwież dane BL
                </button>
              </div>
            )}

            <Button
              onClick={handleInventoryConfirm}
              disabled={loading || !selectedInventoryId}
              className="w-full"
            >
              Dalej →
            </Button>
          </div>
        )

      case "category":
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Wybierz kategorię Allegro dla produktu:</p>
            {error && <div className="text-sm text-destructive bg-destructive/10 px-3 py-2.5 rounded-lg">{error}</div>}
            {loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Ładowanie parametrów...
              </div>
            )}
            <CategorySelector onSelect={handleCategorySelect} selectedCategory={session?.allegroCategory} />
          </div>
        )

      case "parameters":
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Wypełnij parametry kategorii Allegro:</p>
            <ParameterForm
              parameters={parameters}
              initialValues={session?.filledParameters ?? {}}
              onChange={(vals) => updateSession({ filledParameters: vals })}
            />
            <Button
              onClick={() => handleParametersSubmit(session?.filledParameters ?? {})}
              className="w-full"
            >
              Dalej →
            </Button>
          </div>
        )

      case "fields":
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Wybierz pola do wysłania do BaseLinker:</p>
            <FieldSelector
              mode={session?.mode ?? "new"}
              extraFields={(blCache?.extraFields ?? []) as BLExtraField[]}
              initialSelection={session?.fieldSelection}
              onChange={handleFieldsChange}
              values={buildFieldValues()}
            />
            <Button onClick={() => setCurrentStep("preview")} className="w-full">
              Podgląd →
            </Button>
          </div>
        )

      case "preview":
        return (
          <div className="space-y-4">
            <AllegroPreviewFrame />
            <Button onClick={() => setCurrentStep("ai")} className="w-full gap-2">
              <Sparkles className="size-4" />
              Asystent AI →
            </Button>
          </div>
        )

      case "ai":
        return (
          <div className="grid grid-cols-[1fr_420px] gap-5" style={{ minHeight: 580 }}>
            {/* ─── Left: editable offer preview ─── */}
            <div className="flex flex-col gap-4 overflow-y-auto pr-1">
              {/* Version history */}
              {versions.length > 0 && (
                <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-muted uppercase tracking-wider">
                    <History className="size-3.5" />
                    Historia zmian
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {versions.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => restoreVersion(v)}
                        className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-border bg-background hover:bg-accent hover:border-primary transition-colors"
                        title={`Przywróć: ${v.title.slice(0, 60)}`}
                      >
                        <RotateCcw className="size-3 text-muted-foreground" />
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Editable title */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted uppercase tracking-wider">
                  <Edit3 className="size-3" />
                  Tytuł oferty
                </label>
                <textarea
                  value={localTitle}
                  onChange={(e) => setLocalTitle(e.target.value)}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
                />
              </div>

              {/* Editable description */}
              <div className="flex-1 flex flex-col space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted uppercase tracking-wider">
                  <Edit3 className="size-3" />
                  Opis oferty
                </label>
                <textarea
                  value={localDescription}
                  onChange={(e) => setLocalDescription(e.target.value)}
                  className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
                  style={{ minHeight: 200 }}
                />
              </div>

              {/* Images strip */}
              {productData.images?.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-muted uppercase tracking-wider">
                    Zdjęcia ({productData.images.length})
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {productData.images.slice(0, 10).map((img, i) => (
                      <img
                        key={i}
                        src={img}
                        alt=""
                        className="size-14 object-cover rounded-lg border border-border"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
                      />
                    ))}
                    {productData.images.length > 10 && (
                      <div className="size-14 rounded-lg border border-border flex items-center justify-center text-xs text-muted">
                        +{productData.images.length - 10}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <Button
                onClick={async () => {
                  await updateSession({
                    data: { ...productData, title: localTitle, description: localDescription },
                  })
                  setCurrentStep("approval")
                }}
                className="w-full"
              >
                Zatwierdź i wyślij →
              </Button>
            </div>

            {/* ─── Right: ClaudeChat ─── */}
            <ClaudeChat
              currentTitle={localTitle}
              currentDescription={localDescription}
              currentImages={productData.images}
              onUpdate={async ({ title, description }) => {
                // Save current state as a version before applying changes
                setVersions((prev) => [
                  ...prev,
                  {
                    id: Date.now(),
                    label: `Zmiana ${prev.length + 1}`,
                    title: localTitle,
                    description: localDescription,
                  },
                ])
                const newTitle = title || localTitle
                const newDesc = description || localDescription
                if (title) setLocalTitle(newTitle)
                if (description) setLocalDescription(newDesc)
                await updateSession({
                  data: { ...productData, title: newTitle, description: newDesc },
                })
              }}
              className="flex flex-col"
              style={{ height: "100%" } as React.CSSProperties}
            />
          </div>
        )

      case "approval":
        return (
          <div className="space-y-4">
            {successId ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <CheckCircle2 className="size-12 text-green-600" />
                <p className="font-semibold">Wysłano pomyślnie!</p>
                <p className="text-sm text-muted-foreground">
                  ID produktu w BaseLinker: <strong className="text-foreground">{successId}</strong>
                </p>
                <Button variant="outline" onClick={onClose}>Zamknij</Button>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Sprawdź dane i zatwierdź wysyłkę do BaseLinker.
                </p>
                <Button
                  onClick={() => setShowApproval(true)}
                  className="w-full gap-2"
                >
                  <Send className="size-4" />
                  Otwórz bramkę zatwierdzenia
                </Button>
              </>
            )}
          </div>
        )
    }
  }

  return (
    <>
      <div className="rounded-xl ring-1 ring-foreground/10 bg-card overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
          <div className="flex items-center gap-2">
            <Tag className="size-4 text-primary" />
            <span className="text-sm font-semibold">
              {editProductId ? "Edycja oferty" : "Nowa oferta"} — BaseLinker
            </span>
            {editProductId && (
              <Badge variant="warning">ID: {editProductId}</Badge>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Step navigation */}
        <div className="flex border-b overflow-x-auto scrollbar-hide">
          {STEPS.map((step, i) => {
            const isDone = i < currentStepIndex
            const isActive = step.key === currentStep
            const isClickable = i <= currentStepIndex

            return (
              <button
                key={step.key}
                onClick={() => isClickable && setCurrentStep(step.key)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1 px-2 py-2.5 text-[11px] font-medium transition-colors whitespace-nowrap min-w-max",
                  isActive
                    ? "text-primary border-b-2 border-primary bg-accent/30"
                    : isDone
                    ? "text-green-600 hover:bg-muted cursor-pointer"
                    : "text-muted-foreground cursor-default"
                )}
              >
                {isDone ? <CheckCircle2 className="size-3.5 text-green-600 shrink-0" /> : step.icon}
                <span>{step.label}</span>
              </button>
            )
          })}
        </div>

        {/* Step content */}
        <div className="p-5">{renderStep()}</div>
      </div>

      {showApproval && session && (
        <ApprovalDrawer
          session={session}
          onClose={() => setShowApproval(false)}
          onApproved={(id) => {
            setSuccessId(id)
            setShowApproval(false)
            setCurrentStep("approval")
          }}
        />
      )}
    </>
  )
}
