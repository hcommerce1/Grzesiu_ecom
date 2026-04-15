"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import {
  Loader2, RefreshCw, AlertTriangle, Image as ImageIcon,
  Trash2, Sparkles, Type, Settings, Check, X, ChevronLeft, ChevronRight, History,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { compileSectionsToHtml, buildInputSnapshot, classifyChangesDetailed } from "@/lib/description-utils"
import { DEFAULT_DESCRIPTION_PROMPT, DESCRIPTION_PROMPT_STORAGE_KEY } from "@/lib/description-prompt"
import { cn } from "@/lib/utils"
import type {
  ImageMeta,
  DescriptionSection,
  GeneratedDescription,
  DescriptionInputSnapshot,
  ChangeClassification,
  DescriptionVersion,
  TargetableSection,
  AllegroParameter,
  SheetMeta,
} from "@/lib/types"

interface Props {
  title: string
  translatedData: { title: string; attributes: Record<string, string> }
  imagesMeta: ImageMeta[]
  filledParameters: Record<string, string | string[]>
  categoryPath: string
  categoryId: string
  descriptionPrompt?: string
  generatedDescription?: GeneratedDescription
  previousSnapshot?: DescriptionInputSnapshot
  titleCandidates: string[]
  onDescriptionChange: (desc: GeneratedDescription) => void
  onSnapshotChange: (snapshot: DescriptionInputSnapshot) => void
  onTitleChange: (title: string) => void
  onCandidatesChange: (candidates: string[]) => void
  onParameterChange: (id: string, value: string | string[]) => void
  /** Slot for marketplace preview (rendered between title and description sections) */
  previewSlot?: React.ReactNode
  /** Section targeting */
  targetedSections?: TargetableSection[]
  onSectionTargetToggle?: (section: TargetableSection) => void
  /** Allegro parameters (for required-check before generation) */
  allegroParameters?: AllegroParameter[]
  /** Sheet metadata — uwagi krótkie, magazynowe, stan techniczny */
  sheetMeta?: SheetMeta
}

