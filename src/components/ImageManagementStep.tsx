"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { Reorder } from "framer-motion"
import {
  Sparkles,
  Loader2,
  Trash2,
  RotateCcw,
  GripVertical,
  Eye,
  Star,
  Upload,
  Cloud,
  ChevronDown,
  ChevronRight,
  Wand2,
  Award,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { ImageMeta } from "@/lib/types"
import { ImageGenerationPanel } from "@/components/ImageGenerationPanel"
import { cn } from "@/lib/utils"

interface Props {
  images: string[]
  imagesMeta: ImageMeta[]
  onImagesMetaChange: (meta: ImageMeta[]) => void
  productId?: string
  /** Tryb edit — produkt już ma zdjęcia w BL. Ukrywamy upload i provider select. */
  allowUpload?: boolean
}

export function ImageManagementStep({ images, imagesMeta, onImagesMetaChange, productId, allowUpload = true }: Props) {
  const [showGenPanel, setShowGenPanel] = useState(false)
  const [analyzingAll, setAnalyzingAll] = useState(false)
  const [analyzingUrls, setAnalyzingUrls] = useState<Set<string>>(new Set())
  const [analysisError, setAnalysisError] = useState("")

  // Upload state
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState("")
  const [uploadError, setUploadError] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Ref for current meta to avoid stale closure
  const metaRef = useRef<ImageMeta[]>([])

  // Initialize meta if empty
  const meta: ImageMeta[] = imagesMeta.length > 0
    ? imagesMeta
    : images.map((url, i) => ({
        url,
        order: i,
        removed: false,
        aiDescription: "",
        aiConfidence: 0,
        userDescription: "",
        isFeatureImage: false,
        features: [],
      }))

  // Keep ref in sync — useEffect zamiast inline assignment (eliminuje stale ref w concurrent rendering)
  useEffect(() => {
    metaRef.current = meta
  }, [meta])

  const activeImages = meta.filter(m => !m.removed)
  const removedImages = meta.filter(m => m.removed)

  // FIX: Use functional updater to avoid stale closure
  const updateMeta = useCallback(
    (updater: (prev: ImageMeta[]) => ImageMeta[]) => {
      onImagesMetaChange(updater(metaRef.current))
    },
    [onImagesMetaChange],
  )

  const analyzeImages = useCallback(
    async (urls: string[]) => {
      const newAnalyzing = new Set(urls)
      setAnalyzingUrls(prev => new Set([...prev, ...newAnalyzing]))
      setAnalysisError("")

      try {
        const res = await fetch("/api/images/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ images: urls }),
        })
        const data = await res.json()

        if (!res.ok) {
          const msg = data.error || `Błąd serwera (${res.status})`
          console.error("Image analysis API error:", msg)
          setAnalysisError(msg)
          return
        }

        if (data.results) {
          updateMeta(prev =>
            prev.map(m => {
              const result = data.results.find((r: { url: string }) => r.url === m.url)
              if (!result) return m
              return {
                ...m,
                aiDescription: result.aiDescription,
                aiConfidence: result.aiConfidence,
                isFeatureImage: result.isFeatureImage,
                features: result.features,
              }
            }),
          )
        } else {
          setAnalysisError("API nie zwróciło wyników analizy")
        }
      } catch (err) {
        console.error("Image analysis error:", err)
        setAnalysisError(err instanceof Error ? err.message : "Błąd połączenia z serwerem")
      } finally {
        setAnalyzingUrls(prev => {
          const next = new Set(prev)
          urls.forEach(u => next.delete(u))
          return next
        })
      }
    },
    [updateMeta],
  )

  const handleAnalyzeAll = useCallback(async () => {
    setAnalyzingAll(true)
    const urls = activeImages.map(m => m.url)
    await analyzeImages(urls)
    setAnalyzingAll(false)
  }, [activeImages, analyzeImages])

  const handleRemove = (url: string) => {
    updateMeta(prev => prev.map(m => (m.url === url ? { ...m, removed: true } : m)))
  }

  const handleRestore = (url: string) => {
    updateMeta(prev => prev.map(m => (m.url === url ? { ...m, removed: false } : m)))
  }

  const handleDescriptionChange = (url: string, desc: string) => {
    updateMeta(prev => prev.map(m => (m.url === url ? { ...m, userDescription: desc } : m)))
  }

  const handleReorder = (reordered: ImageMeta[]) => {
    const updated = reordered.map((m, i) => ({ ...m, order: i }))
    onImagesMetaChange([...updated, ...removedImages])
  }

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return

      setUploading(true)
      setUploadError("")
      setUploadProgress(`0/${files.length}`)

      try {
        const formData = new FormData()
        for (const f of files) {
          formData.append("files", f)
        }
        formData.append("provider", "auto")

        const res = await fetch("/api/images/upload", {
          method: "POST",
          body: formData,
        })
        const data = await res.json()

        if (!res.ok) {
          setUploadError(data.error || "Błąd przesyłania")
          return
        }

        if (data.uploads?.length > 0) {
          const current = metaRef.current
          const maxOrder = current.length > 0 ? Math.max(...current.map(m => m.order)) : -1
          const newMeta: ImageMeta[] = data.uploads.map(
            (u: { url: string; provider: "r2" | "cloudinary" }, i: number) => ({
              url: u.url,
              order: maxOrder + 1 + i,
              removed: false,
              aiDescription: "",
              aiConfidence: 0,
              userDescription: "",
              isFeatureImage: false,
              features: [],
              uploadedVia: u.provider,
            }),
          )
          onImagesMetaChange([...current, ...newMeta])
          setUploadProgress(`${data.uploads.length}/${files.length}`)
        }

        if (data.errors?.length > 0) {
          setUploadError(data.errors.join("; "))
        }
      } catch (err) {
        console.error("Upload error:", err)
        setUploadError("Błąd połączenia z serwerem")
      } finally {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ""
      }
    },
    [onImagesMetaChange],
  )

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files || files.length === 0) return
      uploadFiles(Array.from(files))
    },
    [uploadFiles],
  )

  // Drag-and-drop upload — tylko gdy allowUpload (ukryty w trybie edit)
  const [dragOver, setDragOver] = useState(false)
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!allowUpload) return
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault()
      setDragOver(true)
    }
  }, [allowUpload])
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Tylko gdy kursor opuszcza container, nie children
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDragOver(false)
  }, [])
  const handleDrop = useCallback((e: React.DragEvent) => {
    if (!allowUpload) return
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"))
    if (files.length > 0) uploadFiles(files)
  }, [allowUpload, uploadFiles])

  const hasAnyAnalysis = activeImages.some(m => m.aiDescription)

  return (
    <div className="space-y-3">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-card pb-3 space-y-3 border-b border-border -mx-5 px-5 pt-1">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">
              Zdjęcia produktu ({activeImages.length})
            </h3>
            <p className="text-xs text-muted-foreground">
              Przeciągaj, aby zmienić kolejność. Analizuj AI, aby opisać zdjęcia.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {allowUpload && (
              <>
                <input ref={fileInputRef} type="file" multiple accept="image/*" onChange={handleFileUpload} className="hidden" />
                <Button onClick={() => fileInputRef.current?.click()} disabled={uploading} size="sm" variant="outline" className="gap-1.5">
                  {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                  {uploading ? uploadProgress : "Dodaj"}
                </Button>
              </>
            )}

            <Button onClick={handleAnalyzeAll} disabled={analyzingAll || activeImages.length === 0} size="sm" className="gap-1.5">
              {analyzingAll ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {analyzingAll ? "Analizuję..." : hasAnyAnalysis ? "Analizuj ponownie" : "Analizuj wszystkie"}
            </Button>
          </div>
        </div>

        {uploadError && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
            {uploadError}
          </div>
        )}
        {analysisError && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
            Analiza zdjęć: {analysisError}
          </div>
        )}
      </div>

      {/* Image Generation Panel — collapsible */}
      <div className="rounded-xl border border-border overflow-hidden">
        <button
          onClick={() => setShowGenPanel(!showGenPanel)}
          className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Wand2 className="size-4 text-primary" />
            <span className="text-sm font-semibold">Generuj / Edytuj zdjęcia AI</span>
          </div>
          {showGenPanel ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
        </button>
        {showGenPanel && (
          <div className="border-t border-border">
            <ImageGenerationPanel
              activeImages={activeImages}
              productId={productId}
              onAddImage={(url) => {
                const current = metaRef.current
                const maxOrder = current.length > 0 ? Math.max(...current.map(m => m.order)) : -1
                const newImage: ImageMeta = { url, order: maxOrder + 1, removed: false, aiDescription: "", aiConfidence: 0, userDescription: "", isFeatureImage: false, features: [] }
                onImagesMetaChange([...current, newImage])
                // Auto-analiza po dodaniu — Claude opisuje nowo wygenerowane zdjęcie w tle
                analyzeImages([url])
              }}
              onReplaceImage={(oldUrl, newUrl) => {
                updateMeta(prev => prev.map(m => (m.url === oldUrl ? { ...m, url: newUrl } : m)))
              }}
            />
          </div>
        )}
      </div>

      {/* Separator between AI generation and gallery */}
      <div className="flex items-center gap-3 px-1">
        <div className="flex-1 h-px bg-border" />
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Galeria zdjęć</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* Scrollable images container — drop zone for drag-and-drop upload */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative rounded-xl transition-colors",
          dragOver && allowUpload && "ring-2 ring-primary border-dashed",
        )}
      >
        {dragOver && allowUpload && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-primary/10 backdrop-blur-sm">
            <div className="rounded-lg bg-card border border-primary px-4 py-3 text-sm font-medium text-primary shadow-lg">
              Upuść zdjęcia tutaj
            </div>
          </div>
        )}
        <Reorder.Group axis="y" values={activeImages} onReorder={handleReorder} className="space-y-2">
          {activeImages.map((img) => {
            const isAnalyzing = analyzingUrls.has(img.url)
            return (
              <Reorder.Item
                key={img.url}
                value={img}
                className="flex gap-4 rounded-xl border border-border bg-card p-3 shadow-sm"
              >
                <div className="flex flex-col items-center justify-center cursor-grab active:cursor-grabbing">
                  <GripVertical className="size-4 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground mt-0.5">{img.order + 1}</span>
                </div>

                <div className="relative flex-shrink-0">
                  <img
                    src={img.url}
                    alt=""
                    className="w-36 h-28 object-cover rounded-lg border border-border"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
                  />
                  {img.isFeatureImage && (
                    <Star className="absolute -top-1 -right-1 size-3.5 text-amber-500 fill-amber-500" />
                  )}
                  {img.uploadedVia && (
                    <div className="absolute -bottom-1 -right-1">
                      <Badge variant="secondary" className="text-[8px] px-1 py-0 gap-0.5">
                        <Cloud className="size-2" />
                        {img.uploadedVia === 'r2' ? 'R2' : 'CLD'}
                      </Badge>
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-1 flex-wrap">
                    {isAnalyzing && <Badge variant="secondary" className="text-[10px] gap-0.5"><Loader2 className="size-2.5 animate-spin" />Analiza...</Badge>}
                    {!isAnalyzing && img.aiConfidence > 0 && (
                      <Badge variant={img.aiConfidence >= 0.7 ? "default" : "secondary"} className="text-[10px]">
                        {img.isFeatureImage ? "Cechy" : "Zdjęcie"} ({Math.round(img.aiConfidence * 100)}%)
                      </Badge>
                    )}
                    {img.features.slice(0, 3).map(f => <Badge key={f} variant="outline" className="text-[10px]">{f}</Badge>)}
                  </div>
                  <textarea
                    value={img.userDescription || img.aiDescription}
                    onChange={(e) => handleDescriptionChange(img.url, e.target.value)}
                    placeholder={isAnalyzing ? "Analizuję..." : "Opisz zdjęcie..."}
                    rows={3}
                    className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/20"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => analyzeImages([img.url])}
                    disabled={isAnalyzing}
                    className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                    title={img.aiDescription ? "Analizuj ponownie" : "Analizuj"}
                  >
                    {isAnalyzing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  </button>
                  <button
                    onClick={() => updateMeta(prev => prev.map(m =>
                      m.url === img.url
                        ? { ...m, isLogo: !img.isLogo }
                        : { ...m, isLogo: false }
                    ))}
                    className={`p-1.5 rounded-md transition-colors ${
                      img.isLogo
                        ? "text-amber-600 bg-amber-50 hover:bg-amber-100"
                        : "hover:bg-accent text-muted-foreground hover:text-foreground"
                    }`}
                    title={img.isLogo ? "Usuń oznaczenie logo producenta" : "Oznacz jako logo producenta"}
                  >
                    <Award className="size-4" />
                  </button>
                  <button
                    onClick={() => handleRemove(img.url)}
                    className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    title="Usuń"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </Reorder.Item>
            )
          })}
        </Reorder.Group>
      </div>

      {/* Removed images */}
      {removedImages.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Usunięte ({removedImages.length})
          </h4>
          <div className="flex gap-2 flex-wrap">
            {removedImages.map((img) => (
              <div key={img.url} className="relative group">
                <img
                  src={img.url}
                  alt=""
                  className="size-12 object-cover rounded-lg border border-border opacity-40"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
                />
                <button
                  onClick={() => handleRestore(img.url)}
                  className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Przywróć"
                >
                  <RotateCcw className="size-3.5 text-white" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary */}
      {hasAnyAnalysis && (
        <div className="rounded-lg border border-border bg-muted/30 p-2.5 text-xs text-muted-foreground">
          <Eye className="size-3.5 inline mr-1" />
          {activeImages.filter(m => m.isFeatureImage).length} z cechami,{" "}
          {activeImages.filter(m => !m.isFeatureImage && m.aiDescription).length} ogólnych,{" "}
          {activeImages.filter(m => !m.aiDescription).length} bez analizy
        </div>
      )}
    </div>
  )
}
