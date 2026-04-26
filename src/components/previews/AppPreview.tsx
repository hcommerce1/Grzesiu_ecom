"use client"

import { useState, useEffect, useCallback } from "react"
import { ChevronLeft, ChevronRight, Tag } from "lucide-react"
import type { ImageMeta, AllegroParameter } from "@/lib/types"

interface AppPreviewProps {
  title: string
  fullHtml: string
  imagesMeta: ImageMeta[]
  parameters: Record<string, string | string[]>
  parameterDefs?: AllegroParameter[]
  price?: number
  ean?: string
  sku?: string
  categoryPath?: string
}

export function AppPreview({
  title,
  fullHtml,
  imagesMeta,
  parameters,
  parameterDefs,
  price,
  ean,
  sku,
  categoryPath,
}: AppPreviewProps) {
  const activeImages = imagesMeta
    .filter((m) => !m.removed)
    .sort((a, b) => a.order - b.order)

  const [activeIdx, setActiveIdx] = useState(0)

  // Clamp idx przy renderze — gdy lista się zmieni (np. removed/added), wracamy do 0.
  // To eliminuje effect z setState (cascading renders).
  const safeIdx = activeImages.length === 0
    ? 0
    : Math.min(activeIdx, activeImages.length - 1)

  const goPrev = useCallback(() => {
    setActiveIdx((i) => {
      const cur = activeImages.length === 0 ? 0 : Math.min(i, activeImages.length - 1)
      return cur > 0 ? cur - 1 : Math.max(0, activeImages.length - 1)
    })
  }, [activeImages.length])
  const goNext = useCallback(() => {
    setActiveIdx((i) => {
      const cur = activeImages.length === 0 ? 0 : Math.min(i, activeImages.length - 1)
      return cur < activeImages.length - 1 ? cur + 1 : 0
    })
  }, [activeImages.length])

  // Keyboard arrows
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goPrev()
      else if (e.key === "ArrowRight") goNext()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [goPrev, goNext])

  // Mapowanie parametrów na czytelne pary nazwa: wartość
  const paramRows = Object.entries(parameters)
    .map(([id, value]) => {
      const def = parameterDefs?.find((p) => p.id === id)
      const name = def?.name ?? id
      const dict = def?.dictionary ?? []
      const translate = (v: string) => dict.find((o) => o.id === v)?.value ?? v
      const displayValue = Array.isArray(value)
        ? value.map(translate).join(", ")
        : translate(String(value))
      if (!displayValue) return null
      return { name, value: displayValue }
    })
    .filter(Boolean) as Array<{ name: string; value: string }>

  const activeImage = activeImages[safeIdx]

  return (
    <div className="bg-background text-foreground">
      <div className="mx-auto max-w-4xl p-6 space-y-6">
        {/* Tytuł */}
        <h1 className="text-2xl sm:text-3xl font-bold leading-tight">{title || "Brak tytułu"}</h1>

        {price != null && (
          <div className="text-2xl font-semibold text-primary">{price.toFixed(2)} zł</div>
        )}

        {/* Galeria */}
        {activeImages.length > 0 && (
          <div className="space-y-3">
            <div className="relative rounded-xl overflow-hidden bg-muted/30 border border-border">
              <img
                src={activeImage?.url}
                alt={`${title} — zdjęcie ${safeIdx + 1}`}
                className="w-full max-h-[600px] object-contain bg-white"
              />
              {activeImages.length > 1 && (
                <>
                  <button
                    onClick={goPrev}
                    aria-label="Poprzednie zdjęcie"
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-background/80 hover:bg-background border border-border shadow-sm transition-colors"
                  >
                    <ChevronLeft className="size-5" />
                  </button>
                  <button
                    onClick={goNext}
                    aria-label="Następne zdjęcie"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-background/80 hover:bg-background border border-border shadow-sm transition-colors"
                  >
                    <ChevronRight className="size-5" />
                  </button>
                  <div className="absolute bottom-2 right-2 px-2 py-1 rounded-md bg-background/80 border border-border text-xs font-medium">
                    {safeIdx + 1} / {activeImages.length}
                  </div>
                </>
              )}
            </div>

            {/* Miniatury z numeracją */}
            {activeImages.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {activeImages.map((img, i) => (
                  <button
                    key={img.url}
                    onClick={() => setActiveIdx(i)}
                    className={`relative shrink-0 size-16 rounded-lg overflow-hidden border-2 transition-colors ${
                      i === safeIdx
                        ? "border-primary ring-2 ring-primary/30"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <img src={img.url} alt="" className="size-full object-cover" />
                    <span className="absolute top-0.5 left-0.5 size-4 rounded-full bg-background/90 text-[9px] font-bold flex items-center justify-center text-foreground">
                      {i + 1}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Opis */}
        {fullHtml && (
          <section className="space-y-2">
            <h2 className="text-lg font-semibold border-b border-border pb-1">Opis</h2>
            <div
              className="app-preview-prose text-sm leading-relaxed"
              dangerouslySetInnerHTML={{ __html: fullHtml }}
            />
          </section>
        )}

        {/* Specyfikacja */}
        {(paramRows.length > 0 || ean || sku || categoryPath) && (
          <section className="space-y-2">
            <h2 className="text-lg font-semibold border-b border-border pb-1 flex items-center gap-2">
              <Tag className="size-4" />
              Specyfikacja
            </h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              {categoryPath && (
                <div className="contents">
                  <dt className="text-muted-foreground">Kategoria</dt>
                  <dd className="font-medium">{categoryPath}</dd>
                </div>
              )}
              {ean && (
                <div className="contents">
                  <dt className="text-muted-foreground">EAN</dt>
                  <dd className="font-mono text-xs">{ean}</dd>
                </div>
              )}
              {sku && (
                <div className="contents">
                  <dt className="text-muted-foreground">SKU</dt>
                  <dd className="font-mono text-xs">{sku}</dd>
                </div>
              )}
              {paramRows.map((row, i) => (
                <div key={i} className="contents">
                  <dt className="text-muted-foreground">{row.name}</dt>
                  <dd className="font-medium">{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>

      {/* Inline styling dla opisu — minimalistyczna wersja prose żeby nie ściągać @tailwindcss/typography */}
      <style jsx global>{`
        .app-preview-prose h1, .app-preview-prose h2, .app-preview-prose h3 {
          font-weight: 600;
          margin-top: 1.25em;
          margin-bottom: 0.5em;
          line-height: 1.3;
        }
        .app-preview-prose h2 { font-size: 1.125rem; }
        .app-preview-prose h3 { font-size: 1rem; }
        .app-preview-prose p { margin-bottom: 0.75em; }
        .app-preview-prose ul, .app-preview-prose ol {
          margin-left: 1.5em;
          margin-bottom: 0.75em;
        }
        .app-preview-prose ul { list-style-type: disc; }
        .app-preview-prose ol { list-style-type: decimal; }
        .app-preview-prose li { margin-bottom: 0.25em; }
        .app-preview-prose strong { font-weight: 600; }
        .app-preview-prose img {
          max-width: 100%;
          border-radius: 0.5rem;
          margin: 0.75em 0;
        }
        .app-preview-prose a { color: var(--primary, #2563eb); text-decoration: underline; }
      `}</style>
    </div>
  )
}
