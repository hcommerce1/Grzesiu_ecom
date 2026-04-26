"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Settings2, Tag, CheckSquare, Eye, Send, RefreshCw, Loader2, X, CheckCircle2, ImageIcon, AlertCircle, Link2, AlertTriangle, ChevronLeft, ChevronRight, History, Settings, Target, Check, HelpCircle } from "lucide-react"
import { CategorySelector } from "./CategorySelector"
import { FieldsAndParametersStep } from "./FieldsAndParametersStep"
import { ApprovalDrawer } from "./ApprovalDrawer"
import { PreviewContainer } from "./previews/PreviewContainer"
import { TokenCostBadge } from "./TokenCostBadge"
import { ImageManagementStep } from "./ImageManagementStep"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import * as Dialog from "@radix-ui/react-dialog"
import { cn } from "@/lib/utils"
import { useEditProgressStore } from "@/lib/stores/edit-progress-store"
import { toast } from "sonner"
import { compileSectionsToHtml, buildInputSnapshot, classifyChangesDetailed } from "@/lib/description-utils"
import { DEFAULT_DESCRIPTION_PROMPT } from "@/lib/description-prompt"
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
  DescriptionSection,
  DescriptionInputSnapshot,
  AutoFillEntry,
  BLProductType,
  TargetableSection,
  ChatAction,
  DescriptionVersion,
  ChangeClassification,
} from "@/lib/types"

const MAX_DESCRIPTION_VERSIONS = 20

interface Props {
  productData: ProductData
  editProductId?: string
  editProductType?: BLProductType
  editParentId?: string
  onClose: () => void
  sheetProductId?: string
  sheetMeta?: SheetMeta
  onSheetDone?: (blProductId: number) => void
  /** When provided: last step becomes "Zapisz jako template" instead of "Wyślij" */
  onSaveTemplate?: (session: ProductSession) => void
  /** Called after successful BaseLinker submission — receives the completed session */
  onSubmitSuccess?: (session: ProductSession) => void
  /** Reference product description for context (scraped from a reference URL) */
  referenceDescription?: string
}

export type Step = "inventory" | "category" | "images" | "fields-params" | "preview" | "approval"

const STEPS: { key: Step; label: string; icon: React.ReactNode }[] = [
  { key: "inventory", label: "Magazyn", icon: <Settings2 className="size-3.5" /> },
  { key: "category", label: "Kategoria", icon: <Tag className="size-3.5" /> },
  { key: "images", label: "Zdjęcia", icon: <ImageIcon className="size-3.5" /> },
  { key: "fields-params", label: "Parametry", icon: <CheckSquare className="size-3.5" /> },
  { key: "preview", label: "Podgląd", icon: <Eye className="size-3.5" /> },
  { key: "approval", label: "Wyślij", icon: <Send className="size-3.5" /> },
]

