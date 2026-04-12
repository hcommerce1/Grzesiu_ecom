"use client"

import { useState, useEffect } from "react"
import { Settings2, Tag, CheckSquare, Eye, Send, RefreshCw, Loader2, Sparkles, X, CheckCircle2, ImageIcon, AlertCircle, ChevronRight } from "lucide-react"
import { CategorySelector } from "./CategorySelector"
import { FieldsAndParametersStep } from "./FieldsAndParametersStep"
import { ApprovalDrawer } from "./ApprovalDrawer"
import { AllegroPreviewFrame } from "./AllegroPreviewFrame"
import { PreviewContainer } from "./previews/PreviewContainer"
import { ImageManagementStep } from "./ImageManagementStep"
import { DescriptionGenerationStep } from "./DescriptionGenerationStep"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type {
  ProductSession,
  AllegroCategory,
  AllegroParameter,
  BLCache,
  BLExtraField,
  ProductData,
  SheetMeta,
  ParameterMatchResult,
  ImageMeta,
  GeneratedDescription,
  DescriptionInputSnapshot,
  AutoFillEntry,
  BLProductType,
} from "@/lib/types"

interface Props {
  productData: ProductData
  editProductId?: string
  editProductType?: BLProductType
  editParentId?: string
  onClose: () => void
  sheetProductId?: string
  sheetMeta?: SheetMeta
  onSheetDone?: (blProductId: number) => void
}

type Step = "inventory" | "category" | "images" | "fields-params" | "description" | "preview" | "approval"

const STEPS: { key: Step; label: string; icon: React.ReactNode }[] = [
  { key: "inventory", label: "Magazyn", icon: <Settings2 className="size-3.5" /> },
  { key: "category", label: "Kategoria", icon: <Tag className="size-3.5" /> },
  { key: "images", label: "Zdjęcia", icon: <ImageIcon className="size-3.5" /> },
  { key: "fields-params", label: "Parametry", icon: <CheckSquare className="size-3.5" /> },
  { key: "description", label: "Tytuł i opis", icon: <Sparkles className="size-3.5" /> },
  { key: "preview", label: "Podgląd", icon: <Eye className="size-3.5" /> },
  { key: "approval", label: "Wyślij", icon: <Send className="size-3.5" /> },
]

