"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Settings2, Tag, CheckSquare, Eye, Send, RefreshCw, Loader2, Sparkles, X, CheckCircle2, ImageIcon, AlertCircle, Link2 } from "lucide-react"
import { CategorySelector } from "./CategorySelector"
import { FieldsAndParametersStep } from "./FieldsAndParametersStep"
import { ApprovalDrawer } from "./ApprovalDrawer"
import { PreviewContainer } from "./previews/PreviewContainer"
import { ImageManagementStep } from "./ImageManagementStep"
import { DescriptionGenerationStep } from "./DescriptionGenerationStep"
import { ClaudeChat } from "./ClaudeChat"
import { AgentPanel } from "./AgentPanel"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { compileSectionsToHtml } from "@/lib/description-utils"
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
  /** When provided: last step becomes "Zapisz jako template" instead of "Wyślij" */
  onSaveTemplate?: (session: ProductSession) => void
  /** Called after successful BaseLinker submission — receives the completed session */
  onSubmitSuccess?: (session: ProductSession) => void
  /** Reference product description for context (scraped from a reference URL) */
  referenceDescription?: string
}

type Step = "inventory" | "category" | "images" | "fields-params" | "preview" | "approval"

const STEPS: { key: Step; label: string; icon: React.ReactNode }[] = [
  { key: "inventory", label: "Magazyn", icon: <Settings2 className="size-3.5" /> },
  { key: "category", label: "Kategoria", icon: <Tag className="size-3.5" /> },
  { key: "images", label: "Zdjęcia", icon: <ImageIcon className="size-3.5" /> },
  { key: "fields-params", label: "Parametry", icon: <CheckSquare className="size-3.5" /> },
  { key: "preview", label: "Podgląd", icon: <Eye className="size-3.5" /> },
  { key: "approval", label: "Wyślij", icon: <Send className="size-3.5" /> },
]

// Dynamic label helper — used in render
function getApprovalLabel(onSaveTemplate?: (session: ProductSession) => void): string {
  return onSaveTemplate ? "Zapisz template" : "Wyślij"
}

