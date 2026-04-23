"use client"

import { useState, useRef, useCallback } from "react"
import { Store, Trash2, Loader2, CheckCircle2, XCircle, Clock, ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { useSellerScraperStore, type SellerScraperStep } from "@/lib/stores/seller-scraper-store"
import { SellerProductGrid } from "@/components/seller/SellerProductGrid"
import { GroupingView } from "@/components/seller/GroupingView"
import { DiffFieldsStep } from "@/components/seller/DiffFieldsStep"
import { DescriptionTemplateStep } from "@/components/seller/DescriptionTemplateStep"
import { BatchReviewStep } from "@/components/seller/BatchReviewStep"
import { BaselinkerWorkflowPanel } from "@/components/BaselinkerWorkflowPanel"
import { detectDiffFields, templatizeDescription, generateTitleTemplate } from "@/lib/batch-session"
import type { ProductData, SellerScrapeSession, ProductSession, GeneratedDescription } from "@/lib/types"

interface Props {
  onNavigateToMassListing: () => void
}

// ─── Main Component ───
export function SellerScraperTab({ onNavigateToMassListing }: Props) {
  const store = useSellerScraperStore()
  const [urlInput, setUrlInput] = useState('')
  const [isScrapingUrl, setIsScrapingUrl] = useState(false)
  const [isScrapingRef, setIsScrapingRef] = useState(false)
  const [sessions, setSessions] = useState<SellerScrapeSession[]>([])
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [deepScrapeQueue, setDeepScrapeQueue] = useState<string[]>([])
  const [deepScrapeProgress, setDeepScrapeProgress] = useState(0)
  const [isDeepScraping, setIsDeepScraping] = useState(false)
  const [descTemplatePlaceholders, setDescTemplatePlaceholders] = useState<string[]>([])
  const [currentTemplateSession, setCurrentTemplateSession] = useState<ProductSession | null>(null)
  const [descriptionTemplate, setDescriptionTemplate] = useState<GeneratedDescription | null>(null)
  const [titleTemplate, setTitleTemplate] = useState<string | null>(null)
  const abortRef = useRef(false)

  // Load sessions on first open
  const loadSessions = useCallback(async () => {
    if (sessionsLoaded) return
    try {
      const res = await fetch('/api/seller-scrape')
      const data = await res.json()
      setSessions(data.sessions ?? [])
      setSessionsLoaded(true)
    } catch { /* ignore */ }
  }, [sessionsLoaded])

  // ─── Start scraping ───
  const handleStartScrape = async () => {
    if (!urlInput.trim()) return
    setIsScrapingUrl(true)
    store.reset()
    abortRef.current = false
    try {
      const res = await fetch('/api/seller-scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sellerUrl: urlInput.trim() }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        toast.error(data.error ?? 'Błąd scrape')
        return
      }
      store.setSession(data.session, data.sessionId)
      store.setListings(data.listings ?? [])
      store.setTotalPages(data.totalPages ?? 1)
      store.setCurrentPage(1)
      store.setStep('scraping')

      // Auto-paginate if more pages
      if (data.totalPages > 1) {
        await paginateScrape(data.sessionId, data.session.sellerUrl, 2, data.totalPages)
      } else {
        store.setStep('grid')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Błąd scrape')
    } finally {
      setIsScrapingUrl(false)
    }
  }

  // ─── Scrape reference product URL ───
  const handleScrapeReferenceUrl = async () => {
    if (!store.referenceProductUrl.trim()) return
    setIsScrapingRef(true)
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: store.referenceProductUrl.trim() }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error ?? 'Błąd scrapowania')
      const desc = data.data?.description ?? ''
      store.setReferenceProductDescription(desc)
      toast.success('Pobrano opis referencyjny')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Błąd scrapowania URL')
    } finally {
      setIsScrapingRef(false)
    }
  }

  // ─── Paginate scraping ───
  const paginateScrape = async (sessionId: string, sellerUrl: string, startPage: number, totalPages: number) => {
    for (let page = startPage; page <= totalPages; page++) {
      if (abortRef.current) break
      store.setCurrentPage(page)
      try {
        const res = await fetch(`/api/seller-scrape/${sessionId}/scrape-page`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page }),
        })
        const data = await res.json()
        if (data.products) {
          store.addListings(data.products.map((p: { url: string; externalId?: string; title: string; thumbnailUrl?: string; price?: string; currency?: string }) => ({
            id: crypto.randomUUID(),
            sessionId,
            productUrl: p.url,
            productIdExt: p.externalId,
            title: p.title,
            thumbnailUrl: p.thumbnailUrl,
            price: p.price,
            currency: p.currency ?? 'PLN',
            pageNumber: page,
            selected: false,
            deepScraped: false,
          })))
        }
        if (!data.hasMore) break
        await new Promise(r => setTimeout(r, 1500))
      } catch {
        break
      }
    }
    store.setStep('grid')
  }

  // ─── Deep scrape selected ───
  const handleDeepScrape = async () => {
    const selected = store.listings.filter(l => l.selected)
    if (selected.length === 0) return
    store.setStep('deep-scrape')
    setDeepScrapeProgress(0)
    setIsDeepScraping(true)
    abortRef.current = false

    const queue = selected.map(l => l.id)
    setDeepScrapeQueue([...queue])

    for (let i = 0; i < queue.length; i++) {
      if (abortRef.current) break
      const listingId = queue[i]
      try {
        const res = await fetch(`/api/seller-scrape/${store.sessionId}/deep-scrape`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listingId }),
        })
        const data = await res.json()
        store.updateListing(listingId, {
          deepScraped: true,
          deepScrapeData: data.data,
          deepScrapeError: data.error,
        })
      } catch (err) {
        store.updateListing(listingId, {
          deepScraped: true,
          deepScrapeError: err instanceof Error ? err.message : 'Błąd',
        })
      }
      setDeepScrapeProgress(i + 1)
      if (i < queue.length - 1) await new Promise(r => setTimeout(r, 1500))
    }

    setIsDeepScraping(false)

    // Po deep-scrape przechodzimy do grupowania — grupy tworzy user ręcznie (drag&drop w GroupingView).
    store.setStep('grouping')
  }

  // ─── Group selected to list ───
  const handleListGroup = useCallback((groupName: string) => {
    store.setActiveGroup(groupName)
    // Get listings in this group
    const groupListingIds = store.groups[groupName] ?? []
    const groupListings = store.listings.filter(l => groupListingIds.includes(l.id) && l.deepScrapeData)
    const products = groupListings.map(l => l.deepScrapeData!).filter(Boolean) as ProductData[]

    if (products.length === 0) {
      toast.error('Brak produktów z danymi w tej grupie')
      return
    }

    // Detect diff fields
    const fields = detectDiffFields(products)
    store.setDiffFields(fields)
    store.setStep('diff-fields')
  }, [store])

  // ─── Save template from BL workflow ───
  const handleSaveTemplate = useCallback((session: ProductSession) => {
    setCurrentTemplateSession(session)
    store.setTemplateSession(session)

    // Generate title template
    const groupListingIds = store.activeGroup ? (store.groups[store.activeGroup] ?? []) : []
    const groupListings = store.listings.filter(l => groupListingIds.includes(l.id) && l.deepScrapeData)
    if (groupListings.length > 0) {
      const firstProduct = groupListings[0].deepScrapeData!
      const titleTpl = generateTitleTemplate(session.data.title, firstProduct.attributes ?? {}, store.selectedDiffFields)
      setTitleTemplate(titleTpl !== session.data.title ? titleTpl : null)
    }

    // If description exists, templatize it
    if (session.generatedDescription) {
      const firstProduct = groupListings[0]?.deepScrapeData
      if (firstProduct) {
        const { templated, placeholders } = templatizeDescription(
          session.generatedDescription,
          firstProduct.attributes ?? {},
          store.selectedDiffFields
        )
        setDescriptionTemplate(templated)
        setDescTemplatePlaceholders(placeholders)
      }
    }

    store.setStep('desc-template')
  }, [store])

  // ─── Submit batch ───
  const handleBatchSubmit = async (batchType: 'independent' | 'variants') => {
    const groupName = store.activeGroup ?? ''
    const groupListingIds = store.groups[groupName] ?? []
    const groupListings = store.listings.filter(l => groupListingIds.includes(l.id) && l.deepScraped && !l.deepScrapeError)

    if (groupListings.length === 0) {
      toast.error('Brak gotowych produktów')
      return
    }

    const session = store.templateSession
    if (!session) {
      toast.error('Brak template sesji')
      return
    }

    // AI fallback: if any item is missing attributes for selected attr: diff fields, extract from title
    const attrDiffFields = store.selectedDiffFields.filter(f => f.startsWith('attr:'))
    if (attrDiffFields.length > 0) {
      const missingAttrListings = groupListings.filter(l => {
        const attrs = l.deepScrapeData?.attributes ?? {}
        return attrDiffFields.some(f => {
          const attrName = f.replace('attr:', '')
          return !Object.keys(attrs).some(k => k.toLowerCase() === attrName.toLowerCase())
        })
      })

      if (missingAttrListings.length > 0) {
        try {
          const extractRes = await fetch('/api/ai-extract-variants', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              products: missingAttrListings.map(l => ({ id: l.id, name: l.title })),
              diffFields: attrDiffFields,
              templateTitle: session.data?.title,
            }),
          })
          if (extractRes.ok) {
            const { extractions } = await extractRes.json() as { extractions: Array<{ productId: string; values: Record<string, string> }> }
            const extractionMap = new Map(extractions.map(e => [e.productId, e.values]))
            for (const l of missingAttrListings) {
              const extracted = extractionMap.get(l.id)
              if (extracted && l.deepScrapeData) {
                l.deepScrapeData.attributes = { ...l.deepScrapeData.attributes, ...extracted }
              }
            }
          }
        } catch {
          // Non-fatal — proceed without AI-extracted attributes
        }
      }
    }

    const items = groupListings.map(l => ({
      productData: l.deepScrapeData,
      label: l.title,
      thumbnailUrl: l.thumbnailUrl,
      sourceListingId: l.id,
    }))

    const res = await fetch('/api/batch-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: `${groupName} — ${store.session?.sellerUsername} (${items.length} szt.)`,
        source: 'seller-scraper',
        sourceId: store.sessionId,
        batchType,
        templateSession: session,
        diffFields: store.selectedDiffFields,
        descriptionTemplate: descriptionTemplate,
        titleTemplate,
        items,
      }),
    })

    const data = await res.json()
    if (!res.ok || data.error) {
      toast.error(data.error ?? 'Błąd tworzenia batcha')
      return
    }

    // Resume job
    await fetch(`/api/batch-jobs/${data.jobId}/resume`, { method: 'POST' })
    toast.success(`Batch job stworzony — ${items.length} produktów`)
    onNavigateToMassListing()
  }

  // ─── Load sessions on input step ───
  if (store.step === 'input' && !sessionsLoaded) {
    loadSessions()
  }

  // ─── Render current step ───

  // Template step — full-screen
  if (store.step === 'template') {
    const groupListingIds = store.activeGroup ? (store.groups[store.activeGroup] ?? []) : []
    const groupListings = store.listings.filter(l => groupListingIds.includes(l.id) && l.deepScrapeData)
    const firstProduct = groupListings[0]?.deepScrapeData

    if (!firstProduct) {
      store.setStep('grouping')
      return null
    }

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => store.setStep('diff-fields')}>
            <ChevronLeft className="size-4 mr-1" /> Powrót
          </Button>
          <h3 className="font-semibold">Konfiguruj template: {store.activeGroup}</h3>
        </div>
        <BaselinkerWorkflowPanel
          productData={firstProduct}
          onClose={() => store.setStep('diff-fields')}
          onSaveTemplate={handleSaveTemplate}
          referenceDescription={store.referenceProductDescription || undefined}
        />
      </div>
    )
  }

  // AIChatSidebar zostal usuniety (wszystkie flow AI idą teraz przez Agent SDK w BaselinkerWorkflowPanel).
  // Render scraper na pełnej szerokości.
  const groupListingIds = store.activeGroup ? (store.groups[store.activeGroup] ?? []) : []
  const activeGroupListings = store.listings.filter(l => groupListingIds.includes(l.id))

  return (
    <div className="space-y-4">
      {/* Main content */}
      <div className="space-y-4">
        {/* Back button */}
        {store.step !== 'input' && (
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const prevSteps: Record<string, string> = {
                  scraping: 'input', grid: 'input', 'deep-scrape': 'grid',
                  grouping: 'grid', 'diff-fields': 'grouping', template: 'diff-fields',
                  'desc-template': 'template', review: 'desc-template',
                }
                store.setStep((prevSteps[store.step] ?? 'input') as SellerScraperStep)
              }}
            >
              <ChevronLeft className="size-4 mr-1" /> Powrót
            </Button>
            <span className="text-sm text-muted-foreground">
              {store.session?.sellerUsername} · {store.listings.length} produktów
            </span>
          </div>
        )}

        {/* STEP: input */}
        {store.step === 'input' && (
          <div className="space-y-6 max-w-xl">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Store className="size-5" /> Scrapuj listing sprzedawcy
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Podaj URL strony sprzedawcy (Allegro, OLX i inne)
              </p>
            </div>

            <div className="flex gap-2">
              <input
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleStartScrape() }}
                placeholder="https://allegro.pl/uzytkownik/NazwaSprzedawcy lub inny URL listy produktów"
                className="flex-1 border border-border rounded-lg px-3 py-2 text-sm bg-background"
              />
              <Button onClick={handleStartScrape} disabled={isScrapingUrl || !urlInput.trim()}>
                {isScrapingUrl ? <Loader2 className="size-4 animate-spin" /> : 'Scrapuj'}
              </Button>
            </div>

            {/* Reference product URL */}
            <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-2">
              <div>
                <p className="text-sm font-medium">Referencyjny produkt (opcjonalnie)</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Wklej URL produktu, którego opis posłuży jako wzorzec stylu dla AI.
                  Np. dobrze opisany peszel z Allegro → AI wygeneruje opisy w podobnym stylu.
                </p>
              </div>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={store.referenceProductUrl}
                  onChange={e => store.setReferenceProductUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleScrapeReferenceUrl()}
                  placeholder="https://allegro.pl/oferta/..."
                  className="flex-1 border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <Button
                  variant="outline"
                  onClick={handleScrapeReferenceUrl}
                  disabled={!store.referenceProductUrl.trim() || isScrapingRef}
                >
                  {isScrapingRef ? <Loader2 className="size-4 animate-spin" /> : 'Pobierz opis'}
                </Button>
              </div>
              {store.referenceProductDescription && (
                <div className="rounded-md bg-green-50 border border-green-200 px-3 py-2">
                  <p className="text-xs text-green-700 font-medium">✓ Opis referencyjny pobrany ({store.referenceProductDescription.length} znaków)</p>
                  <p className="text-xs text-green-600 mt-0.5 line-clamp-2">{store.referenceProductDescription.slice(0, 200)}...</p>
                </div>
              )}
            </div>

            {/* Session history */}
            {sessions.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Historia sesji</h4>
                <div className="space-y-1.5">
                  {sessions.map(s => (
                    <div key={s.id} className="flex items-center gap-3 p-2.5 border border-border rounded-lg hover:bg-muted/30">
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium">{s.sellerUsername}</span>
                        <span className="text-xs text-muted-foreground ml-2">{s.totalProducts} produktów</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          const res = await fetch(`/api/seller-scrape/${s.id}`)
                          const data = await res.json()
                          store.setSession(data.session, s.id)
                          store.setListings(data.listings ?? [])
                          store.setStep('grid')
                        }}
                      >
                        Wznów
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive"
                        onClick={async () => {
                          await fetch(`/api/seller-scrape/${s.id}`, { method: 'DELETE' })
                          setSessions(prev => prev.filter(x => x.id !== s.id))
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP: scraping */}
        {store.step === 'scraping' && (
          <div className="space-y-4 max-w-xl">
            <h3 className="font-semibold">Scrapowanie: {store.session?.sellerUsername}</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Strona {store.currentPage} / {store.totalPages || '?'}</span>
                <span>{store.listings.length} produktów</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: store.totalPages > 0 ? `${(store.currentPage / store.totalPages) * 100}%` : '10%' }}
                />
              </div>
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {store.listings.slice(-10).map(l => (
                <div key={l.id} className="text-xs text-muted-foreground">• {l.title}</div>
              ))}
            </div>
          </div>
        )}

        {/* STEP: grid */}
        {store.step === 'grid' && (
          <SellerProductGrid
            listings={store.listings}
            onToggle={store.toggleSelected}
            onSelectAll={store.selectAll}
            onNext={handleDeepScrape}
          />
        )}

        {/* STEP: deep-scrape */}
        {store.step === 'deep-scrape' && (
          <div className="space-y-4 max-w-xl">
            <div>
              <h3 className="font-semibold">Deep scrape</h3>
              <div className="flex items-center justify-between text-sm mt-1">
                <span>{deepScrapeProgress} / {deepScrapeQueue.length}</span>
                <span className="text-muted-foreground">{isDeepScraping ? 'W toku...' : 'Gotowe'}</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden mt-2">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: deepScrapeQueue.length > 0 ? `${(deepScrapeProgress / deepScrapeQueue.length) * 100}%` : '0%' }}
                />
              </div>
            </div>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {store.listings.filter(l => l.selected).map(l => (
                <div key={l.id} className="flex items-center gap-2 text-sm">
                  {l.deepScraped ? (
                    l.deepScrapeError
                      ? <XCircle className="size-4 text-destructive shrink-0" />
                      : <CheckCircle2 className="size-4 text-green-500 shrink-0" />
                  ) : (
                    deepScrapeQueue.indexOf(l.id) === deepScrapeProgress
                      ? <Loader2 className="size-4 animate-spin text-blue-500 shrink-0" />
                      : <Clock className="size-4 text-muted-foreground shrink-0" />
                  )}
                  <span className="truncate flex-1">{l.title}</span>
                  {l.deepScrapeError && (
                    <span className="text-xs text-destructive truncate max-w-[150px]">{l.deepScrapeError}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STEP: grouping */}
        {store.step === 'grouping' && (
          <div className="space-y-4">
            <h3 className="font-semibold">Grupowanie produktów</h3>
            <GroupingView
              listings={store.listings.filter(l => l.selected)}
              groups={store.groups}
              onMoveToGroup={store.moveToGroup}
              onCreateGroup={store.createGroup}
              onListGroup={handleListGroup}
            />
          </div>
        )}

        {/* STEP: diff-fields */}
        {store.step === 'diff-fields' && (
          <DiffFieldsStep
            groupName={store.activeGroup ?? ''}
            diffFields={store.diffFields}
            selectedFields={store.selectedDiffFields}
            onToggle={store.toggleDiffField}
            onNext={() => store.setStep('template')}
          />
        )}

        {/* STEP: desc-template */}
        {store.step === 'desc-template' && (
          currentTemplateSession?.generatedDescription && descriptionTemplate ? (
            <DescriptionTemplateStep
              description={descriptionTemplate}
              placeholders={descTemplatePlaceholders}
              groupListings={activeGroupListings}
              onNext={(desc) => {
                setDescriptionTemplate(desc)
                store.setStep('review')
              }}
            />
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Brak opisu w template — pomijam krok.</p>
              <Button onClick={() => store.setStep('review')}>Dalej: Review</Button>
            </div>
          )
        )}

        {/* STEP: review */}
        {store.step === 'review' && store.templateSession && (
          <BatchReviewStep
            groupName={store.activeGroup ?? ''}
            listings={activeGroupListings}
            selectedDiffFields={store.selectedDiffFields}
            diffFields={store.diffFields}
            templateSession={store.templateSession}
            descriptionTemplate={descriptionTemplate}
            titleTemplate={titleTemplate}
            onSubmit={handleBatchSubmit}
          />
        )}
      </div>

    </div>
  )
}