export function BaselinkerWorkflowPanel({ productData, editProductId, editProductType, editParentId, onClose, sheetProductId, sheetMeta, onSheetDone, onSaveTemplate, onSubmitSuccess }: Props) {
  const [currentStep, setCurrentStep] = useState<Step>("inventory")
  const [session, setSession] = useState<ProductSession | null>(null)
  const [blCache, setBlCache] = useState<BLCache | null>(null)
  const [parameters, setParameters] = useState<AllegroParameter[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [sheetMatchResults, setSheetMatchResults] = useState<ParameterMatchResult[]>([])
  const [, setSheetSuggestedValues] = useState<Record<string, string | string[]>>({})
  const [showApproval, setShowApproval] = useState(false)
  const [successId, setSuccessId] = useState<number | null>(null)
  const [selectedInventoryId, setSelectedInventoryId] = useState<number | undefined>()
  const [selectedWarehouse, setSelectedWarehouse] = useState<string | undefined>()

  // Tytuł
  const [localTitle, setLocalTitle] = useState(productData.title)
  const [isTitleGenerated, setIsTitleGenerated] = useState(false)
  const [titleCandidates, setTitleCandidates] = useState<string[]>([])

  // Zdjęcia
  const [imagesMeta, setImagesMeta] = useState<ImageMeta[]>([])

  // Opis strukturalny
  const [generatedDescription, setGeneratedDescription] = useState<GeneratedDescription | undefined>()
  const [descriptionSnapshot, setDescriptionSnapshot] = useState<DescriptionInputSnapshot | undefined>()

  // Auto-generate Podgląd state
  const [isGeneratingDesc, setIsGeneratingDesc] = useState(false)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const lastGeneratedKey = useRef<string>('')
  const generationAbortRef = useRef<AbortController | null>(null)

  // Validation modal — pre-generation check (E6)
  const [showValidationModal, setShowValidationModal] = useState(false)
  const [validationOverride, setValidationOverride] = useState(false)

  // E4: confirmation modal "Zacznij od nowa" — kasuje snapshot per-produkt i resetuje state UI.
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  // Parametry lokalne (dla synchronizacji z czatem)
  const [localParameters, setLocalParameters] = useState<Record<string, string | string[]>>({})

  // AI auto-fill
  const [aiFillStatus, setAiFillStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [aiFillResults, setAiFillResults] = useState<AutoFillEntry[]>([])

  // Pola dodatkowe
  const [extraFieldValues, setExtraFieldValues] = useState<Record<string, string>>({})

  // Editable field values (user overrides)
  const [editableFieldValues, setEditableFieldValues] = useState<Record<string, string>>({})

  // Tax rate
  const [localTaxRate, setLocalTaxRate] = useState<number | string>(productData.taxRate ?? 23)

  // Bundle
  const [isBundle, setIsBundle] = useState(productData.isBundle ?? editProductType === 'bundle')
  const [bundleProducts, setBundleProducts] = useState<Record<string, number>>(productData.bundleProducts ?? {})

  // Reference URL scraping (for edit mode)
  const [referenceUrl, setReferenceUrl] = useState(productData.url ?? '')
  const [scrapeLoading, setScrapeLoading] = useState(false)

  const handleScrapeReferenceUrl = async () => {
    if (!referenceUrl.trim()) return
    setScrapeLoading(true)
    try {
      const scrapeRes = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: referenceUrl.trim() }),
      })
      if (!scrapeRes.ok) throw new Error(await scrapeRes.text())
      const scraped = await scrapeRes.json()

      if (!scraped.success) {
        throw new Error(scraped.error ?? 'Scraping failed')
      }

      const scrapedData = scraped.data as import('@/lib/types').ProductData

      // Run ai-autofill with scraped attributes
      const autofillRes = await fetch('/api/ai-autofill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productData: { ...productData, attributes: { ...productData.attributes, ...(scrapedData.attributes ?? {}) } },
          parameters: parameters,
          alreadyFilled: localParameters,
        }),
      })
      if (autofillRes.ok) {
        const autofillData = await autofillRes.json()
        const filled: Record<string, string | string[]> = autofillData.filled ?? {}
        if (Object.keys(filled).length > 0) {
          setLocalParameters(prev => {
            const merged = { ...prev, ...filled }
            updateSession({ filledParameters: merged })
            return merged
          })
        }
        if (autofillData.details?.length > 0) {
          setAiFillResults(autofillData.details)
        }
      }

      // Apply scraped images to imagesMeta
      if (scrapedData.images?.length) {
        const newMetas: ImageMeta[] = scrapedData.images.map((url, idx) => ({
          url,
          order: imagesMeta.length + idx,
          removed: false,
          aiDescription: '',
          aiConfidence: 0,
          userDescription: '',
          isFeatureImage: idx === 0 && imagesMeta.length === 0,
          features: [],
        }))
        const merged = [...imagesMeta, ...newMetas]
        setImagesMeta(merged)
        updateSession({ imagesMeta: merged })
      }

      // Fill description if available
      if (scrapedData.description && session?.data) {
        updateSession({ data: { ...session.data, description: scrapedData.description } })
      }

      const count = scrapedData.images?.length ?? 0
      toast.success(`Pobrano dane z URL${count > 0 ? ` (${count} zdjęć)` : ''}`)
    } catch (e) {
      toast.error(`Błąd scrapowania: ${String(e)}`)
    } finally {
      setScrapeLoading(false)
    }
  }

  // Debounced session sync refs
  const paramSyncTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const extraFieldSyncTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const editableFieldSyncTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    return () => {
      clearTimeout(paramSyncTimer.current)
      clearTimeout(extraFieldSyncTimer.current)
      clearTimeout(editableFieldSyncTimer.current)
    }
  }, [])

  // Section targeting
  const [targetedSections, setTargetedSections] = useState<TargetableSection[]>([])

  const toggleTargetedSection = useCallback((section: TargetableSection) => {
    setTargetedSections(prev => {
      const exists = prev.find(s => s.id === section.id)
      if (exists) return prev.filter(s => s.id !== section.id)
      return [...prev, section]
    })
  }, [])

  // ─── Description versioning (lifted from old DescriptionGenerationStep) ───
  const [descriptionVersions, setDescriptionVersions] = useState<DescriptionVersion[]>([])
  const [versionIndex, setVersionIndex] = useState(-1) // -1 = live (current)

  const pushDescriptionVersion = useCallback(
    (desc: GeneratedDescription, titleVal: string, label?: string) => {
      setDescriptionVersions(prev => {
        const v: DescriptionVersion = {
          sections: desc.sections,
          fullHtml: desc.fullHtml,
          title: titleVal,
          timestamp: new Date().toISOString(),
          label,
        }
        const next = [...prev, v]
        if (next.length > MAX_DESCRIPTION_VERSIONS) next.shift()
        updateSession({ descriptionVersions: next }).catch(() => {/* non-fatal */})
        return next
      })
      setVersionIndex(-1)
    },
    [],
  )

  // ─── Change detection ───
  const [changeClassification, setChangeClassification] = useState<ChangeClassification>({ severity: 'none', changes: [] })
  const [showChangeBanner, setShowChangeBanner] = useState(false)

  // ─── Prompt editor (migrated from localStorage to ProductSession.descriptionPrompt) ───
  const [promptOpen, setPromptOpen] = useState(false)
  const [promptText, setPromptText] = useState(DEFAULT_DESCRIPTION_PROMPT)

  // Chat section handlers (for ClaudeChat operating on generatedDescription)
  const handleChatSectionUpdate = useCallback(
    (sectionId: string, heading?: string, bodyHtml?: string) => {
      if (!generatedDescription) return
      const updated = generatedDescription.sections.map(s => {
        if (s.id !== sectionId) return s
        return {
          ...s,
          heading: heading !== undefined ? heading : s.heading,
          bodyHtml: bodyHtml !== undefined ? bodyHtml : s.bodyHtml,
        }
      })
      const fullHtml = compileSectionsToHtml(updated)
      const desc = { ...generatedDescription, sections: updated, fullHtml }
      setGeneratedDescription(desc)
      updateSession({ generatedDescription: desc })
    },
    [generatedDescription],
  )

  const handleChatSectionImageReorder = useCallback(
    (sectionId: string, imageUrls: string[]) => {
      if (!generatedDescription) return
      const updated = generatedDescription.sections.map(s => {
        if (s.id !== sectionId) return s
        return { ...s, imageUrls }
      })
      const fullHtml = compileSectionsToHtml(updated)
      const desc = { ...generatedDescription, sections: updated, fullHtml }
      setGeneratedDescription(desc)
      updateSession({ generatedDescription: desc })
    },
    [generatedDescription],
  )

  const handleChatSectionRemove = useCallback(
    (sectionId: string) => {
      if (!generatedDescription) return
      const updated = generatedDescription.sections.filter(s => s.id !== sectionId)
      const fullHtml = compileSectionsToHtml(updated)
      const desc = { ...generatedDescription, sections: updated, fullHtml }
      setGeneratedDescription(desc)
      updateSession({ generatedDescription: desc })
    },
    [generatedDescription],
  )

  const handleChatSectionAdd = useCallback(
    (newSection: { id: string; heading: string; bodyHtml: string; layout: 'image-text' | 'images-only' | 'text-only'; imageUrls: string[] }, afterSectionId?: string) => {
      if (!generatedDescription) return
      const sections = [...generatedDescription.sections]
      if (afterSectionId) {
        const idx = sections.findIndex(s => s.id === afterSectionId)
        sections.splice(idx + 1, 0, newSection)
      } else {
        sections.push(newSection)
      }
      const fullHtml = compileSectionsToHtml(sections)
      const desc = { ...generatedDescription, sections, fullHtml }
      setGeneratedDescription(desc)
      updateSession({ generatedDescription: desc })
    },
    [generatedDescription],
  )

  const handleChatSectionLayoutChange = useCallback(
    (sectionId: string, layout: 'image-text' | 'images-only' | 'text-only') => {
      if (!generatedDescription) return
      const updated = generatedDescription.sections.map(s =>
        s.id === sectionId ? { ...s, layout } : s
      )
      const fullHtml = compileSectionsToHtml(updated)
      const desc = { ...generatedDescription, sections: updated, fullHtml }
      setGeneratedDescription(desc)
      updateSession({ generatedDescription: desc })
    },
    [generatedDescription],
  )

  const handleChatSectionsReorder = useCallback(
    (sectionIds: string[]) => {
      if (!generatedDescription) return
      const sectionMap = new Map(generatedDescription.sections.map(s => [s.id, s]))
      const reordered = sectionIds.map(id => sectionMap.get(id)).filter(Boolean) as typeof generatedDescription.sections
      const fullHtml = compileSectionsToHtml(reordered)
      const desc = { ...generatedDescription, sections: reordered, fullHtml }
      setGeneratedDescription(desc)
      updateSession({ generatedDescription: desc })
    },
    [generatedDescription],
  )

  const handleChatSectionImageAdd = useCallback(
    (sectionId: string, imageUrl: string) => {
      if (!generatedDescription) return
      const updated = generatedDescription.sections.map(s =>
        s.id === sectionId ? { ...s, imageUrls: [...s.imageUrls, imageUrl] } : s
      )
      const fullHtml = compileSectionsToHtml(updated)
      const desc = { ...generatedDescription, sections: updated, fullHtml }
      setGeneratedDescription(desc)
      updateSession({ generatedDescription: desc })
    },
    [generatedDescription],
  )

  const handleChatSectionImageRemove = useCallback(
    (sectionId: string, imageUrl: string) => {
      if (!generatedDescription) return
      const updated = generatedDescription.sections.map(s =>
        s.id === sectionId ? { ...s, imageUrls: s.imageUrls.filter(u => u !== imageUrl) } : s
      )
      const fullHtml = compileSectionsToHtml(updated)
      const desc = { ...generatedDescription, sections: updated, fullHtml }
      setGeneratedDescription(desc)
      updateSession({ generatedDescription: desc })
    },
    [generatedDescription],
  )

  // Navigation & validation
  const [maxVisitedStep, setMaxVisitedStep] = useState(0)
  const [validationErrors, setValidationErrors] = useState<string[]>([])

  useEffect(() => {
    loadBLCache()
    const sessionUrl = productKey
      ? `/api/product-session?productKey=${encodeURIComponent(productKey)}`
      : "/api/product-session"
    fetch(sessionUrl)
      .then((r) => r.json())
      .then((d) => {
        setSession(d.session)
        // Sprawdź czy sesja dotyczy tego samego produktu
        const sessionMatchesProduct = d.session && (
          editProductId
            ? d.session.product_id === editProductId
            : d.session.data?.url === productData.url
        )
        // Przywroc dane z sesji tylko jesli dotycza tego samego produktu
        if (sessionMatchesProduct) {
          if (d.session.imagesMeta) {
            setImagesMeta(d.session.imagesMeta)
          }
          if (d.session.generatedTitle) { setLocalTitle(d.session.generatedTitle); setIsTitleGenerated(true) }
          if (d.session.titleCandidates) setTitleCandidates(d.session.titleCandidates)
          if (d.session.generatedDescription) setGeneratedDescription(d.session.generatedDescription)
          if (d.session.descriptionInputSnapshot) setDescriptionSnapshot(d.session.descriptionInputSnapshot)
          if (d.session.filledParameters) setLocalParameters(d.session.filledParameters)
          if (d.session.allegroParameters) setParameters(d.session.allegroParameters)
          if (d.session.aiFillResults?.length) { setAiFillResults(d.session.aiFillResults); setAiFillStatus('done') }
          if (d.session.descriptionVersions?.length) setDescriptionVersions(d.session.descriptionVersions)
          if (d.session.descriptionPrompt) setPromptText(d.session.descriptionPrompt)
          if (d.session.extraFieldValues) setExtraFieldValues(d.session.extraFieldValues)
          if (d.session.editableFieldValues) setEditableFieldValues(d.session.editableFieldValues)
          if (d.session.tax_rate != null) setLocalTaxRate(d.session.tax_rate)
        }
        // Prefill editableFieldValues z BL danych (price, stock, manufacturer, dimensions itd.)
        // gdy sesja nie pasuje (nowy produkt do edytowania) lub nie ma jeszcze editableFieldValues.
        if ((!sessionMatchesProduct || !d.session?.editableFieldValues) && productData.editPrefill) {
          setEditableFieldValues(prev => ({ ...productData.editPrefill, ...prev }))
        }
        if (sessionMatchesProduct) {
          if (d.session.is_bundle != null) setIsBundle(d.session.is_bundle)
          if (d.session.bundle_products) setBundleProducts(d.session.bundle_products)
        }
        // Zdjęcia inicjalizuj z produktu jeśli sesja nie pasuje lub nie ma imagesMeta
        if (!sessionMatchesProduct || !d.session?.imagesMeta) {
          if (productData.images.length > 0) {
            setImagesMeta(productData.images.map((url, i) => ({
              url, order: i, removed: false, aiDescription: '',
              aiConfidence: 0, userDescription: '', isFeatureImage: false, features: [],
            })))
          }
        }
        // Restore step — only for sheet products (resume flow) AND same product
        if (sessionMatchesProduct && d.session?.currentStep && sheetProductId) {
          const step = d.session.currentStep as Step
          const idx = STEPS.findIndex(s => s.key === step)
          if (idx >= 0) {
            setCurrentStep(step)
            setMaxVisitedStep(idx)
          }
        }
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
      // Set default price group for agent (Bug 1 fix)
      if (data.cache.priceGroups?.length > 0) {
        updateSession({ defaultPriceGroup: String(data.cache.priceGroups[0].price_group_id) }).catch(() => {/* non-fatal */})
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd bootstrap BaseLinker")
    } finally {
      setLoading(false)
    }
  }

  const markEditProgress = useEditProgressStore((s) => s.markProgress)
  const clearEditProgress = useEditProgressStore((s) => s.clearProgress)

  // Klucz sesji per-produkt — pozwala na równoczesne snapshoty wielu produktów (E4).
  // Dla edit i sheet klucz jest deterministyczny po stronie klienta.
  // Dla scrape (url-based) klient pomija — server używa active session.
  const productKey: string | undefined = editProductId
    ? `bl_${editProductId}`
    : sheetProductId
      ? `sheet_${sheetProductId}`
      : undefined

  async function updateSession(patch: Partial<ProductSession>) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      const sessionUrl = productKey
        ? `/api/product-session?productKey=${encodeURIComponent(productKey)}`
        : "/api/product-session"
      const res = await fetch(sessionUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
        signal: controller.signal,
      })
      const data = await res.json()
      setSession(data.session)
      // Mark progres dla edycji istniejącego produktu (E10 — badge "W trakcie edycji")
      if (editProductId) {
        markEditProgress(editProductId, {
          lastStep: data.session?.currentStep,
          hasGeneratedDescription: !!data.session?.generatedDescription?.fullHtml,
          hasFilledParameters: Object.keys(data.session?.filledParameters ?? {}).length > 0,
        })
      }
      return data.session as ProductSession
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        console.error('[Session] updateSession timeout po 10s')
      }
      throw err
    } finally {
      clearTimeout(timeout)
    }
  }

  // Stabilne callbacki z debounce dla parametrów/pól (zapobiega re-renderom i lagom)
  const handleParameterValuesChange = useCallback((vals: Record<string, string | string[]>) => {
    setLocalParameters(vals)
    clearTimeout(paramSyncTimer.current)
    paramSyncTimer.current = setTimeout(() => {
      updateSession({ filledParameters: vals })
    }, 500)
  }, [])

  const handleExtraFieldValuesChange = useCallback((vals: Record<string, string>) => {
    setExtraFieldValues(vals)
    clearTimeout(extraFieldSyncTimer.current)
    extraFieldSyncTimer.current = setTimeout(() => {
      updateSession({ extraFieldValues: vals })
    }, 500)
  }, [])

  const handleEditableFieldValueChange = useCallback((key: string, value: string) => {
    setEditableFieldValues(prev => {
      const next = { ...prev, [key]: value }
      clearTimeout(editableFieldSyncTimer.current)
      editableFieldSyncTimer.current = setTimeout(() => {
        updateSession({ editableFieldValues: next })
      }, 500)
      return next
    })
  }, [])

  const handleTaxRateChange = useCallback((rate: number | string) => {
    setLocalTaxRate(rate)
    updateSession({ tax_rate: rate })
  }, [])

  const handleIsBundleChange = useCallback((val: boolean) => {
    setIsBundle(val)
    if (!val) setBundleProducts({})
    updateSession({ is_bundle: val, bundle_products: val ? bundleProducts : {} })
  }, [bundleProducts])

  const handleBundleProductsChange = useCallback((val: Record<string, number>) => {
    setBundleProducts(val)
    updateSession({ bundle_products: val })
  }, [])

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
      goToStep("category")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd")
    } finally {
      setLoading(false)
    }
  }

  async function handleCategoryReset() {
    await updateSession({
      allegroCategory: null,
      allegroParameters: null,
      filledParameters: null,
      ...(sheetProductId ? { sheetProductId } : {}),
      ...(sheetMeta ? { sheetMeta } : {}),
    })
    setParameters([])
    setLocalParameters({})
    setAiFillResults([])
    setAiFillStatus('idle')
    setSheetMatchResults([])
    setSheetSuggestedValues({})
  }

  async function handleCategorySelect(cat: AllegroCategory) {
    setLoading(true)
    setError("")

    // Natychmiast zapisz kategorię w sesji, żeby UI ją pokazał
    await updateSession({
      allegroCategory: cat,
      ...(sheetProductId ? { sheetProductId } : {}),
      ...(sheetMeta ? { sheetMeta } : {}),
    })

    try {
      console.log(`[Category] Fetching parameters for category ${cat.id} (${cat.name})...`)
      const t0 = performance.now()
      const paramsRes = await fetch(`/api/allegro/parameters?categoryId=${cat.id}`)
      console.log(`[Category] Parameters response: ${paramsRes.status} in ${Math.round(performance.now() - t0)}ms`)

      if (!paramsRes.ok) {
        const errText = await paramsRes.text()
        throw new Error(`HTTP ${paramsRes.status}: ${errText}`)
      }

      const paramsData = await paramsRes.json()

      if (paramsData.error) {
        throw new Error(paramsData.error)
      }

      console.log(`[Category] Got ${(paramsData.parameters ?? []).length} parameters`)
      setParameters(paramsData.parameters ?? [])

      let autoFilledParams: Record<string, string | string[]> = {}

      if (sheetMeta && paramsData.parameters?.length > 0) {
        try {
          const matchRes = await fetch("/api/sheets/match-parameters", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ categoryId: cat.id, sheetData: sheetMeta, parameters: paramsData.parameters }),
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
      goToStep("images")

      // Nieblokujący AI auto-fill w tle
      const fetchedParams: AllegroParameter[] = paramsData.parameters ?? []
      console.log(`[AI auto-fill] Starting: ${fetchedParams.length} params, product attrs: ${Object.keys(productData.attributes ?? {}).length}, already filled: ${Object.keys(autoFilledParams).length}`)
      if (fetchedParams.length > 0) {
        setAiFillStatus('loading')
        fetch("/api/ai-autofill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productData,
            parameters: fetchedParams,
            alreadyFilled: autoFilledParams,
            imageMeta: imagesMeta
              .filter(m => !m.removed && (m.aiDescription || (m.features && m.features.length > 0)))
              .map(m => ({ url: m.url, aiDescription: m.aiDescription, features: m.features })),
          }),
        })
          .then(r => r.json())
          .then(result => {
            if (result.error) {
              setAiFillStatus('error')
              toast.error("Błąd AI auto-fill parametrów")
              return
            }
            const details: AutoFillEntry[] = result.details ?? []
            setAiFillResults(details)
            updateSession({ aiFillResults: details })
            const aiFilled: Record<string, string | string[]> = result.filled ?? {}
            console.log('[AI auto-fill] filled:', aiFilled, 'details:', details.length)
            if (Object.keys(aiFilled).length > 0) {
              setLocalParameters(prev => {
                // Sheet values mają priorytet — AI uzupełnia tylko brakujące
                const merged = { ...prev }
                for (const [id, val] of Object.entries(aiFilled)) {
                  // Sprawdź czy pole jest już wypełnione (nie puste)
                  const existing = merged[id]
                  const hasValue = existing != null &&
                    (typeof existing === 'string' ? existing.trim().length > 0 : existing.length > 0)
                  if (hasValue) continue // sheet priorytet
                  merged[id] = val
                }
                console.log('[AI auto-fill] merged params:', Object.keys(merged).length)
                updateSession({ filledParameters: merged })
                return merged
              })
              toast.success(`AI wypełniło ${details.length} parametrów`)
            } else {
              toast.info("AI nie znalazło pasujących wartości parametrów")
            }
            setAiFillStatus('done')
          })
          .catch(() => {
            setAiFillStatus('error')
            toast.error("Błąd AI auto-fill parametrów")
          })
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
      editableFieldValues['manufacturer_id'] || attrs["Marka"] || attrs["Producent"] || attrs["Manufacturer"] || attrs["Brand"] || ""
    const weight = editableFieldValues['weight'] || attrs["Waga"] || attrs["Weight"] || attrs["Masa"] || ""
    const priceStr = editableFieldValues['prices'] || [productData.price, productData.currency].filter(Boolean).join(" ")
    const taxStr = String(localTaxRate ?? 23)

    return {
      name: localTitle,
      tax_rate: taxStr + (isNaN(Number(taxStr)) ? '' : '%'),
      is_bundle: isBundle ? "Tak (zestaw)" : "Nie (podstawowy)",
      sku: editableFieldValues['sku'] || productData.sku || "",
      ean: editableFieldValues['ean'] || productData.ean || "",
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
        if (!session?.allegroCategory && !editProductId) errors.push('Wybierz kategorię Allegro')
        break
      case 'images': {
        const activeImages = imagesMeta.filter(m => !m.removed)
        if (activeImages.length === 0) errors.push('Dodaj co najmniej 1 zdjęcie')
        break
      }
      case 'fields-params':
        break
      case 'preview':
        break
    }
    return { valid: errors.length === 0, errors }
  }

  // E4: reset całego workflow dla tego produktu — kasuje snapshot na serwerze i czyści state UI.
  async function handleResetWorkflow() {
    setShowResetConfirm(false)
    try {
      const url = productKey
        ? `/api/product-session?productKey=${encodeURIComponent(productKey)}`
        : "/api/product-session"
      await fetch(url, { method: "DELETE" })
    } catch {/* non-fatal — i tak czyścimy state lokalny */}

    if (editProductId) clearEditProgress(editProductId)

    // Reset wszystkich relevantnych state-ów
    setSession(null)
    setLocalParameters({})
    setLocalTitle("")
    setIsTitleGenerated(false)
    setTitleCandidates([])
    setGeneratedDescription(undefined)
    setDescriptionSnapshot(undefined)
    setDescriptionVersions([])
    setVersionIndex(-1)
    setEditableFieldValues({})
    setExtraFieldValues({})
    setAiFillResults([])
    setAiFillStatus('idle')
    setShowChangeBanner(false)
    setChangeClassification({ severity: 'none', changes: [] })
    setValidationOverride(false)
    lastGeneratedKey.current = ''
    // Zdjęcia — odzyskaj z productData (BL/scrape source)
    if (productData?.images?.length) {
      setImagesMeta(productData.images.map((url, i) => ({
        url, order: i, removed: false, aiDescription: '',
        aiConfidence: 0, userDescription: '', isFeatureImage: false, features: [],
      })))
    } else {
      setImagesMeta([])
    }
    setCurrentStep(STEPS[0].key)
    setMaxVisitedStep(0)
    toast.success("Workflow zresetowany — możesz zacząć od nowa")
  }

  function goToStep(step: Step) {
    setCurrentStep(step)
    if (sheetProductId) {
      updateSession({ currentStep: step }).catch(() => {/* non-fatal */})
    }
  }

  function navigateToStep(targetIndex: number) {
    setValidationErrors([])
    // Going backwards — always allowed if visited before
    if (targetIndex <= currentStepIndex) {
      goToStep(STEPS[targetIndex].key)
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
    goToStep(STEPS[targetIndex].key)
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
            {/* URL produktu-wzorca (opcjonalne) — ukryj gdy dane już załadowane z URL */}
            {!productData.url && (
              <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Link2 className="size-3.5" />
                  Pobierz dane z URL (opcjonalne)
                </div>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={referenceUrl}
                    onChange={e => setReferenceUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleScrapeReferenceUrl()}
                    placeholder="https://allegro.pl/oferta/..."
                    className="flex-1 text-xs border border-border rounded px-2.5 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleScrapeReferenceUrl}
                    disabled={!referenceUrl.trim() || scrapeLoading}
                    className="text-xs h-auto py-1.5 px-3 shrink-0"
                  >
                    {scrapeLoading ? <Loader2 className="size-3.5 animate-spin" /> : 'Pobierz →'}
                  </Button>
                </div>
              </div>
            )}
            <CategorySelector onSelect={handleCategorySelect} onReset={handleCategoryReset} selectedCategory={session?.allegroCategory} productData={productData} productId={sheetProductId ?? editProductId} />
            {editProductId && !session?.allegroCategory && (
              <button
                onClick={() => goToStep('images')}
                className="text-sm text-blue-600 hover:underline mt-1 block"
              >
                Pomiń — produkt ma już kategorię w BaseLinker →
              </button>
            )}
          </div>
        )

      case "images":
        return (
          <div className="space-y-4">
            <ImageManagementStep
              images={productData.images}
              imagesMeta={imagesMeta}
              productId={sheetProductId ?? editProductId}
              allowUpload={session?.mode !== "edit"}
              onImagesMetaChange={(meta) => {
                setImagesMeta(meta)
                updateSession({ imagesMeta: meta })
              }}
            />
            <Button
              onClick={() => goToStep("fields-params")}
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
              onParameterValuesChange={handleParameterValuesChange}
              isTitleGenerated={isTitleGenerated}
              sheetMatchResults={sheetMatchResults.length > 0 ? sheetMatchResults : undefined}
              aiFillResults={aiFillResults.length > 0 ? aiFillResults : undefined}
              aiFillStatus={aiFillStatus}
              initialExtraFieldValues={extraFieldValues}
              onExtraFieldValuesChange={handleExtraFieldValuesChange}
              isBundle={isBundle}
              onIsBundleChange={handleIsBundleChange}
              bundleProducts={bundleProducts}
              onBundleProductsChange={handleBundleProductsChange}
              inventoryId={selectedInventoryId}
              taxRate={localTaxRate}
              onTaxRateChange={handleTaxRateChange}
              editableFieldValues={editableFieldValues}
              onEditableFieldValueChange={handleEditableFieldValueChange}
              manufacturers={(blCache?.manufacturers ?? []) as { manufacturer_id: number; name: string }[]}
              isEditMode={!!editProductId}
            />
            <Button onClick={() => goToStep("preview")} className="w-full gap-2">
              <Eye className="size-4" />
              Podgląd i opis →
            </Button>
          </div>
        )

      case "preview": {
        // Prompt editor full-screen modal (taking over preview step)
        if (promptOpen) {
          return (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Edytuj prompt generowania opisu</h3>
                <Button variant="ghost" size="sm" onClick={() => setPromptOpen(false)}>
                  <X className="size-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Prompt jest zapisywany w sesji produktu — zmiany zostają do zakończenia edycji.
              </p>
              <textarea
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                rows={20}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs font-mono outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/20 resize-y"
              />
              <div className="flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={handlePromptReset} className="text-muted-foreground">
                  Przywróć domyślny
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPromptOpen(false)}>
                    Anuluj
                  </Button>
                  <Button size="sm" onClick={handlePromptSave} className="gap-1.5">
                    <Check className="size-3.5" />
                    Zapisz
                  </Button>
                </div>
              </div>
            </div>
          )
        }

        const sections = generatedDescription?.sections ?? []
        const isTitleTargeted = targetedSections.some(s => s.id === 'title')
        const missingRequired = parameters.filter(p => p.required && !localParameters[p.id])

        return (
          <div className="space-y-4">
            {/* ═══ Banner: brakujące wymagane parametry ═══ */}
            {missingRequired.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <span>
                  Brakuje <strong>{missingRequired.length}</strong> wymaganych parametrów. Wróć do kroku &bdquo;Parametry&rdquo; lub poproś asystenta, żeby je uzupełnił.
                </span>
              </div>
            )}

            {/* ═══ Banner: wykryto zmiany od ostatniej generacji ═══ */}
            {showChangeBanner && changeClassification.severity !== 'none' && (
              <div className={cn(
                "flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border",
                changeClassification.severity === 'major'
                  ? 'border-amber-300 bg-amber-50 text-amber-800'
                  : 'border-blue-200 bg-blue-50 text-blue-700'
              )}>
                <div className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="size-4 shrink-0" />
                  <span>
                    {changeClassification.severity === 'major'
                      ? 'Wykryto istotne zmiany od ostatniej generacji — opis może być nieaktualny'
                      : 'Dane zmienione od ostatniej generacji'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowChangeBanner(false)}>
                    Ignoruj
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() => toast.info('Poproś asystenta: "wygeneruj opis od nowa"')}
                  >
                    <RefreshCw className="size-3" />
                    Jak regenerować?
                  </Button>
                </div>
              </div>
            )}

            {/* ═══ Toolbar: version nav + prompt editor ═══ */}
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-2">
                {descriptionVersions.length > 0 && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      onClick={() => navigateVersion(-1)}
                      disabled={versionIndex === 0}
                      title="Poprzednia wersja"
                    >
                      <ChevronLeft className="size-3.5" />
                    </Button>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <History className="size-3" />
                      {versionIndex === -1
                        ? `Live (${descriptionVersions.length} w historii)`
                        : `Wersja ${versionIndex + 1}/${descriptionVersions.length}`}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      onClick={() => navigateVersion(1)}
                      disabled={versionIndex === -1}
                      title="Następna wersja"
                    >
                      <ChevronRight className="size-3.5" />
                    </Button>
                  </>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 text-xs"
                onClick={() => setPromptOpen(true)}
              >
                <Settings className="size-3.5" />
                Prompt
              </Button>
            </div>

            {/* ═══ Tytuł (edytowalny) + candidates ═══ */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Tytuł aukcji
                </label>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-xs",
                    localTitle.length > 75 ? "text-destructive font-semibold" : "text-muted-foreground"
                  )}>
                    {localTitle.length}/75
                  </span>
                  <button
                    onClick={() => toggleTargetedSection({ id: 'title', label: 'Tytuł', type: 'title' })}
                    className={cn(
                      "flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border transition-colors",
                      isTitleTargeted
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    )}
                    title="Zaznacz żeby asystent edytował tylko tytuł"
                  >
                    <Target className="size-2.5" />
                    {isTitleTargeted ? 'Zaznaczono' : 'Zaznacz'}
                  </button>
                </div>
              </div>
              <input
                type="text"
                value={localTitle}
                onChange={(e) => {
                  setLocalTitle(e.target.value)
                  setIsTitleGenerated(true)
                }}
                onBlur={() => updateSession({ generatedTitle: localTitle }).catch(() => {/* non-fatal */})}
                className="w-full text-sm font-medium rounded-lg border border-input bg-background px-3 py-2 outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/20"
                placeholder="Tytuł aukcji (max 75 znaków)"
              />
              {titleCandidates.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-[10px] text-muted-foreground self-center mr-1">Kandydaci:</span>
                  {titleCandidates.map((cand, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setLocalTitle(cand)
                        setIsTitleGenerated(true)
                        updateSession({ generatedTitle: cand }).catch(() => {/* non-fatal */})
                      }}
                      className="text-xs px-2 py-1 rounded-full border border-border bg-background hover:border-primary/40 hover:bg-primary/5 transition-colors truncate max-w-full"
                      title={cand}
                    >
                      {cand.length > 50 ? cand.slice(0, 50) + '…' : cand}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ═══ Sekcje opisu — klikalne chipsy do targetingu ═══ */}
            {sections.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Sekcje opisu ({sections.length})
                  </label>
                  {targetedSections.length > 0 && (
                    <button
                      onClick={() => setTargetedSections([])}
                      className="text-[10px] text-muted-foreground hover:text-foreground underline"
                    >
                      Wyczyść zaznaczenie
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {sections.map((s) => {
                    const isTargeted = targetedSections.some(t => t.id === s.id)
                    return (
                      <button
                        key={s.id}
                        onClick={() => toggleTargetedSection({ id: s.id, label: s.heading || 'Sekcja', type: 'description-section' })}
                        className={cn(
                          "flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border transition-colors",
                          isTargeted
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:border-primary/40"
                        )}
                      >
                        <Target className="size-2.5" />
                        {s.heading || 'Bez tytułu'}
                      </button>
                    )
                  })}
                </div>
                {targetedSections.length > 0 && (
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <HelpCircle className="size-3" />
                    Zaznaczone sekcje trafią w prefix wiadomości do asystenta (&bdquo;[Dotyczy: …]&rdquo;).
                  </p>
                )}
              </div>
            )}

            {/* ═══ Podgląd marketplace ═══ */}
            {generatedDescription?.fullHtml ? (
              <>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs text-muted-foreground">
                    {generatedDescription.generatedAt
                      ? `Wygenerowano: ${new Date(generatedDescription.generatedAt).toLocaleString()}`
                      : 'Wygenerowany opis'}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={triggerRegeneration}
                    disabled={isGeneratingDesc}
                    className="gap-1.5"
                  >
                    <RefreshCw className="size-3.5" />
                    Generuj od nowa
                  </Button>
                </div>
                <PreviewContainer
                  title={localTitle}
                  fullHtml={generatedDescription.fullHtml}
                  imagesMeta={imagesMeta}
                  parameters={localParameters}
                  parameterDefs={session?.allegroParameters ?? []}
                  ean={editableFieldValues['ean'] || productData?.ean}
                  sku={editableFieldValues['sku'] || productData?.sku}
                  categoryPath={session?.allegroCategory?.path}
                  price={editableFieldValues['prices'] ? parseFloat(editableFieldValues['prices'].replace(',', '.')) : undefined}
                />
              </>
            ) : isGeneratingDesc ? (
              <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 px-4 py-12 text-center">
                <Loader2 className="size-8 mx-auto mb-3 animate-spin text-primary" />
                <p className="text-sm font-medium text-foreground">Generuję tytuł i opis…</p>
                <p className="text-xs text-muted-foreground mt-1">Trwa zazwyczaj 15-30 sekund. Używam kategorii, parametrów i analizy zdjęć.</p>
              </div>
            ) : generationError ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-6 text-sm text-destructive">
                <div className="flex items-start gap-2">
                  <AlertCircle className="size-5 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium">Nie udało się wygenerować opisu</p>
                    <p className="text-xs mt-1">{generationError}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={triggerRegeneration}
                    >
                      Spróbuj ponownie
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                <Loader2 className="size-6 mx-auto mb-2 animate-spin opacity-50" />
                Przygotowuję generowanie opisu…
              </div>
            )}

            <Button
              onClick={async () => {
                await updateSession({
                  data: {
                    ...productData,
                    title: localTitle,
                    description: generatedDescription?.fullHtml || productData.description,
                    images: imagesMeta.filter(i => !i.removed).map(i => i.url),
                  },
                })
                goToStep("approval")
              }}
              disabled={!generatedDescription?.fullHtml}
              className="w-full"
            >
              Zatwierdź i wyślij →
            </Button>
          </div>
        )
      }

      case "approval":
        return (
          <div className="space-y-4">
            {onSaveTemplate ? (
              // Template mode — save session instead of submitting
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Zapisz tę konfigurację jako template dla masowego wystawiania.
                </p>
                <Button
                  onClick={() => {
                    if (session) onSaveTemplate?.(session)
                  }}
                  className="w-full gap-2"
                  disabled={!session}
                >
                  <CheckCircle2 className="size-4" />
                  Zapisz jako template
                </Button>
              </div>
            ) : successId ? (
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

  // Agent action handler — maps agent SSE actions to BaselinkerWorkflowPanel state
  function handleAgentAction(action: ChatAction) {
    switch (action.type) {
      // ─── Parametry / tytuł ───
      case 'update_parameter':
        if (action.parameterId && action.parameterValue !== undefined) {
          handleParameterChangeFromChat(action.parameterId, action.parameterValue)
        }
        break
      case 'update_title':
        if (action.title) {
          setLocalTitle(action.title)
          setIsTitleGenerated(true)
          updateSession({ generatedTitle: action.title }).catch(() => {/* non-fatal */})
        }
        break

      // ─── Sekcje opisu ───
      case 'update_section':
      case 'expand_section':
        if (action.sectionId) handleChatSectionUpdate(action.sectionId, action.heading, action.bodyHtml)
        break
      case 'add_section':
        handleChatSectionAdd(
          { id: action.sectionId ?? `section-${Math.random().toString(36).slice(2, 10)}`, heading: action.heading ?? '', bodyHtml: action.bodyHtml ?? '', layout: action.layout ?? 'text-only', imageUrls: [] },
          action.afterSectionId
        )
        break
      case 'remove_section':
        if (action.sectionId) handleChatSectionRemove(action.sectionId)
        break
      case 'change_section_layout':
        if (action.sectionId && action.layout) handleChatSectionLayoutChange(action.sectionId, action.layout)
        break
      case 'reorder_sections':
        if (action.sectionIds?.length) handleChatSectionsReorder(action.sectionIds)
        break
      case 'reorder_section_images':
        if (action.sectionId && action.imageUrls) handleChatSectionImageReorder(action.sectionId, action.imageUrls)
        break
      case 'add_image_to_section':
        if (action.sectionId && action.imageUrl) handleChatSectionImageAdd(action.sectionId, action.imageUrl)
        break
      case 'remove_image_from_section':
        if (action.sectionId && action.imageUrl) handleChatSectionImageRemove(action.sectionId, action.imageUrl)
        break

      // ─── Regeneracje (AgentPanel wysłał już description_generated przed tą akcją, tu nic dodatkowego) ───
      case 'regenerate_description':
      case 'regenerate_title':
      case 'change_description_style':
        // description_generated / title_generated SSE already handled by AgentPanel callbacks
        break

      // ─── Scrape z URL ───
      case 'request_scrape':
        if (action.scrapeUrl) handleScrapeAndFillFromUrl(action.scrapeUrl)
        break

      // ─── Pola produktu ───
      case 'update_price':
        if (action.priceValue !== undefined && session?.data) {
          const nextData = { ...session.data, price: action.priceValue, currency: action.currencyValue ?? session.data.currency }
          updateSession({ data: nextData }).catch(() => {/* non-fatal */})
          toast.success(`Cena ustawiona: ${action.priceValue}${action.currencyValue ? ' ' + action.currencyValue : ''}`)
        }
        break
      case 'update_tax_rate':
        if (action.taxRateValue !== undefined) {
          setLocalTaxRate(action.taxRateValue)
          updateSession({ tax_rate: action.taxRateValue }).catch(() => {/* non-fatal */})
          toast.success(`VAT: ${action.taxRateValue}`)
        }
        break
      case 'update_sku':
        if (action.skuValue !== undefined && session?.data) {
          updateSession({ data: { ...session.data, sku: action.skuValue } }).catch(() => {/* non-fatal */})
          toast.success(`SKU: ${action.skuValue}`)
        }
        break
      case 'update_ean':
        if (action.eanValue !== undefined && session?.data) {
          updateSession({ data: { ...session.data, ean: action.eanValue } }).catch(() => {/* non-fatal */})
          toast.success(`EAN: ${action.eanValue}`)
        }
        break
      case 'update_inventory':
        if (action.inventoryId !== undefined) {
          setSelectedInventoryId(action.inventoryId)
          updateSession({ inventoryId: action.inventoryId }).catch(() => {/* non-fatal */})
        }
        if (action.warehouseId !== undefined) {
          setSelectedWarehouse(action.warehouseId)
          updateSession({ defaultWarehouse: action.warehouseId }).catch(() => {/* non-fatal */})
        }
        break

      // ─── Zdjęcia główne produktu ───
      case 'reorder_product_images':
        if (action.imageUrls?.length) {
          const urlOrder = new Map(action.imageUrls.map((u, i) => [u, i]))
          setImagesMeta(prev => {
            const next = [...prev].sort((a, b) => (urlOrder.get(a.url) ?? 999) - (urlOrder.get(b.url) ?? 999))
              .map((m, i) => ({ ...m, order: i }))
            updateSession({ imagesMeta: next }).catch(() => {/* non-fatal */})
            return next
          })
          toast.success('Kolejność zdjęć zmieniona')
        }
        break
      case 'add_product_image':
        if (action.imageUrl) {
          setImagesMeta(prev => {
            const next: ImageMeta[] = [...prev, {
              url: action.imageUrl!,
              order: prev.length,
              removed: false,
              aiDescription: '',
              aiConfidence: 0,
              userDescription: '',
              isFeatureImage: false,
              features: [],
            }]
            updateSession({ imagesMeta: next }).catch(() => {/* non-fatal */})
            return next
          })
          toast.success('Zdjęcie dodane')
        }
        break
      case 'remove_product_image':
        if (action.imageUrl) {
          setImagesMeta(prev => {
            const next = prev.map(m => m.url === action.imageUrl ? { ...m, removed: true } : m)
            updateSession({ imagesMeta: next }).catch(() => {/* non-fatal */})
            return next
          })
          toast.success('Zdjęcie usunięte')
        }
        break

      // ─── Targeting & ask ───
      case 'clear_targets':
        setTargetedSections([])
        break
      case 'ask_user':
        // AgentPanel renders the question in the chat stream (action is primarily informational here)
        // Nothing to do in panel state — question is already visible to user.
        break
    }
  }

  // Description generated callback (apply to UI + persist)
  // Używane przez auto-generate w Podglądzie i przez ręczne regeneracje.
  function handleAgentDescriptionGenerated(
    sections: DescriptionSection[],
    fullHtml: string,
    inputSnapshot?: DescriptionInputSnapshot,
  ) {
    // Push previous version before replacing (cofanie zmian)
    if (generatedDescription) {
      pushDescriptionVersion(generatedDescription, localTitle, 'Przed regeneracją')
    }
    // Snapshot z eventu agenta to source of truth — buduje go ta sama funkcja
    // co generateDescription, więc change-detection nie pokaże fałszywego "dane zmienione".
    const snapshot = inputSnapshot ?? buildInputSnapshot(
      localTitle,
      imagesMeta,
      localParameters,
      session?.allegroCategory?.id ?? '',
      productData.attributes,
    )
    const desc: GeneratedDescription = {
      sections,
      fullHtml,
      generatedAt: new Date().toISOString(),
      inputHash: '',
    }
    setGeneratedDescription(desc)
    setDescriptionSnapshot(snapshot)
    setChangeClassification({ severity: 'none', changes: [] })
    setShowChangeBanner(false)
    updateSession({ generatedDescription: desc, descriptionInputSnapshot: snapshot }).catch(() => {/* non-fatal */})
  }

  // ─── Auto-generate tytuł + opis przy wejściu na zakładkę Podgląd ───
  // Wywołuje 2 endpointy sekwencyjnie. Anti-loop guard po klucz: cat:imgCount:paramsCount.
  // AbortController żeby przerwać gdy user opuści Podgląd przed ukończeniem.
  useEffect(() => {
    if (currentStep !== 'preview') return
    if (!session?.allegroCategory?.id) {
      setGenerationError('Wybierz kategorię w zakładce „Kategoria" zanim wygenerujesz opis.')
      return
    }
    if (generatedDescription?.fullHtml) return // Już mamy opis — nie regeneruj automatycznie
    if (isGeneratingDesc) return

    // E6: walidacja braków przed odpaleniem generacji.
    const noParameters = Object.keys(localParameters).length === 0
    const imagesWithoutDesc = imagesMeta.filter(m => !m.removed && !(m.aiDescription || '').trim()).length
    const hasIssues = noParameters || imagesWithoutDesc > 0
    if (hasIssues && !validationOverride) {
      setShowValidationModal(true)
      return
    }

    const validImagesCount = imagesMeta.filter(m => !m.removed && (m.aiConfidence ?? 0) > 0).length
    const filledKeys = Object.keys(localParameters).length
    const key = `${session.allegroCategory.id}:${validImagesCount}:${filledKeys}:${localTitle.length}`
    if (lastGeneratedKey.current === key) return
    lastGeneratedKey.current = key

    const ac = new AbortController()
    generationAbortRef.current = ac

    ;(async () => {
      setIsGeneratingDesc(true)
      setGenerationError(null)
      try {
        const productId = sheetProductId ?? editProductId ?? 'local'
        const sessionForApi: ProductSession = {
          ...session,
          filledParameters: localParameters,
          generatedTitle: isTitleGenerated ? localTitle : undefined,
        }

        // 1. Tytuł — tylko jeśli jeszcze nie wygenerowany przez user/AI
        if (!isTitleGenerated || !localTitle?.trim()) {
          const titleRes = await fetch('/api/generate-title', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: ac.signal,
            body: JSON.stringify({ session: sessionForApi, imagesMeta, productId }),
          })
          if (!titleRes.ok) throw new Error(`Tytuł: HTTP ${titleRes.status}`)
          const titleData = await titleRes.json()
          if (titleData.title) {
            setLocalTitle(titleData.title)
            setIsTitleGenerated(true)
            setTitleCandidates(titleData.candidates ?? [])
            await updateSession({
              generatedTitle: titleData.title,
              titleCandidates: titleData.candidates ?? [],
            }).catch(() => {})
            sessionForApi.generatedTitle = titleData.title
          }
        }

        // 2. Opis
        const descRes = await fetch('/api/generate-description', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ac.signal,
          body: JSON.stringify({ session: sessionForApi, imagesMeta, productId }),
        })
        if (!descRes.ok) throw new Error(`Opis: HTTP ${descRes.status}`)
        const descData = await descRes.json()
        if (descData.error) throw new Error(descData.error)

        handleAgentDescriptionGenerated(descData.sections, descData.fullHtml, descData.inputSnapshot)
        if (descData.warning) toast.warning(descData.warning)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[auto-generate]', msg)
        setGenerationError(msg)
        toast.error(`Błąd generowania: ${msg}`)
      } finally {
        setIsGeneratingDesc(false)
        if (generationAbortRef.current === ac) generationAbortRef.current = null
      }
    })()

    return () => {
      ac.abort()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, session?.allegroCategory?.id, generatedDescription?.fullHtml, validationOverride])

  // Ręczna regeneracja opisu: abort + reset stanu → useEffect powyżej odpali ponownie.
  const triggerRegeneration = useCallback(() => {
    if (generationAbortRef.current) {
      generationAbortRef.current.abort()
      generationAbortRef.current = null
    }
    if (generatedDescription) {
      pushDescriptionVersion(generatedDescription, localTitle, 'Przed regeneracją')
    }
    lastGeneratedKey.current = ''
    setGenerationError(null)
    setIsGeneratingDesc(false)
    setGeneratedDescription(undefined)
    setValidationOverride(false) // user może zmienić uzupełnienie między regeneracjami
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatedDescription, localTitle])

  // ─── Navigate description versions (undo / redo) ───
  const navigateVersion = useCallback(
    (dir: -1 | 1) => {
      const total = descriptionVersions.length
      if (total === 0) return

      let newIdx: number
      if (versionIndex === -1) {
        if (dir === -1) newIdx = total - 1
        else return
      } else {
        newIdx = versionIndex + dir
        if (newIdx >= total) {
          setVersionIndex(-1)
          return
        }
        if (newIdx < 0) return
      }

      setVersionIndex(newIdx)
      const v = descriptionVersions[newIdx]
      if (v) {
        setLocalTitle(v.title)
        setIsTitleGenerated(true)
        const desc: GeneratedDescription = {
          sections: v.sections,
          fullHtml: v.fullHtml,
          generatedAt: v.timestamp,
          inputHash: '',
        }
        setGeneratedDescription(desc)
        updateSession({ generatedTitle: v.title, generatedDescription: desc }).catch(() => {/* non-fatal */})
      }
    },
    [descriptionVersions, versionIndex],
  )

  // ─── Prompt editor (persisted in ProductSession.descriptionPrompt) ───
  const handlePromptSave = useCallback(() => {
    updateSession({ descriptionPrompt: promptText }).catch(() => {/* non-fatal */})
    setPromptOpen(false)
    toast.success('Prompt zapisany w sesji')
  }, [promptText])

  const handlePromptReset = useCallback(() => {
    setPromptText(DEFAULT_DESCRIPTION_PROMPT)
    updateSession({ descriptionPrompt: DEFAULT_DESCRIPTION_PROMPT }).catch(() => {/* non-fatal */})
  }, [])

  // ─── Change detection (re-run when inputs change after description generated) ───
  useEffect(() => {
    if (!generatedDescription || !descriptionSnapshot) {
      setChangeClassification({ severity: 'none', changes: [] })
      setShowChangeBanner(false)
      return
    }
    const currentSnapshot = buildInputSnapshot(
      localTitle,
      imagesMeta,
      localParameters,
      session?.allegroCategory?.id ?? '',
      productData.attributes,
    )
    const classification = classifyChangesDetailed(descriptionSnapshot, currentSnapshot)
    setChangeClassification(classification)
    setShowChangeBanner(classification.severity !== 'none')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localTitle, imagesMeta, localParameters, session?.allegroCategory?.id, generatedDescription])

  // ─── Scrape & auto-fill from URL (migrated from ClaudeChat.handleScrapeAndFill) ───
  const handleScrapeAndFillFromUrl = useCallback(
    async (url: string) => {
      toast.info(`Pobieram dane z ${url.slice(0, 40)}...`)
      try {
        const scrapeRes = await fetch('/api/scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        })
        const scrapeData = await scrapeRes.json()
        if (!scrapeData.success) {
          toast.error(`Nie udało się zescrapować strony: ${scrapeData.error ?? 'nieznany błąd'}`)
          return
        }
        const unfilledParams = (parameters ?? []).filter(p => !localParameters?.[p.id])
        if (unfilledParams.length === 0) {
          toast.info('Wszystkie parametry już wypełnione')
          return
        }
        // Reuse the same /api/ai-autofill endpoint that initial workflow uses (via BL bootstrap flow).
        // This endpoint is the last solo AI route still in use after cleanup — powered by lib/ai-autofill.
        const fillRes = await fetch('/api/ai-autofill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productData: scrapeData.data,
            parameters: unfilledParams,
            alreadyFilled: localParameters ?? {},
          }),
        })
        const fillData = await fillRes.json()
        if (fillData.error) {
          toast.error(`Błąd auto-fill: ${fillData.error}`)
          return
        }
        const filled: Record<string, string | string[]> = fillData.filled ?? {}
        if (Object.keys(filled).length === 0) {
          toast.info('Pobrano dane, ale nie dopasowano żadnych parametrów')
          return
        }
        setLocalParameters(prev => {
          const merged = { ...prev, ...filled }
          updateSession({ filledParameters: merged }).catch(() => {/* non-fatal */})
          return merged
        })
        toast.success(`Auto-fill: dopasowano ${Object.keys(filled).length} parametrów`)
      } catch (err) {
        toast.error(`Błąd scrape: ${err instanceof Error ? err.message : 'nieznany'}`)
      }
    },
    [parameters, localParameters],
  )

  return (
    <>
      <div>
        {/* Workflow content (pełna szerokość — agent SDK chat usunięty) */}
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
            <div className="flex items-center gap-2">
              <TokenCostBadge productId={sheetProductId ?? editProductId ?? 'local'} />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowResetConfirm(true)}
                className="gap-1.5 text-xs text-muted-foreground hover:text-destructive"
                title="Skasuj cały dotychczasowy progres dla tego produktu"
              >
                <RefreshCw className="size-3.5" />
                Zacznij od nowa
              </Button>
              <button
                onClick={onClose}
                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* Step navigation */}
          <div className="flex border-b overflow-x-auto scrollbar-hide">
            {STEPS.map((step, i) => {
              const isDone = i < currentStepIndex
              const isActive = step.key === currentStep
              const isClickable = i <= maxVisitedStep || i === maxVisitedStep + 1
              const label = (step.key === 'approval' && onSaveTemplate) ? 'Zapisz template' : step.label

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
                      : "text-muted-foreground/60 cursor-default"
                  )}
                >
                  {isDone ? <CheckCircle2 className="size-3.5 text-green-600 shrink-0" /> : step.icon}
                  <span>{label}</span>
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
          </div>
        </div>

      </div>

      {showApproval && session && (
        <ApprovalDrawer
          session={session}
          onClose={() => setShowApproval(false)}
          onApproved={async (id) => {
            setSuccessId(id)
            setShowApproval(false)
            goToStep("approval")

            if (onSubmitSuccess && session) {
              onSubmitSuccess(session)
            }

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

      {/* E6: Modal walidacji przed generacją opisu */}
      <Dialog.Root open={showValidationModal} onOpenChange={setShowValidationModal}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 shadow-xl">
            <Dialog.Title className="text-base font-semibold">Wykryto braki przed generacją opisu</Dialog.Title>
            <Dialog.Description className="mt-1.5 text-sm text-muted-foreground">
              Bez tych danych opis może być niskiej jakości. Możesz wrócić i uzupełnić, albo wygenerować mimo to.
            </Dialog.Description>

            <ul className="mt-4 space-y-1.5 text-sm">
              {!session?.allegroCategory?.id && (
                <li className="flex items-start gap-2 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                  Brak wybranej kategorii Allegro
                </li>
              )}
              {Object.keys(localParameters).length === 0 && (
                <li className="flex items-start gap-2 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                  Brak uzupełnionych parametrów
                </li>
              )}
              {(() => {
                const missing = imagesMeta.filter(m => !m.removed && !(m.aiDescription || '').trim()).length
                return missing > 0 ? (
                  <li className="flex items-start gap-2 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                    {missing} {missing === 1 ? 'zdjęcie nie ma' : missing < 5 ? 'zdjęcia nie mają' : 'zdjęć nie ma'} opisu AI
                  </li>
                ) : null
              })()}
            </ul>

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowValidationModal(false)
                  // Wróć do pierwszego brakującego kroku
                  if (!session?.allegroCategory?.id) goToStep('category')
                  else if (Object.keys(localParameters).length === 0) goToStep('fields-params')
                  else goToStep('images')
                }}
              >
                Wróć i uzupełnij
              </Button>
              <Button
                onClick={() => {
                  setValidationOverride(true)
                  setShowValidationModal(false)
                }}
              >
                Generuj mimo to
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* E4: Modal "Zacznij od nowa" — confirmation kasująca snapshot */}
      <Dialog.Root open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 shadow-xl">
            <Dialog.Title className="text-base font-semibold">Zacząć od nowa?</Dialog.Title>
            <Dialog.Description className="mt-1.5 text-sm text-muted-foreground">
              Skasuje cały dotychczasowy progres dla tego produktu — kategorię, parametry, wygenerowany tytuł i opis, opisy zdjęć. Zdjęcia źródłowe wracają do oryginalnych z BL / scrape.
            </Dialog.Description>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setShowResetConfirm(false)}>Anuluj</Button>
              <Button variant="destructive" onClick={handleResetWorkflow}>Tak, zacznij od nowa</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