export function BaselinkerWorkflowPanel({ productData, editProductId, editProductType, editParentId, onClose, sheetProductId, sheetMeta, onSheetDone, onSaveTemplate, onSubmitSuccess, referenceDescription }: Props) {
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
  const [isTitleGenerated, setIsTitleGenerated] = useState(false)
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
    fetch("/api/product-session")
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
          if (d.session.extraFieldValues) setExtraFieldValues(d.session.extraFieldValues)
          if (d.session.editableFieldValues) setEditableFieldValues(d.session.editableFieldValues)
          if (d.session.tax_rate != null) setLocalTaxRate(d.session.tax_rate)
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

  async function updateSession(patch: Partial<ProductSession>) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      const res = await fetch("/api/product-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
        signal: controller.signal,
      })
      const data = await res.json()
      setSession(data.session)
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
            <CategorySelector onSelect={handleCategorySelect} onReset={handleCategoryReset} selectedCategory={session?.allegroCategory} productData={productData} />
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

      case "preview":
        return (
          <div className="space-y-4">
            <DescriptionGenerationStep
              title={localTitle}
              translatedData={{
                title: productData.title,
                attributes: productData.attributes,
              }}
              imagesMeta={imagesMeta}
              filledParameters={localParameters}
              categoryPath={session?.allegroCategory?.path || ""}
              categoryId={session?.allegroCategory?.id || ""}
              descriptionPrompt={session?.descriptionPrompt}
              allegroParameters={parameters}
              sheetMeta={sheetMeta}
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
                setIsTitleGenerated(true)
                updateSession({ generatedTitle: title })
              }}
              onCandidatesChange={setTitleCandidates}
              onParameterChange={handleParameterChangeFromChat}
              targetedSections={targetedSections}
              onSectionTargetToggle={toggleTargetedSection}
              bundleContext={productData.bundleContextText}
              referenceDescription={referenceDescription}
              originalDescription={productData.description}
              price={productData.price}
              currency={productData.currency}
              ean={productData.ean}
              sku={productData.sku}
              productUrl={productData.url}
              previewSlot={
                generatedDescription?.fullHtml ? (
                  <PreviewContainer
                    title={localTitle}
                    fullHtml={generatedDescription.fullHtml}
                    imagesMeta={imagesMeta}
                    parameters={localParameters}
                    parameterDefs={session?.allegroParameters ?? []}
                  />
                ) : null
              }
            />

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
              className="w-full"
            >
              Zatwierdź i wyślij →
            </Button>
          </div>
        )

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
      case 'update_section':
        handleChatSectionUpdate(action.sectionId!, action.heading, action.bodyHtml)
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
    }
  }

  // Agent: description generated callback
  function handleAgentDescriptionGenerated(sections: DescriptionSection[], fullHtml: string) {
    const desc: GeneratedDescription = {
      sections,
      fullHtml,
      generatedAt: new Date().toISOString(),
      inputHash: '',
    }
    setGeneratedDescription(desc)
    updateSession({ generatedDescription: desc }).catch(() => {/* non-fatal */})
  }

  return (
    <>
      <div className={`grid ${currentStep === 'preview' ? 'grid-cols-[1fr_420px_360px]' : 'grid-cols-[1fr_360px]'} gap-5`}>
        {/* Lewa kolumna: workflow */}
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

        {/* Prawa kolumna: sticky AI Chat — tylko na podglądzie */}
        {currentStep === 'preview' && (
          <div className="sticky top-[4.5rem] self-start" style={{ height: 'calc(100vh - 5rem)' }}>
            <ClaudeChat
              currentTitle={localTitle}
              sections={generatedDescription?.sections || []}
              currentParameters={localParameters}
              imagesMeta={imagesMeta}
              allegroParameters={parameters}
              onTitleChange={(t) => {
                setLocalTitle(t)
                updateSession({ generatedTitle: t })
              }}
              onParameterChange={handleParameterChangeFromChat}
              onSectionUpdate={handleChatSectionUpdate}
              onSectionImageReorder={handleChatSectionImageReorder}
              onSectionRemove={handleChatSectionRemove}
              onSectionAdd={handleChatSectionAdd}
              onSectionLayoutChange={handleChatSectionLayoutChange}
              onSectionsReorder={handleChatSectionsReorder}
              onSectionImageAdd={handleChatSectionImageAdd}
              onSectionImageRemove={handleChatSectionImageRemove}
              autoAskUnfilled={
                !!(parameters?.some(p =>
                  p.required && !localParameters[p.id]
                ))
              }
              productData={{
                title: productData.title,
                description: productData.description,
                attributes: productData.attributes,
              }}
              originalDescription={productData.description}
              price={productData.price}
              currency={productData.currency}
              ean={productData.ean}
              sku={productData.sku}
              productUrl={productData.url}
              targetedSections={targetedSections}
              onRemoveTargetedSection={(id) => setTargetedSections(prev => prev.filter(s => s.id !== id))}
              onClearTargets={() => setTargetedSections([])}
              stanTechniczny={sheetMeta?.stanTechniczny}
              uwagi={[sheetMeta?.uwagiKrotkie, sheetMeta?.uwagiMagazynowe].filter(Boolean).join(' | ')}
              className="flex flex-col h-full"
              style={{ height: '100%' }}
            />
          </div>
        )}

        {/* Agent panel — persistent right sidebar across all steps */}
        <div className="sticky top-[4.5rem] self-start" style={{ height: 'calc(100vh - 5rem)' }}>
          <AgentPanel
            session={session}
            imagesMeta={imagesMeta}
            productId={sheetProductId ?? editProductId ?? 'local'}
            onSessionPatch={(patch) => {
              updateSession(patch).catch(() => {/* non-fatal */})
            }}
            onImagesAnalyzed={(meta) => {
              setImagesMeta(meta)
              updateSession({ imagesMeta: meta }).catch(() => {/* non-fatal */})
            }}
            onTitleGenerated={(title, candidates) => {
              setLocalTitle(title)
              setIsTitleGenerated(true)
              setTitleCandidates(candidates)
              updateSession({ generatedTitle: title, titleCandidates: candidates }).catch(() => {/* non-fatal */})
            }}
            onDescriptionGenerated={handleAgentDescriptionGenerated}
            onAction={handleAgentAction}
            className="h-full rounded-xl ring-1 ring-foreground/10 overflow-hidden"
          />
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
    </>
  )
}
