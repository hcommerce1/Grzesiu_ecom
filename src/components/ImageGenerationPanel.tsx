"use client"

import { useState, useCallback } from "react"
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
  ImageGenPreference,
  ImageGenProvider,
  PromptClassification,
  ImageGenResult,
} from "@/lib/types"
import {
  isPromptValid,
  getProviderDisplayName,
  getProviderCostHint,
  getIntentDisplayName,
} from "@/lib/image-gen-utils"

interface Props {
  activeImages: ImageMeta[]
  onAddImage: (url: string) => void
  onReplaceImage: (oldUrl: string, newUrl: string) => void
}

type Step = "input" | "classified" | "generating" | "result"

export function ImageGenerationPanel({ activeImages, onAddImage, onReplaceImage }: Props) {
  const [prompt, setPrompt] = useState("")
  const [sourceImageUrl, setSourceImageUrl] = useState<string | null>(null)
  const [preference, setPreference] = useState<ImageGenPreference>("nanobananapro")
  const [step, setStep] = useState<Step>("input")

  // Klasyfikacja
  const [classification, setClassification] = useState<PromptClassification | null>(null)
  const [classifyError, setClassifyError] = useState<string | null>(null)
  const [classifying, setClassifying] = useState(false)

  // Override providera
  const [providerOverride, setProviderOverride] = useState<ImageGenProvider | null>(null)

  // Generacja
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<ImageGenResult | null>(null)
  const [genError, setGenError] = useState<string | null>(null)

  // Wybrany image do zastąpienia
  const [replaceTargetUrl, setReplaceTargetUrl] = useState<string | null>(null)

  const effectiveProvider = providerOverride || classification?.recommendedProvider || preference

  // ─── Klasyfikacja promptu ───
  const handleClassify = useCallback(async () => {
    const validation = isPromptValid(prompt)
    if (!validation.valid) {
      setClassifyError(validation.reason || "Nieprawidłowy prompt")
      return
    }

    setClassifying(true)
    setClassifyError(null)
    setClassification(null)

    try {
      const res = await fetch("/api/images/classify-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          hasSourceImage: !!sourceImageUrl,
          preference,
        }),
      })
      const data = await res.json()

      if (data.error) {
        setClassifyError(data.error)
        return
      }

      setClassification(data as PromptClassification)

      if (!data.isValid) {
        setClassifyError(data.rejectionReason || "Prompt odrzucony")
        return
      }

      setStep("classified")
    } catch (err) {
      setClassifyError(err instanceof Error ? err.message : "Błąd klasyfikacji")
    } finally {
      setClassifying(false)
    }
  }, [prompt, sourceImageUrl, preference])

  // ─── Generacja obrazu ───
  const handleGenerate = useCallback(async () => {
    if (!classification?.isValid) return

    setGenerating(true)
    setGenError(null)
    setResult(null)
    setStep("generating")

    try {
      const res = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: classification.translatedPrompt,
          sourceImageUrl: sourceImageUrl || undefined,
          provider: effectiveProvider,
        }),
      })
      const data = (await res.json()) as ImageGenResult

      if (!data.success) {
        setGenError(data.error || "Błąd generacji")
        setStep("classified")
        return
      }

      setResult(data)
      setStep("result")
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Błąd generacji")
      setStep("classified")
    } finally {
      setGenerating(false)
    }
  }, [classification, sourceImageUrl, effectiveProvider])

  // ─── Reset ───
  const handleReset = useCallback(() => {
    setStep("input")
    setClassification(null)
    setClassifyError(null)
    setProviderOverride(null)
    setResult(null)
    setGenError(null)
    setReplaceTargetUrl(null)
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

              {/* Wybór zdjęcia źródłowego */}
              {activeImages.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Zdjęcie źródłowe (opcjonalne — do edycji/usuwania tła)
                  </label>
                  <div className="flex gap-3">
                    {/* Podgląd wybranego zdjęcia */}
                    <div className="shrink-0 size-32 rounded-lg border-2 border-dashed border-border bg-muted/30 flex items-center justify-center overflow-hidden">
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

                    {/* Siatka miniatur */}
                    <div className="flex gap-2 flex-wrap content-start">
                      <button
                        onClick={() => setSourceImageUrl(null)}
                        className={`size-14 rounded-lg border-2 flex items-center justify-center text-[10px] text-muted-foreground transition-colors ${
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
                          className={`relative size-14 rounded-lg border-2 overflow-hidden transition-colors ${
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

              {/* Toggle preferencji modelu */}
              <div className="flex items-center gap-3">
                <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                  Preferowany model generacji:
                </label>
                <div className="flex rounded-lg border border-border overflow-hidden">
                  <button
                    onClick={() => setPreference("nanobananapro")}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      preference === "nanobananapro"
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    NanoBananaPro ($$$)
                  </button>
                  <button
                    onClick={() => setPreference("fluxcontextpro")}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-border ${
                      preference === "fluxcontextpro"
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    FluxContextPro ($$$$)
                  </button>
                </div>
              </div>

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
                  disabled={classifying || !prompt.trim()}
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

              {/* Przetłumaczony prompt */}
              <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3">
                <Globe className="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Prompt EN (wysyłany do modelu)
                  </p>
                  <p className="text-sm">{classification.translatedPrompt}</p>
                </div>
              </div>

              {/* Sugestia poprawki */}
              {classification.suggestion && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
                  <Lightbulb className="size-4 mt-0.5 shrink-0 text-amber-500" />
                  <div>
                    <p className="font-medium text-amber-700 dark:text-amber-400">Sugestia</p>
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
        </div>
    </div>
  )
}
