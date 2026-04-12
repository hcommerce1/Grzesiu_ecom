"use client"

import { useState, useCallback } from "react"
import { Sparkles, Loader2, Check, Type } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { ImageMeta } from "@/lib/types"

interface Props {
  translatedTitle: string
  translatedAttributes: Record<string, string>
  imagesMeta: ImageMeta[]
  categoryPath?: string
  generatedTitle: string
  titleCandidates: string[]
  onTitleChange: (title: string) => void
  onCandidatesChange: (candidates: string[]) => void
}

export function TitleGenerationStep({
  translatedTitle,
  translatedAttributes,
  imagesMeta,
  categoryPath,
  generatedTitle,
  titleCandidates,
  onTitleChange,
  onCandidatesChange,
}: Props) {
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState("")

  const currentTitle = generatedTitle || ""
  const charCount = currentTitle.length
  const isOverLimit = charCount > 75

  const handleGenerate = useCallback(async () => {
    setGenerating(true)
    setError("")

    try {
      const res = await fetch("/api/generate-title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          translatedData: {
            title: translatedTitle,
            attributes: translatedAttributes,
          },
          imagesMeta: imagesMeta.filter(i => !i.removed).map(i => ({
            aiDescription: i.aiDescription,
            userDescription: i.userDescription,
            features: i.features,
          })),
          categoryPath,
        }),
      })

      const data = await res.json()
      if (data.error) throw new Error(data.error)

      onTitleChange(data.title || "")
      onCandidatesChange(data.candidates || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd generowania tytułu")
    } finally {
      setGenerating(false)
    }
  }, [translatedTitle, translatedAttributes, imagesMeta, categoryPath, onTitleChange, onCandidatesChange])

  return (
    <div className="space-y-5">
      {/* Kontekst produktu */}
      <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Dane produktu
        </h4>
        <div className="text-sm">
          <span className="text-muted-foreground">Oryginalny tytuł: </span>
          <span className="font-medium">{translatedTitle}</span>
        </div>
        {Object.keys(translatedAttributes).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(translatedAttributes).slice(0, 8).map(([k, v]) => (
              <Badge key={k} variant="outline" className="text-[10px]">
                {k}: {String(v).slice(0, 30)}
              </Badge>
            ))}
            {Object.keys(translatedAttributes).length > 8 && (
              <Badge variant="secondary" className="text-[10px]">
                +{Object.keys(translatedAttributes).length - 8} więcej
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Generowanie */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-muted uppercase tracking-wider">
            <Type className="size-3" />
            Tytuł Allegro
          </label>
          <Button
            onClick={handleGenerate}
            disabled={generating}
            size="sm"
            variant={currentTitle ? "outline" : "default"}
            className="gap-1.5"
          >
            {generating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            {generating ? "Generuję..." : currentTitle ? "Generuj ponownie" : "Generuj tytuł"}
          </Button>
        </div>

        {/* Input tytułu */}
        <div className="relative">
          <input
            type="text"
            value={currentTitle}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Wpisz lub wygeneruj tytuł..."
            className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm font-semibold uppercase outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
          />
          <div
            className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono ${
              isOverLimit ? "text-destructive font-bold" : charCount > 65 ? "text-amber-500" : "text-muted-foreground"
            }`}
          >
            {charCount}/75
          </div>
        </div>

        {isOverLimit && (
          <p className="text-xs text-destructive">
            Tytuł przekracza limit 75 znaków o {charCount - 75}.
          </p>
        )}

        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}
      </div>

      {/* Alternatywne propozycje */}
      {titleCandidates.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Alternatywne propozycje
          </h4>
          <div className="space-y-1.5">
            {titleCandidates.map((candidate, i) => (
              <button
                key={i}
                onClick={() => onTitleChange(candidate)}
                className={`w-full text-left rounded-lg border px-3 py-2 text-sm transition-colors ${
                  candidate === currentTitle
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border hover:border-primary/50 hover:bg-accent"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium uppercase truncate">{candidate}</span>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[10px] text-muted-foreground">{candidate.length}/75</span>
                    {candidate === currentTitle && <Check className="size-3.5 text-primary" />}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
