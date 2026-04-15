"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Loader2, ChevronLeft, ChevronRight, Play } from "lucide-react"
import { cn } from "@/lib/utils"
import type { SellerScrapedListing, DiffFieldInfo, ProductSession, GeneratedDescription } from "@/lib/types"

interface Props {
  groupName: string
  listings: SellerScrapedListing[]
  selectedDiffFields: string[]
  diffFields: DiffFieldInfo[]
  templateSession: ProductSession
  descriptionTemplate: GeneratedDescription | null
  titleTemplate: string | null
  onSubmit: (batchType: 'independent' | 'variants') => Promise<void>
}

export function BatchReviewStep({
  groupName,
  listings,
  selectedDiffFields,
  diffFields,
  templateSession,
  descriptionTemplate,
  titleTemplate,
  onSubmit,
}: Props) {
  const [batchType, setBatchType] = useState<'independent' | 'variants'>('independent')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const readyListings = listings.filter(l => l.deepScraped && !l.deepScrapeError)
  const errorListings = listings.filter(l => l.deepScrapeError)
  const missingEan = readyListings.filter(l => !l.deepScrapeData?.ean)

  const estimatedSeconds = readyListings.length * 3
  const estimatedMinutes = Math.ceil(estimatedSeconds / 60)

  const diffLabels = diffFields.filter(f => selectedDiffFields.includes(f.field)).map(f => f.label)
  const sameFields = diffFields.filter(f => !selectedDiffFields.includes(f.field)).map(f => f.label)

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      await onSubmit(batchType)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold">Review: {groupName}</h3>
        <p className="text-sm text-muted-foreground mt-1">Sprawdź podsumowanie przed wystawieniem.</p>
      </div>

      {/* Summary */}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <h4 className="text-sm font-semibold">Podsumowanie</h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="text-muted-foreground">Do wystawienia:</div>
          <div className="font-medium">{readyListings.length} produktów</div>
          {errorListings.length > 0 && (
            <>
              <div className="text-muted-foreground">Pominięte (błąd):</div>
              <div className="text-destructive">{errorListings.length} produktów</div>
            </>
          )}
          {missingEan.length > 0 && (
            <>
              <div className="text-muted-foreground">Brak EAN:</div>
              <div className="text-yellow-600">{missingEan.length} produktów</div>
            </>
          )}
          <div className="text-muted-foreground">Diff fields:</div>
          <div className="font-medium">{diffLabels.join(', ') || '—'}</div>
          <div className="text-muted-foreground">Wspólne:</div>
          <div className="text-muted-foreground text-xs">{sameFields.slice(0, 5).join(', ')}{sameFields.length > 5 ? `... +${sameFields.length - 5}` : ''}</div>
          <div className="text-muted-foreground">Szacowany czas:</div>
          <div className="font-medium">~{estimatedMinutes} min ({readyListings.length} × 3s)</div>
        </div>
      </div>

      {/* Problematic */}
      {(errorListings.length > 0 || missingEan.length > 0) && (
        <div className="border border-yellow-500/30 bg-yellow-500/5 rounded-lg p-4 space-y-2">
          <h4 className="text-sm font-semibold text-yellow-700">Problematyczne produkty</h4>
          {errorListings.slice(0, 5).map(l => (
            <div key={l.id} className="flex items-center gap-2 text-sm">
              <span className="text-destructive">✗</span>
              <span className="flex-1 truncate">{l.title}</span>
              <span className="text-xs text-muted-foreground truncate max-w-[200px]">{l.deepScrapeError}</span>
            </div>
          ))}
          {missingEan.slice(0, 3).map(l => (
            <div key={l.id} className="flex items-center gap-2 text-sm">
              <span className="text-yellow-600">⚠</span>
              <span className="flex-1 truncate">{l.title}</span>
              <span className="text-xs text-muted-foreground">brak EAN</span>
            </div>
          ))}
        </div>
      )}

      {/* Mode selector */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Tryb wystawiania</h4>
        <div className="flex gap-3">
          <button
            onClick={() => setBatchType('independent')}
            className={cn(
              "flex-1 p-3 rounded-lg border text-left transition-colors",
              batchType === 'independent' ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
            )}
          >
            <div className="text-sm font-medium">Niezależne</div>
            <div className="text-xs text-muted-foreground mt-0.5">Każdy produkt osobno w BL</div>
          </button>
          <button
            onClick={() => setBatchType('variants')}
            className={cn(
              "flex-1 p-3 rounded-lg border text-left transition-colors",
              batchType === 'variants' ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
            )}
          >
            <div className="text-sm font-medium">Warianty</div>
            <div className="text-xs text-muted-foreground mt-0.5">1 produkt główny + warianty</div>
          </button>
        </div>
      </div>

      {/* Template info */}
      {titleTemplate && (
        <div className="text-sm text-muted-foreground">
          Template tytułu: <span className="font-mono text-xs">{titleTemplate}</span>
        </div>
      )}

      {/* Submit */}
      <Button
        onClick={handleSubmit}
        disabled={isSubmitting || readyListings.length === 0}
        className="w-full"
        size="lg"
      >
        {isSubmitting ? (
          <><Loader2 className="size-4 mr-2 animate-spin" /> Tworzenie batcha...</>
        ) : (
          <><Play className="size-4 mr-2" /> Wystaw {readyListings.length} produktów</>
        )}
      </Button>
    </div>
  )
}