export function BaselinkerWorkflowPanel({ productData, editProductId, editProductType, editParentId, onClose, sheetProductId, sheetMeta, onSheetDone }: Props) {
  const [currentStep, setCurrentStep] = useState<Step>("inventory")
  const [session, setSession] = useState<ProductSession | null>(null)
  const [blCache, setBlCache] = useState<BLCache | null>(null)
  const [parameters, setParameters] = useState<AllegroParameter[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [sheetMatchResults, setSheetMatchResults] = useState<ParameterMatchResult[]>([])
  const [sheetSuggestedValues, setSheetSuggestedValues] = useState<Record<string, string | string[]>>({})
  const [showApproval, setShowApproval] = useState(false)
  const [successId, setSuccessId] = useState<number | null>(null)
  const [selectedInventoryId, setSelectedInventoryId] = useState<number | undefined>()
  const [selectedWarehouse, setSelectedWarehouse] = useState<string | undefined>()

  // Tytuł
  const [localTitle, setLocalTitle] = useState(productData.title)
  const [titleCandidates, setTitleCandidates] = useState<string[]>([])

  // Zdjęcia
  const [imagesMeta, setImagesMeta] = useState<ImageMeta[]>([])

  // Opis strukturalny
  const [generatedDescription, setGeneratedDescription] = useState<GeneratedDescription | undefined>()
  const [descriptionSnapshot, setDescriptionSnapshot] = useState<DescriptionInputSnapshot | undefined>()

  // Parametry lokalne (dla synchronizacji z czatem)
  const [localParameters, setLocalParameters] = useState<Record<string, string | string[]>>({})

  // AI auto-fill
  const [aiFillStatus, setAiFillStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [aiFillResults, setAiFillResults] = useState<AutoFillEntry[]>([])

  // Navigation & validation
  const [maxVisitedStep, setMaxVisitedStep] = useState(0)
  const [validationErrors, setValidationErrors] = useState<string[]>([])

  useEffect(() => {
    loadBLCache()
    fetch("/api/product-session")
      .then((r) => r.json())
      .then((d) => {
        setSession(d.session)
        // Przywroc dane z sesji jesli istnieja
        if (d.session?.imagesMeta) setImagesMeta(d.session.imagesMeta)
        if (d.session?.generatedTitle) setLocalTitle(d.session.generatedTitle)
        if (d.session?.titleCandidates) setTitleCandidates(d.session.titleCandidates)
        if (d.session?.generatedDescription) setGeneratedDescription(d.session.generatedDescription)
        if (d.session?.descriptionInputSnapshot) setDescriptionSnapshot(d.session.descriptionInputSnapshot)
        if (d.session?.filledParameters) setLocalParameters(d.session.filledParameters)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const sheetFieldOverrides = sheetProductId ? {
        weight: true,
        dimensions: true,
        locations: true,
      } : {}

      // Determine correct mode based on product type
      let editPatch: Partial<ProductSession> = {}
      if (editProductId) {
        if (editProductType === 'variant' && editParentId) {
          editPatch = { mode: 'variant', parent_id: editParentId, product_id: editProductId }
        } else if (editProductType === 'bundle') {
          editPatch = { mode: 'bundle', product_id: editProductId }
        } else {
          editPatch = { mode: 'edit', product_id: editProductId }
        }
      }

      await updateSession({
        data: productData,
        images: productData.images,
        inventoryId: selectedInventoryId,
        defaultWarehouse: selectedWarehouse,
        ...editPatch,
        ...(sheetProductId ? { sheetProductId } : {}),
        ...(sheetMeta ? { sheetMeta } : {}),
        fieldSelection: sheetFieldOverrides,
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

      let autoFilledParams: Record<string, string | string[]> = {}

      if (sheetMeta) {
        try {
          const matchRes = await fetch("/api/sheets/match-parameters", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ categoryId: cat.id, sheetData: sheetMeta }),
          })
          const matchData = await matchRes.json()
          if (matchData.matchResults) setSheetMatchResults(matchData.matchResults)
          if (matchData.suggestedValues) {
            setSheetSuggestedValues(matchData.suggestedValues)
            autoFilledParams = matchData.suggestedValues
          }
        } catch {
          // Non-fatal
        }
      }

      if (Object.keys(autoFilledParams).length > 0) {
        setLocalParameters(prev => ({ ...prev, ...autoFilledParams }))
      }

      await updateSession({
        allegroCategory: cat,
        allegroParameters: paramsData.parameters,
        commissionInfo: paramsData.commissionInfo,
        ...(Object.keys(autoFilledParams).length > 0 ? { filledParameters: autoFilledParams } : {}),
        ...(sheetProductId ? { sheetProductId } : {}),
        ...(sheetMeta ? { sheetMeta } : {}),
      })
      setCurrentStep("images")

      // Nieblokujący AI auto-fill w tle
      const fetchedParams: AllegroParameter[] = paramsData.parameters ?? []
      if (fetchedParams.length > 0) {
        setAiFillStatus('loading')
        fetch("/api/ai-autofill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productData,
            parameters: fetchedParams,
            alreadyFilled: autoFilledParams,
          }),
        })
          .then(r => r.json())
          .then(result => {
            if (result.error) {
              setAiFillStatus('error')
              return
            }
            setAiFillResults(result.details ?? [])
            const aiFilled: Record<string, string | string[]> = result.filled ?? {}
            if (Object.keys(aiFilled).length > 0) {
              setLocalParameters(prev => {
                // Sheet values mają priorytet — AI uzupełnia tylko brakujące
                const merged = { ...prev }
                for (const [id, val] of Object.entries(aiFilled)) {
                  if (!merged[id]) merged[id] = val
                }
                updateSession({ filledParameters: merged })
                return merged
              })
            }
            setAiFillStatus('done')
          })
          .catch(() => setAiFillStatus('error'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd pobierania parametrów")
    } finally {
      setLoading(false)
    }
  }

  async function handleFieldsChange(selection: Partial<import("@/lib/types").FieldSelection>) {
    await updateSession({ fieldSelection: selection })
  }

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
      description: generatedDescription?.fullHtml
        ? `${generatedDescription.sections.length} sekcji`
        : productData.description
          ? productData.description.slice(0, 60).replace(/\s+/g, " ") + (productData.description.length > 60 ? "…" : "")
          : "",
      images: imagesMeta.filter(i => !i.removed).length
        ? `${imagesMeta.filter(i => !i.removed).length} zdjęć`
        : productData.images?.length ? `${productData.images.length} zdjęć` : "",
      prices: priceStr,
      manufacturer_id: manufacturer,
      category_id: session?.allegroCategory?.id || "",
      features: Object.keys(localParameters).length
        ? `${Object.keys(localParameters).length} parametrów`
        : "",
      weight,
    }
  }

  // Synchronizacja parametrów z czatu do sesji
  function handleParameterChangeFromChat(id: string, value: string | string[]) {
    setLocalParameters(prev => {
      const updated = { ...prev, [id]: value }
      updateSession({ filledParameters: updated })
      return updated
    })
  }

  const currentStepIndex = STEPS.findIndex((s) => s.key === currentStep)

  // Update maxVisitedStep when navigating forward
  useEffect(() => {
    if (currentStepIndex > maxVisitedStep) {
      setMaxVisitedStep(currentStepIndex)
    }
  }, [currentStepIndex, maxVisitedStep])

  function validateStep(fromIndex: number): { valid: boolean; errors: string[] } {
    const errors: string[] = []
    const stepKey = STEPS[fromIndex]?.key

    switch (stepKey) {
      case 'inventory':
        if (!selectedInventoryId) errors.push('Wybierz magazyn')
        break
      case 'category':
        if (!session?.allegroCategory) errors.push('Wybierz kategorię Allegro')
        break
      case 'images': {
        const activeImages = imagesMeta.filter(m => !m.removed)
        if (activeImages.length === 0) errors.push('Dodaj co najmniej 1 zdjęcie')
        break
      }
      case 'fields-params':
        if (!localTitle?.trim()) errors.push('Uzupełnij tytuł produktu')
        break
      case 'description':
        if (!localTitle?.trim()) errors.push('Uzupełnij tytuł produktu')
        if (!generatedDescription) errors.push('Wygeneruj opis przed kontynuowaniem')
        break
    }
    return { valid: errors.length === 0, errors }
  }

  function navigateToStep(targetIndex: number) {
    setValidationErrors([])
    // Going backwards — always allowed if visited before
    if (targetIndex <= currentStepIndex) {
      setCurrentStep(STEPS[targetIndex].key)
      return
    }
    // Going forward — validate each step in between
    for (let i = currentStepIndex; i < targetIndex; i++) {
      const result = validateStep(i)
      if (!result.valid) {
        setValidationErrors(result.errors)
        return
      }
    }
    setCurrentStep(STEPS[targetIndex].key)
  }

  function handleNextStep() {
    const nextIndex = currentStepIndex + 1
    if (nextIndex >= STEPS.length) return
    navigateToStep(nextIndex)
  }

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
            <CategorySelector onSelect={handleCategorySelect} selectedCategory={session?.allegroCategory} productData={productData} />
          </div>
        )

      case "images":
        return (
          <div className="space-y-4">
            <ImageManagementStep
              images={productData.images}
              imagesMeta={imagesMeta}
              onImagesMetaChange={(meta) => {
                setImagesMeta(meta)
                updateSession({ imagesMeta: meta })
              }}
            />
            <Button
              onClick={() => setCurrentStep("fields-params")}
              disabled={imagesMeta.filter(i => !i.removed).length === 0 && productData.images.length === 0}
              className="w-full"
            >
              Dalej →
            </Button>
          </div>
        )

      case "fields-params":
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Skonfiguruj pola i parametry oferty:</p>
            <FieldsAndParametersStep
              mode={session?.mode ?? "new"}
              extraFields={(blCache?.extraFields ?? []) as BLExtraField[]}
              parameters={parameters}
              initialFieldSelection={session?.fieldSelection}
              initialParameterValues={localParameters}
              fieldValues={buildFieldValues()}
              onFieldSelectionChange={handleFieldsChange}
              onParameterValuesChange={(vals) => {
                setLocalParameters(vals)
                updateSession({ filledParameters: vals })
              }}
              sheetMatchResults={sheetMatchResults.length > 0 ? sheetMatchResults : undefined}
              aiFillResults={aiFillResults.length > 0 ? aiFillResults : undefined}
              aiFillStatus={aiFillStatus}
            />
            <Button onClick={() => setCurrentStep("description")} className="w-full gap-2">
              <Sparkles className="size-4" />
              Generuj opis →
            </Button>
          </div>
        )

      case "description":
        return (
          <DescriptionGenerationStep
            title={localTitle}
            translatedData={{
              title: productData.title,
              attributes: productData.attributes,
            }}
            imagesMeta={imagesMeta.length > 0 ? imagesMeta : productData.images.map((url, i) => ({
              url,
              order: i,
              removed: false,
              aiDescription: "",
              aiConfidence: 0,
              userDescription: "",
              isFeatureImage: false,
              features: [],
            }))}
            filledParameters={localParameters}
            categoryPath={session?.allegroCategory?.path || ""}
            categoryId={session?.allegroCategory?.id || ""}
            allegroParameters={parameters}
            descriptionPrompt={session?.descriptionPrompt}
            generatedDescription={generatedDescription}
            previousSnapshot={descriptionSnapshot}
            titleCandidates={titleCandidates}
            onDescriptionChange={(desc) => {
              setGeneratedDescription(desc)
              updateSession({ generatedDescription: desc })
            }}
            onSnapshotChange={(snapshot) => {
              setDescriptionSnapshot(snapshot)
              updateSession({ descriptionInputSnapshot: snapshot })
            }}
            onTitleChange={(title) => {
              setLocalTitle(title)
              updateSession({ generatedTitle: title })
            }}
            onCandidatesChange={setTitleCandidates}
            onParameterChange={handleParameterChangeFromChat}
          />
        )

      case "preview":
        return (
          <div className="space-y-4">
            {generatedDescription?.fullHtml ? (
              <PreviewContainer
                title={localTitle}
                fullHtml={generatedDescription.fullHtml}
                imagesMeta={imagesMeta.length > 0 ? imagesMeta : productData.images.map((url, i) => ({
                  url, order: i, removed: false, aiDescription: "", aiConfidence: 0,
                  userDescription: "", isFeatureImage: false, features: [],
                }))}
                parameters={localParameters}
              />
            ) : (
              <AllegroPreviewFrame />
            )}
            <Button
              onClick={async () => {
                // Zapisz wszystkie dane do sesji przed wysylka
                await updateSession({
                  data: {
                    ...productData,
                    title: localTitle,
                    description: generatedDescription?.fullHtml || productData.description,
                    images: imagesMeta.filter(i => !i.removed).map(i => i.url),
                  },
                })
                setCurrentStep("approval")
              }}
              className="w-full"
            >
              Zatwierdź i wyślij →
            </Button>
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
              {editProductId
                ? editProductType === 'variant' ? "Edycja wariantu" : "Edycja oferty"
                : "Nowa oferta"} — BaseLinker
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
            const isClickable = i <= maxVisitedStep || i === maxVisitedStep + 1

            return (
              <button
                key={step.key}
                onClick={() => isClickable && navigateToStep(i)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1 px-2 py-2.5 text-[11px] font-medium transition-colors whitespace-nowrap min-w-max",
                  isActive
                    ? "text-primary border-b-2 border-primary bg-accent/30"
                    : isDone
                    ? "text-green-600 hover:bg-muted cursor-pointer"
                    : isClickable
                    ? "text-muted-foreground hover:bg-muted/50 cursor-pointer"
                    : "text-muted-foreground/40 cursor-default"
                )}
              >
                {isDone ? <CheckCircle2 className="size-3.5 text-green-600 shrink-0" /> : step.icon}
                <span>{step.label}</span>
              </button>
            )
          })}
        </div>

        {/* Validation errors */}
        {validationErrors.length > 0 && (
          <div className="mx-5 mt-3 flex items-start gap-2 text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg border border-destructive/20">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <div>
              {validationErrors.map((err, i) => (
                <p key={i}>{err}</p>
              ))}
            </div>
          </div>
        )}

        {/* Step content */}
        <div className="p-5">
          {renderStep()}

          {/* Next step button */}
          {currentStep !== 'approval' && (
            <div className="mt-6 flex justify-end">
              <Button onClick={handleNextStep} className="gap-1.5">
                Dalej
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {showApproval && session && (
        <ApprovalDrawer
          session={session}
          onClose={() => setShowApproval(false)}
          onApproved={async (id) => {
            setSuccessId(id)
            setShowApproval(false)
            setCurrentStep("approval")

            if (sheetProductId) {
              try {
                await fetch(`/api/sheets/products/${encodeURIComponent(sheetProductId)}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ status: "done", bl_product_id: String(id) }),
                })
              } catch {
                // Non-fatal
              }
              onSheetDone?.(id)
            }
          }}
        />
      )}
    </>
  )
}