export function DescriptionGenerationStep({
  title,
  translatedData,
  imagesMeta,
  filledParameters,
  categoryPath,
  categoryId,
  descriptionPrompt,
  generatedDescription,
  previousSnapshot,
  titleCandidates,
  onDescriptionChange,
  onSnapshotChange,
  onTitleChange,
  onCandidatesChange,
  onParameterChange,
  previewSlot,
  targetedSections,
  onSectionTargetToggle,
  allegroParameters,
  sheetMeta,
}: Props) {
  const [generating, setGenerating] = useState(false)
  const [generatingTitle, setGeneratingTitle] = useState(false)
  const [error, setError] = useState("")
  const [changeClassification, setChangeClassification] = useState<ChangeClassification>({ severity: 'none', changes: [] })
  const [showChangeBanner, setShowChangeBanner] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const [promptText, setPromptText] = useState("")
  const hasTriggered = useRef(false)
  const [paramCheckSkipped, setParamCheckSkipped] = useState(false)

  // Buduj string uwag z sheetMeta (uszkodzenia, stan techniczny)
  const uwagiText = (() => {
    if (!sheetMeta) return ''
    const parts: string[] = []
    if (sheetMeta.uwagiKrotkie) parts.push(`Uwagi krótkie: ${sheetMeta.uwagiKrotkie}`)
    if (sheetMeta.uwagiMagazynowe) parts.push(`Uwagi magazynowe: ${sheetMeta.uwagiMagazynowe}`)
    if (sheetMeta.stanTechniczny) parts.push(`Stan techniczny: ${sheetMeta.stanTechniczny}`)
    return parts.join('\n')
  })()

  // Sprawdź czy wymagane parametry są uzupełnione
  const missingRequiredCount = (allegroParameters ?? []).filter(p =>
    p.required && !filledParameters[p.id]
  ).length
  const hasRequiredParamsMissing = missingRequiredCount > 0 && !paramCheckSkipped

  // ─── Wersjonowanie opisu ───
  const MAX_VERSIONS = 20
  const [versions, setVersions] = useState<DescriptionVersion[]>([])
  const [versionIndex, setVersionIndex] = useState(-1) // -1 = current (live) version

  const pushVersion = useCallback((desc: GeneratedDescription, currentTitleVal: string, label?: string) => {
    setVersions(prev => {
      const v: DescriptionVersion = {
        sections: desc.sections,
        fullHtml: desc.fullHtml,
        title: currentTitleVal,
        timestamp: new Date().toISOString(),
        label,
      }
      const next = [...prev, v]
      if (next.length > MAX_VERSIONS) next.shift()
      return next
    })
    setVersionIndex(-1) // reset to current
  }, [])

  const navigateVersion = useCallback((dir: -1 | 1) => {
    // If currently at live (-1), going back means last saved version
    const total = versions.length
    if (total === 0) return

    let newIdx: number
    if (versionIndex === -1) {
      // Currently viewing live version
      if (dir === -1) newIdx = total - 1
      else return // can't go forward from live
    } else {
      newIdx = versionIndex + dir
      if (newIdx >= total) {
        // Go to live
        setVersionIndex(-1)
        return
      }
      if (newIdx < 0) return
    }

    setVersionIndex(newIdx)
    // Restore this version
    const v = versions[newIdx]
    if (v) {
      onTitleChange(v.title)
      onDescriptionChange({
        sections: v.sections,
        fullHtml: v.fullHtml,
        generatedAt: v.timestamp,
        inputHash: '',
      })
    }
  }, [versions, versionIndex, onTitleChange, onDescriptionChange])

  const sections = generatedDescription?.sections || []
  const currentTitle = title || ""
  const charCount = currentTitle.length
  const isOverLimit = charCount > 75

  // Load custom prompt from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(DESCRIPTION_PROMPT_STORAGE_KEY)
    setPromptText(stored || DEFAULT_DESCRIPTION_PROMPT)
  }, [])

  // Sprawdź zmiany przy wejściu na krok — auto-generuj TYLKO gdy brak opisu (pierwszy raz)
  useEffect(() => {
    if (!generatedDescription) {
      // Brak opisu — generuj automatycznie tytuł i opis (tylko raz)
      // Ale NIE gdy brakuje wymaganych parametrów
      if (!hasTriggered.current && !hasRequiredParamsMissing) {
        hasTriggered.current = true
        generateAll()
      }
      return
    }

    // Jeśli opis istnieje, sprawdź czy dane się zmieniły — pokaż banner, nie dialog
    const currentSnapshot = buildInputSnapshot(
      title,
      imagesMeta,
      filledParameters,
      categoryId,
      translatedData.attributes,
    )
    const classification = classifyChangesDetailed(previousSnapshot, currentSnapshot)
    setChangeClassification(classification)
    if (classification.severity !== 'none') {
      setShowChangeBanner(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Generowanie tytułu ───

  const generateTitle = useCallback(async () => {
    setGeneratingTitle(true)
    try {
      const res = await fetch("/api/generate-title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          translatedData: {
            title: translatedData.title,
            attributes: translatedData.attributes,
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
      setGeneratingTitle(false)
    }
  }, [translatedData, imagesMeta, categoryPath, onTitleChange, onCandidatesChange])

  // ─── Generowanie opisu ───

  const generateDescription = useCallback(async () => {
    // Save current version before regenerating
    if (generatedDescription) {
      pushVersion(generatedDescription, title, 'Przed regeneracją')
    }
    setGenerating(true)
    setError("")
    setShowChangeBanner(false)

    try {
      const activeImgs = imagesMeta.filter(i => !i.removed)
      const res = await fetch("/api/generate-description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          translatedData,
          imagesMeta: activeImgs,
          filledParameters,
          categoryPath,
          categoryId,
          prompt: descriptionPrompt,
          uwagi: uwagiText,
        }),
      })

      const data = await res.json()
      if (data.error) throw new Error(data.error)

      const desc: GeneratedDescription = {
        sections: data.sections,
        fullHtml: data.fullHtml,
        generatedAt: new Date().toISOString(),
        inputHash: data.inputHash,
      }

      onDescriptionChange(desc)

      // Zapisz snapshot
      const snapshot = buildInputSnapshot(title, imagesMeta, filledParameters, categoryId, translatedData.attributes)
      onSnapshotChange(snapshot)
      setChangeClassification({ severity: 'none', changes: [] })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd generowania opisu")
    } finally {
      setGenerating(false)
    }
  }, [title, translatedData, imagesMeta, filledParameters, categoryPath, categoryId, descriptionPrompt, uwagiText, onDescriptionChange, onSnapshotChange, generatedDescription, pushVersion])

  // ─── Generuj wszystko równolegle ───

  const generateAll = useCallback(async () => {
    // Save current version before regenerating
    if (generatedDescription) {
      pushVersion(generatedDescription, title, 'Przed regeneracją')
    }
    setGenerating(true)
    setGeneratingTitle(true)
    setError("")
    setShowChangeBanner(false)

    const titlePromise = fetch("/api/generate-title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        translatedData: {
          title: translatedData.title,
          attributes: translatedData.attributes,
        },
        imagesMeta: imagesMeta.filter(i => !i.removed).map(i => ({
          aiDescription: i.aiDescription,
          userDescription: i.userDescription,
          features: i.features,
        })),
        categoryPath,
      }),
    }).then(r => r.json())

    const activeImagesMeta = imagesMeta.filter(i => !i.removed)
    const descPromise = fetch("/api/generate-description", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title || translatedData.title,
        translatedData,
        imagesMeta: activeImagesMeta,
        filledParameters,
        categoryPath,
        categoryId,
        prompt: descriptionPrompt,
        uwagi: uwagiText,
      }),
    }).then(r => r.json())

    try {
      const [titleData, descData] = await Promise.all([titlePromise, descPromise])

      // Tytuł
      if (titleData.error) {
        setError(titleData.error)
      } else {
        onTitleChange(titleData.title || "")
        onCandidatesChange(titleData.candidates || [])
      }

      // Opis
      if (descData.error) {
        setError(prev => prev ? `${prev}; ${descData.error}` : descData.error)
      } else {
        const desc: GeneratedDescription = {
          sections: descData.sections,
          fullHtml: descData.fullHtml,
          generatedAt: new Date().toISOString(),
          inputHash: descData.inputHash,
        }
        onDescriptionChange(desc)

        const snapshot = buildInputSnapshot(title, imagesMeta, filledParameters, categoryId, translatedData.attributes)
        onSnapshotChange(snapshot)
        setChangeClassification({ severity: 'none', changes: [] })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd generowania")
    } finally {
      setGenerating(false)
      setGeneratingTitle(false)
    }
  }, [title, translatedData, imagesMeta, filledParameters, categoryPath, categoryId, descriptionPrompt, uwagiText, onDescriptionChange, onSnapshotChange, onTitleChange, onCandidatesChange, generatedDescription, pushVersion])

  const handleSectionUpdate = useCallback(
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
      onDescriptionChange({
        ...generatedDescription,
        sections: updated,
        fullHtml,
      })
    },
    [generatedDescription, onDescriptionChange],
  )

  const handleSectionRemove = useCallback(
    (sectionId: string) => {
      if (!generatedDescription) return
      const updated = generatedDescription.sections.filter(s => s.id !== sectionId)
      const fullHtml = compileSectionsToHtml(updated)
      onDescriptionChange({
        ...generatedDescription,
        sections: updated,
        fullHtml,
      })
    },
    [generatedDescription, onDescriptionChange],
  )

  const handleSectionImageReorder = useCallback(
    (sectionId: string, imageUrls: string[]) => {
      if (!generatedDescription) return
      pushVersion(generatedDescription, title, 'Przed zmianą zdjęć w sekcji')
      const updated = generatedDescription.sections.map(s => {
        if (s.id !== sectionId) return s
        return { ...s, imageUrls }
      })
      const fullHtml = compileSectionsToHtml(updated)
      onDescriptionChange({
        ...generatedDescription,
        sections: updated,
        fullHtml,
      })
    },
    [generatedDescription, onDescriptionChange, pushVersion, title],
  )

  // ─── Prompt save ───

  const handlePromptSave = () => {
    localStorage.setItem(DESCRIPTION_PROMPT_STORAGE_KEY, promptText)
    setPromptOpen(false)
  }

  const handlePromptReset = () => {
    setPromptText(DEFAULT_DESCRIPTION_PROMPT)
    localStorage.removeItem(DESCRIPTION_PROMPT_STORAGE_KEY)
  }

  // ─── Loading spinner (centered) ───

  if (generating && !generatedDescription) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 className="size-12 animate-spin text-primary" />
        <p className="mt-4 text-sm text-muted-foreground animate-pulse">
          Generuję opis produktu...
        </p>
      </div>
    )
  }

  // ─── Prompt editing modal ───

  if (promptOpen) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Edytuj prompt generowania opisu</h3>
          <Button variant="ghost" size="sm" onClick={() => setPromptOpen(false)}>
            <X className="size-4" />
          </Button>
        </div>
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

  const isTitleTargeted = targetedSections?.some(s => s.id === 'title') ?? false

  return (
    <div className="flex flex-col gap-4">

      {/* ═══ BANNER BRAKUJĄCYCH PARAMETRÓW ═══ */}
      {hasRequiredParamsMissing && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-800">
          <div className="flex items-center gap-2 text-sm">
            <AlertTriangle className="size-4 shrink-0" />
            <span>
              Brakuje <strong>{missingRequiredCount}</strong> wymaganych parametrów — opis będzie niepełny.
              Wróć do poprzedniego kroku i uzupełnij parametry.
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs shrink-0 gap-1"
            onClick={() => {
              setParamCheckSkipped(true)
              // Odppal auto-generację jeśli jeszcze nie było opisu
              if (!generatedDescription && !hasTriggered.current) {
                hasTriggered.current = true
                generateAll()
              }
            }}
          >
            Pomiń
          </Button>
        </div>
      )}

      {/* ═══ BANNER ZMIAN (nie blokujący) ═══ */}
      {showChangeBanner && changeClassification.severity !== 'none' && (
        <div className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border ${
          changeClassification.severity === 'major'
            ? 'border-amber-300 bg-amber-50 text-amber-800'
            : 'border-blue-200 bg-blue-50 text-blue-700'
        }`}>
          <div className="flex items-center gap-2 text-sm">
            <AlertTriangle className="size-4 shrink-0" />
            <span>
              {changeClassification.severity === 'major'
                ? 'Wykryto istotne zmiany od ostatniej generacji'
                : 'Dane zmienione od ostatniej generacji'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setShowChangeBanner(false)}
            >
              Ignoruj
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => { setShowChangeBanner(false); generateAll() }}
            >
              <RefreshCw className="size-3" />
              Regeneruj
            </Button>
          </div>
        </div>
      )}

      {/* ═══ TYTUŁ ═══ */}
      <div
        className={cn(
          "rounded-xl border bg-card p-4 space-y-3 cursor-pointer transition-all",
          isTitleTargeted
            ? "ring-2 ring-primary border-primary"
            : "border-border hover:border-primary/40"
        )}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('input, textarea, button')) return
          onSectionTargetToggle?.({ id: 'title', label: 'Tytuł Allegro', type: 'title' })
        }}
      >
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-muted uppercase tracking-wider">
            <Type className="size-3" />
            Tytuł Allegro
          </label>
          <Button
            onClick={generateTitle}
            disabled={generatingTitle}
            size="sm"
            variant={currentTitle ? "outline" : "default"}
            className="gap-1.5"
          >
            {generatingTitle ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            {generatingTitle ? "Generuję..." : currentTitle ? "Nowy tytuł" : "Generuj tytuł"}
          </Button>
        </div>

        {/* Input tytułu */}
        <div className="relative">
          <input
            type="text"
            value={currentTitle}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Wpisz lub wygeneruj tytuł..."
            className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm font-semibold uppercase outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 pr-16"
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

        {/* Alternatywne propozycje */}
        {titleCandidates.length > 0 && (
          <div className="space-y-1.5">
            <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Propozycje
            </h4>
            <div className="flex flex-col gap-1">
              {titleCandidates.map((candidate, i) => (
                <button
                  key={i}
                  onClick={() => onTitleChange(candidate)}
                  className={`w-full text-left rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                    candidate === currentTitle
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border hover:border-primary/50 hover:bg-accent"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium uppercase truncate">{candidate}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10px] text-muted-foreground">{candidate.length}/75</span>
                      {candidate === currentTitle && <Check className="size-3 text-primary" />}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ═══ PODGLĄD MARKETPLACE ═══ */}
      {previewSlot}

    </div>
  )
}
