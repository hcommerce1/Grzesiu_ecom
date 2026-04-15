"use client"

import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { interpolateValue } from "@/lib/batch-session"
import type { GeneratedDescription, SellerScrapedListing } from "@/lib/types"

interface Props {
  description: GeneratedDescription
  placeholders: string[]
  groupListings: SellerScrapedListing[]
  onNext: (templatedDesc: GeneratedDescription) => void
}

export function DescriptionTemplateStep({ description, placeholders, groupListings, onNext }: Props) {
  // Pick a random product for preview
  const [previewIdx, setPreviewIdx] = useState(0)
  const deepScrapedListings = groupListings.filter(l => l.deepScrapeData)

  const previewProduct = deepScrapedListings[previewIdx % Math.max(1, deepScrapedListings.length)]
  const previewAttrs = previewProduct?.deepScrapeData?.attributes ?? {}

  // Build preview HTML
  const previewHtml = useMemo(() => {
    if (!previewProduct?.deepScrapeData) return description.fullHtml
    return description.sections.map(section => {
      const body = interpolateValue(section.bodyHtml, previewAttrs)
      const heading = interpolateValue(section.heading, previewAttrs)
      return `${heading ? `<h2>${heading}</h2>` : ''}${body}`
    }).join('')
  }, [description, previewProduct, previewAttrs])

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold">Template opisu z placeholderami</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Poniższe placeholdery zostaną podmienione danymi każdego wariantu.
        </p>
      </div>

      {/* Placeholders */}
      {placeholders.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {placeholders.map(p => (
            <span key={p} className="px-2 py-1 rounded bg-primary/10 text-primary text-sm font-mono">
              {`{{${p}}}`}
            </span>
          ))}
        </div>
      )}

      {/* Template sections preview */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-muted-foreground">Template:</h4>
        {description.sections.map(section => (
          <div key={section.id} className="border border-border rounded-lg p-3 space-y-1">
            {section.heading && (
              <p className="text-sm font-medium" dangerouslySetInnerHTML={{ __html: section.heading }} />
            )}
            <div
              className="text-xs text-muted-foreground prose prose-xs max-w-none"
              dangerouslySetInnerHTML={{ __html: section.bodyHtml }}
            />
            {section.imageUrls.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Zdjęcia pozycji: {section.imageUrls.map((_, i) => `#${i + 1}`).join(', ')}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Live preview */}
      {deepScrapedListings.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <h4 className="text-sm font-medium">Podgląd wariantu:</h4>
            <select
              value={previewIdx}
              onChange={e => setPreviewIdx(Number(e.target.value))}
              className="text-sm border border-border rounded px-2 py-1 bg-background"
            >
              {deepScrapedListings.map((l, i) => (
                <option key={l.id} value={i}>{l.title}</option>
              ))}
            </select>
          </div>
          <div
            className="border border-border rounded-lg p-4 prose prose-sm max-w-none bg-muted/20"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>
      )}

      {placeholders.length === 0 && (
        <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-sm text-yellow-700">
          Nie znaleziono placeholderów w opisie. Template zostanie użyty bez podmian.
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={() => onNext(description)}>
          Dalej: Review
        </Button>
      </div>
    </div>
  )
}
