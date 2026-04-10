"use client"

import { useState, useRef, useEffect } from "react"
import { ExternalLink, ChevronLeft, ChevronRight, Download, Loader2, Barcode, Tag, Copy, Check, ZoomIn } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Portal } from "@/components/ui/portal"
import { AnimatePresence, motion } from "framer-motion"
import { cn } from "@/lib/utils"
import type { ProductData } from "@/lib/types"

interface ProductDisplayProps {
  product: ProductData
  originalProduct?: ProductData | null
}

export function ProductDisplay({ product, originalProduct }: ProductDisplayProps) {
  const [viewMode, setViewMode] = useState<"translated" | "original">("translated")
  const displayProduct = viewMode === "original" && originalProduct ? originalProduct : product

  return (
    <div className="space-y-4">
      {/* Toggle translated/original */}
      {originalProduct && (
        <div className="flex justify-end">
          <div className="inline-flex bg-muted rounded-lg p-0.5 gap-0.5">
            <button
              onClick={() => setViewMode("translated")}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                viewMode === "translated"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Polski (AI)
            </button>
            <button
              onClick={() => setViewMode("original")}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                viewMode === "original"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Oryginał
            </button>
          </div>
        </div>
      )}

      <TitleCard
        title={displayProduct.title}
        url={displayProduct.url}
        price={displayProduct.price}
        currency={displayProduct.currency}
        ean={displayProduct.ean}
        sku={displayProduct.sku}
      />

      {displayProduct.images.length > 0 && (
        <ImageGallery
          images={displayProduct.images}
          zipFilename={displayProduct.ean || displayProduct.sku || "product_images"}
        />
      )}

      {displayProduct.description ? (
        <DescriptionCard description={displayProduct.description} />
      ) : (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Opis nie został wygenerowany — sprawdź klucz OPENAI_API_KEY w .env.local
          </CardContent>
        </Card>
      )}

      {Object.keys(displayProduct.attributes).length > 0 && (
        <AttributesCard attributes={displayProduct.attributes} />
      )}
    </div>
  )
}

/* ── Copy button ── */
function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? <Check className="size-3 text-green-600" /> : <Copy className="size-3" />}
      {label && <span>{copied ? "Skopiowano" : label}</span>}
    </button>
  )
}

