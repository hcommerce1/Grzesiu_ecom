"use client"

import { useState, useCallback, useEffect } from "react"
import {
  Sparkles,
  Loader2,
  ImagePlus,
  Replace,
  Wand2,
  AlertTriangle,
  Lightbulb,
  Globe,
  Check,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import type {
  ImageMeta,
  ImageGenMode,
  ImageGenProvider,
  PromptClassification,
  ImageGenResult,
} from "@/lib/types"
import {
  isPromptValid,
  getProviderDisplayName,
  getProviderCostHint,
  getIntentDisplayName,
  detectImageMode,
  getModeDisplayName,
} from "@/lib/image-gen-utils"

interface Props {
  activeImages: ImageMeta[]
  onAddImage: (url: string) => void
  onReplaceImage: (oldUrl: string, newUrl: string) => void
  productId?: string
}

type Step = "input" | "classified" | "generating" | "result"

export function ImageGenerationPanel({ activeImages, onAddImage, onReplaceImage, productId }: Props) {
  const [prompt, setPrompt] = useState("")
  const [sourceImageUrl, setSourceImageUrl] = useState<string | null>(null)
  const [mode, setMode] = useState<ImageGenMode>("generate")
  const [step, setStep] = useState<Step>("input")

  // Auto-update tryb gdy user zmienia źródłowe zdjęcie (heurystyka — user może override radio).
  useEffect(() => {
    setMode(detectImageMode(!!sourceImageUrl, prompt))
    // celowo NIE reagujemy na prompt — zmiana promptu nie powinna nadpisywać ręcznego wyboru radia
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceImageUrl])

  // Klasyfikacja
  const [classification, setClassification] = useState<PromptClassification | null>(null)
  const [classifyError, setClassifyError] = useState<string | null>(null)
  const [classifying, setClassifying] = useState(false)
  const [editedPrompt, setEditedPrompt] = useState("")

  // Override providera
  const [providerOverride, setProviderOverride] = useState<ImageGenProvider | null>(null)

  // Generacja
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<ImageGenResult | null>(null)
  const [genError, setGenError] = useState<string | null>(null)

  // Wybrany image do zastąpienia
  const [replaceTargetUrl, setReplaceTargetUrl] = useState<string | null>(null)

  // Sumaryczny koszt zdjec AI w obrebie tej oferty (resetuje sie automatycznie przez key={item.id} w CollapsibleProductItem)
  const [totalImageCostUsd, setTotalImageCostUsd] = useState(0)
  const [usdToPln, setUsdToPln] = useState(4.10)

  // Storage health — blokujemy generację gdy oba (R2 i Cloudinary) offline
  const [storageOffline, setStorageOffline] = useState(false)

  useEffect(() => {
    fetch("/api/fx-rate")
      .then((r) => r.json())
      .then((d) => {
        if (typeof d?.pln === "number" && d.pln > 0) setUsdToPln(d.pln)
      })
      .catch(() => {/* fallback 4.10 */})
  }, [])

  useEffect(() => {
    fetch("/api/images/upload/status")
      .then((r) => r.json())
      .then((d) => setStorageOffline(d?.bothOffline === true))
      .catch(() => setStorageOffline(false))
  }, [])

  const effectiveProvider: ImageGenProvider = providerOverride || classification?.recommendedProvider || "nanobananapro"

  // ─── Klasyfikacja promptu ───
  const handleClassify = useCallback(async () => {
    const validation = isPromptValid(prompt)
    if (!validation.valid) {
      setClassifyError(validation.reason || "Nieprawidłowy prompt")
      return
    }

    if (mode === "edit" && !sourceImageUrl) {
      setClassifyError("Tryb edycji wymaga zdjęcia źródłowego — wybierz zdjęcie lub przełącz na 'Wygeneruj nowe'.")
      return
    }

    setClassifying(true)
    setClassifyError(null)
    setClassification(null)
    setEditedPrompt("")

    // Source AI description (gdy istnieje) trafia do Claude'a żeby nie wymyślał wyglądu produktu
    const sourceMeta = sourceImageUrl ? activeImages.find(i => i.url === sourceImageUrl) : undefined
    const sourceAiDescription = sourceMeta?.aiDescription || undefined

    try {
      const res = await fetch("/api/images/classify-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          hasSourceImage: !!sourceImageUrl,
          mode,
          sourceAiDescription,
          productId,
        }),
      })
      const data = await res.json()

      if (data.error) {
        setClassifyError(data.error)
        return
      }

      const classified = data as PromptClassification
      setClassification(classified)

      if (!classified.isValid) {
        setClassifyError(classified.rejectionReason || "Prompt odrzucony")
        return
      }

      setEditedPrompt(classified.enrichedPrompt || "")
      setStep("classified")
    } catch (err) {
      setClassifyError(err instanceof Error ? err.message : "Błąd klasyfikacji")
    } finally {
      setClassifying(false)
    }
  }, [prompt, sourceImageUrl, mode, productId, activeImages])

  // ─── Generacja obrazu ───
  const handleGenerate = useCallback(async () => {
    if (!classification?.isValid) return

    const finalPrompt = editedPrompt.trim() || classification.enrichedPrompt

    setGenerating(true)
    setGenError(null)
    setResult(null)
    setStep("generating")

    try {
      const res = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: finalPrompt,
          sourceImageUrl: sourceImageUrl || undefined,
          provider: effectiveProvider,
          mode: classification.mode,
          photoRoomOperation: classification.photoRoomOperation,
          backgroundPrompt: classification.backgroundPrompt,
        }),
      })
      const data = (await res.json()) as ImageGenResult

      if (!data.success) {
        setGenError(data.error || "Błąd generacji")
        setStep("classified")
        return
      }

      if (typeof data.costUsd === "number") {
        setTotalImageCostUsd((prev) => prev + data.costUsd!)
      }

      setResult(data)
      setStep("result")
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Błąd generacji")
      setStep("classified")
    } finally {
      setGenerating(false)
    }
  }, [classification, sourceImageUrl, effectiveProvider, editedPrompt])

  // ─── Reset ───
  const handleReset = useCallback(() => {
    setStep("input")
    setClassification(null)
    setClassifyError(null)
    setProviderOverride(null)
    setResult(null)
    setGenError(null)
    setReplaceTargetUrl(null)
    setEditedPrompt("")
  }, [])

  // ─── Akcje na wyniku ───
  const handleAddToImages = useCallback(() => {
    if (result?.imageUrl) {
      onAddImage(result.imageUrl)
      handleReset()
    }
  }, [result, onAddImage, handleReset])

  const handleReplaceImage = useCallback(() => {
    if (result?.imageUrl && replaceTargetUrl) {
      onReplaceImage(replaceTargetUrl, result.imageUrl)
      handleReset()
    }
  }, [result, replaceTargetUrl, onReplaceImage, handleReset])

  const getActionButtonLabel = () => {
    if (effectiveProvider === "removebg") return "Usuń tło"
    if (classification?.intent === "simple_edit" || classification?.intent === "context_edit")
      return "Edytuj zdjęcie"
    return "Generuj zdjęcie"
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-4 pb-4 pt-3 space-y-4">
          {storageOffline && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="size-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Storage offline</p>
                <p className="text-xs mt-0.5 text-destructive/80">
                  Ani R2 ani Cloudinary nie odpowiadają — generacja AI jest wyłączona, bo nie da się trwale zapisać wyniku. Sprawdź konfigurację lub dostępność providerów.
                </p>
              </div>
            </div>
          )}

          {/* ─── KROK 1: Input ─── */}
          {(step === "input" || step === "classified") && (
            <>
              {/* Textarea */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Opisz, co chcesz wygenerować lub zmienić
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => {
                    setPrompt(e.target.value)
                    if (step === "classified") handleReset()
                  }}
                  placeholder="np. Usuń tło i dodaj białe, Zmień kolor kabla na czarny, Wygeneruj profesjonalne zdjęcie produktowe..."
                  rows={3}
                  className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/20"
                />
              </div>

              {/* Toggle trybu (generate/edit) — od razu pod textarea, bo decyduje czy source jest wymagane */}
              <div className="flex items-center gap-3">
                <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                  Tryb:
                </label>
                <div className="flex rounded-lg border border-border overflow-hidden">
                  <button
                    onClick={() => setMode("generate")}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      mode === "generate"
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {getModeDisplayName("generate")}
                  </button>
                  <button
                    onClick={() => setMode("edit")}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-border ${
                      mode === "edit"
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {getModeDisplayName("edit")}
                  </button>
                </div>
                {mode === "edit" && !sourceImageUrl && (
                  <span className="text-[11px] text-amber-600 dark:text-amber-400">
                    Wybierz zdjęcie źródłowe poniżej
                  </span>
                )}
              </div>

              {/* Wybór zdjęcia źródłowego — większy podgląd, źródło jest zawsze opcjonalnym kontekstem dla AI */}
              {activeImages.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Zdjęcie źródłowe (opcjonalne kontekst dla AI — wymagane tylko w trybie edycji)
                  </label>
                  <div className="flex gap-3">
                    {/* Podgląd wybranego zdjęcia — powiększony do 256px */}
                    <div className="shrink-0 size-64 rounded-lg border-2 border-dashed border-border bg-muted/30 flex items-center justify-center overflow-hidden">
                      {sourceImageUrl ? (
                        <img
                          src={sourceImageUrl}
                          alt="Wybrane zdjęcie źródłowe"
                          className="size-full object-contain"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground text-center px-2">
                          Nie wybrano
                        </span>
                      )}
                    </div>

                    {/* Siatka miniatur do wyboru */}
                    <div className="flex gap-2 flex-wrap content-start">
                      <button
                        onClick={() => setSourceImageUrl(null)}
                        className={`size-16 rounded-lg border-2 flex items-center justify-center text-[10px] text-muted-foreground transition-colors ${
                          !sourceImageUrl
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        Brak
                      </button>
                      {activeImages.map((img) => (
                        <button
                          key={img.url}
                          onClick={() => setSourceImageUrl(img.url)}
                          className={`relative size-16 rounded-lg border-2 overflow-hidden transition-colors ${
                            sourceImageUrl === img.url
                              ? "border-primary ring-2 ring-primary/30"
                              : "border-border hover:border-primary/50"
                          }`}
                        >
                          <img
                            src={img.url}
                            alt=""
                            className="size-full object-cover"
                            onError={(e) => {
                              ;(e.target as HTMLImageElement).style.display = "none"
                            }}
                          />
                          {sourceImageUrl === img.url && (
                            <div className="absolute inset-0 bg-primary/10 flex items-center justify-center">
                              <Check className="size-5 text-primary" />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Błąd klasyfikacji */}
              {classifyError && (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                  <span>{classifyError}</span>
                </div>
              )}

              {/* Błąd generacji */}
              {genError && (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                  <span>{genError}</span>
                </div>
              )}

              {/* Przycisk analizy */}
              {step === "input" && (
                <Button
                  onClick={handleClassify}
                  disabled={classifying || !prompt.trim() || storageOffline}
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                >
                  {classifying ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="size-3.5" />
                  )}
                  {classifying ? "Analizuję prompt..." : "Analizuj prompt"}
                </Button>
              )}
            </>
          )}

          {/* ─── KROK 2: Klasyfikacja ─── */}
          {step === "classified" && classification?.isValid && (
            <div className="space-y-3">
              {/* Badges z informacjami */}
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {getIntentDisplayName(classification.intent)}
                </Badge>
                <Badge variant="outline" className="gap-1">
                  {getProviderDisplayName(effectiveProvider)}
                  <span className="text-amber-500">
                    {getProviderCostHint(effectiveProvider)}
                  </span>
                </Badge>
                {classification.confidence >= 0.8 && (
                  <Badge variant="success" className="text-[10px]">
                    Wysoka pewność
                  </Badge>
                )}
              </div>

              {/* Wzbogacony prompt EN — edytowalny. AI rozszerzył twój krótki prompt;
                  sprawdź, halucynacje wytnij, i wygeneruj. */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Globe className="size-3.5 shrink-0 text-muted-foreground" />
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Prompt EN (wysyłany do modelu) — edytowalny
                  </label>
                </div>
                <textarea
                  value={editedPrompt}
                  onChange={(e) => setEditedPrompt(e.target.value)}
                  rows={5}
                  className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/20"
                />
                <p className="text-[11px] text-muted-foreground">
                  AI rozszerzył twój prompt o szczegóły. Przeczytaj, wytnij ewentualne halucynacje i ewentualnie zedytuj — to ten tekst pójdzie do modelu.
                </p>
              </div>

              {/* Sugestia — co konkretnie AI dodało */}
              {classification.suggestion && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
                  <Lightbulb className="size-4 mt-0.5 shrink-0 text-amber-500" />
                  <div>
                    <p className="font-medium text-amber-700 dark:text-amber-400">Co AI dodało</p>
                    <p className="text-amber-600 dark:text-amber-300">{classification.suggestion}</p>
                  </div>
                </div>
              )}

              {/* Override modelu */}
              <div className="flex items-center gap-3">
                <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                  Zmień model:
                </label>
                <Select
                  value={effectiveProvider}
                  onValueChange={(v) => setProviderOverride(v as ImageGenProvider)}
                >
                  <SelectTrigger className="w-52 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="removebg">
                      Remove.bg — usuwanie tła ($)
                    </SelectItem>
                    <SelectItem value="replicate">
                      Replicate SDXL — proste edycje ($$)
                    </SelectItem>
                    <SelectItem value="nanobananapro">
                      NanoBananaPro — generacja ($$$)
                    </SelectItem>
                    <SelectItem value="fluxcontextpro">
                      FluxContextPro — edycja kontekstowa ($$$$)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Przycisk generacji */}
              <div className="flex gap-2">
                <Button onClick={handleGenerate} size="sm" className="gap-1.5">
                  <Wand2 className="size-3.5" />
                  {getActionButtonLabel()}
                </Button>
                <Button onClick={handleReset} size="sm" variant="ghost">
                  Zmień prompt
                </Button>
              </div>
            </div>
          )}

          {/* ─── KROK 3: Generowanie ─── */}
          {step === "generating" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="size-8 animate-spin text-primary" />
              <div className="text-center">
                <p className="text-sm font-medium">Generuję...</p>
                <p className="text-xs text-muted-foreground">
                  {getProviderDisplayName(effectiveProvider)} pracuje nad Twoim zdjęciem
                </p>
              </div>
            </div>
          )}

          {/* ─── KROK 4: Wynik ─── */}
          {step === "result" && result?.imageUrl && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="success">Gotowe</Badge>
                <Badge variant="outline" className="gap-1">
                  {getProviderDisplayName(result.provider)}
                  {result.costEstimate && (
                    <span className="text-muted-foreground">
                      {" "}({result.costEstimate})
                    </span>
                  )}
                </Badge>
              </div>

              {/* Podgląd */}
              <div className="relative rounded-lg border border-border overflow-hidden bg-muted/30">
                <img
                  src={result.imageUrl}
                  alt="Wygenerowane zdjęcie"
                  className="w-full max-h-80 object-contain"
                />
              </div>

              {/* Akcje */}
              <div className="space-y-2">
                <Button onClick={handleAddToImages} size="sm" className="gap-1.5 w-full">
                  <ImagePlus className="size-3.5" />
                  Dodaj do zdjęć produktu
                </Button>

                {activeImages.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">
                      Lub zastąp istniejące zdjęcie:
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      {activeImages.map((img) => (
                        <button
                          key={img.url}
                          onClick={() => setReplaceTargetUrl(img.url)}
                          className={`relative size-14 rounded-lg border-2 overflow-hidden transition-colors ${
                            replaceTargetUrl === img.url
                              ? "border-primary ring-2 ring-primary/30"
                              : "border-border hover:border-primary/50"
                          }`}
                        >
                          <img
                            src={img.url}
                            alt=""
                            className="size-full object-cover"
                            onError={(e) => {
                              ;(e.target as HTMLImageElement).style.display = "none"
                            }}
                          />
                        </button>
                      ))}
                    </div>
                    {replaceTargetUrl && (
                      <Button
                        onClick={handleReplaceImage}
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                      >
                        <Replace className="size-3.5" />
                        Zastąp wybrane zdjęcie
                      </Button>
                    )}
                  </div>
                )}

                <Button onClick={handleReset} size="sm" variant="ghost" className="w-full">
                  Generuj kolejne
                </Button>
              </div>
            </div>
          )}

          {/* Sumaryczny koszt zdjęć AI w tej ofercie */}
          {totalImageCostUsd > 0 && (
            <div className="border-t border-border pt-2 flex justify-between items-center text-xs">
              <span className="text-muted-foreground">Wydano na zdjęcia AI w tej ofercie</span>
              <span className="font-semibold text-foreground">
                ~{(totalImageCostUsd * usdToPln).toFixed(2)} zł
              </span>
            </div>
          )}
        </div>
    </div>
  )
}