/* ── Title Card ── */
function TitleCard({ title: initialTitle, url, price, currency, ean, sku }: {
  title: string; url: string; price?: string; currency?: string; ean?: string; sku?: string
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [title, setTitle] = useState(initialTitle)

  useEffect(() => { setTitle(initialTitle) }, [initialTitle])

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Tytuł produktu
              </span>
              <a href={url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
                <ExternalLink className="size-3" />
              </a>
            </div>
            {isEditing ? (
              <textarea
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => setIsEditing(false)}
                autoFocus
                rows={2}
                className="w-full text-base font-semibold leading-snug bg-muted rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-ring/20 resize-none"
              />
            ) : (
              <h3
                className="text-base font-semibold leading-snug cursor-text hover:bg-muted rounded px-1 -mx-1 py-0.5 transition-colors"
                onClick={() => setIsEditing(true)}
              >
                {title}
              </h3>
            )}
          </div>
          <CopyBtn text={title} />
        </div>

        {price && (
          <p className="text-xl font-bold text-primary">
            {price} <span className="text-sm font-normal text-muted-foreground">{currency}</span>
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {ean && (
            <div className="flex items-center gap-1.5 text-xs bg-muted px-2.5 py-1 rounded-lg border border-border">
              <Barcode className="size-3 text-muted-foreground" />
              <span className="text-muted-foreground">EAN:</span>
              <span className="font-mono">{ean}</span>
              <CopyBtn text={ean} />
            </div>
          )}
          {sku && (
            <div className="flex items-center gap-1.5 text-xs bg-muted px-2.5 py-1 rounded-lg border border-border">
              <Tag className="size-3 text-muted-foreground" />
              <span className="text-muted-foreground">SKU:</span>
              <span className="font-mono">{sku}</span>
              <CopyBtn text={sku} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/* ── Image Gallery ── */
function ImageGallery({ images, zipFilename }: { images: string[]; zipFilename: string }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  const scroll = (dir: "left" | "right") => {
    scrollRef.current?.scrollBy({ left: dir === "left" ? -260 : 260, behavior: "smooth" })
  }

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const res = await fetch("/api/download-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images, filename: zipFilename }),
      })
      if (!res.ok) throw new Error("Błąd pobierania")
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${zipFilename}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error(e)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <>
      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Zdjęcia</span>
              <Badge variant="secondary">{images.length}</Badge>
            </div>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" onClick={handleDownload} disabled={downloading} className="gap-1.5 text-xs">
                {downloading ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
                <span className="hidden sm:inline">Pobierz ZIP ({images.length})</span>
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={() => scroll("left")}><ChevronLeft className="size-4" /></Button>
              <Button size="icon-sm" variant="ghost" onClick={() => scroll("right")}><ChevronRight className="size-4" /></Button>
            </div>
          </div>

          <div ref={scrollRef} className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
            {images.map((src, i) => (
              <button
                key={i}
                onClick={() => setLightboxSrc(src)}
                className="group relative flex-shrink-0 w-32 h-32 rounded-xl bg-white border border-border overflow-hidden hover:border-primary/50 hover:shadow-sm transition-all"
              >
                <img
                  src={src}
                  alt={`Zdjęcie ${i + 1}`}
                  className="w-full h-full object-contain p-1.5"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <ZoomIn className="size-5 text-white drop-shadow" />
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Lightbox */}
      <Portal>
        <AnimatePresence>
          {lightboxSrc && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8"
              onClick={() => setLightboxSrc(null)}
            >
              <img
                src={lightboxSrc}
                alt=""
                className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl"
              />
            </motion.div>
          )}
        </AnimatePresence>
      </Portal>
    </>
  )
}

/* ── Description Card ── */
function DescriptionCard({ description: initialDescription }: { description: string }) {
  const [expanded, setExpanded] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [description, setDescription] = useState(initialDescription)

  useEffect(() => { setDescription(initialDescription) }, [initialDescription])

  const isLong = description.length > 600
  const displayText = isLong && !expanded && !isEditing
    ? description.slice(0, 600) + "…"
    : description

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Opis sprzedażowy</span>
          <CopyBtn text={description} label="Kopiuj" />
        </div>

        {isEditing ? (
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => setIsEditing(false)}
            autoFocus
            rows={12}
            className="w-full text-sm leading-relaxed bg-muted rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-ring/20 resize-y"
          />
        ) : (
          <div
            className="text-sm text-foreground/80 leading-relaxed whitespace-pre-line cursor-text hover:bg-muted/50 rounded-lg px-2 py-1 -mx-2 transition-colors"
            onClick={() => { setIsEditing(true); setExpanded(true) }}
          >
            {displayText}
          </div>
        )}

        {isLong && !isEditing && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-primary hover:text-primary/80 transition-colors"
          >
            {expanded ? "Pokaż mniej" : "Pokaż więcej"}
          </button>
        )}
      </CardContent>
    </Card>
  )
}

/* ── Attributes Card ── */
function AttributesCard({ attributes }: { attributes: Record<string, string> }) {
  const entries = Object.entries(attributes)
  const copyAll = () => entries.map(([k, v]) => `${k}: ${v}`).join("\n")

  return (
    <Card>
      <CardContent className="pt-4 pb-2 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Specyfikacja</span>
            <Badge variant="secondary">{entries.length}</Badge>
          </div>
          <CopyBtn text={copyAll()} label="Kopiuj wszystko" />
        </div>

        <div className="divide-y divide-border/60">
          {entries.map(([key, value], i) => (
            <div key={i} className="group flex items-center justify-between py-2 text-sm hover:bg-muted/50 -mx-2 px-2 rounded-md transition-colors">
              <span className="text-muted-foreground font-medium shrink-0 min-w-[120px] pr-3">{key}</span>
              <div className="flex items-center gap-2 text-right">
                <span className="text-foreground">{value}</span>
                <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                  <CopyBtn text={`${key}: ${value}`} />
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
