"use client"

import { useState } from "react"
import { X, Loader2, Package, Edit3, Layers, GitBranch } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Portal } from "@/components/ui/portal"
import { AnimatePresence, motion } from "framer-motion"
import { cn } from "@/lib/utils"
import type { ProductMode } from "@/lib/types"

interface WorkflowStarterProps {
  onClose: () => void
  onStarted: (data: {
    mode: ProductMode
    productId?: string
    parentId?: string
    bundleProducts?: Record<string, number>
    sourceUrl?: string
  }) => void
}

type Step = "mode" | "type" | "details" | "source"

export function WorkflowStarter({ onClose, onStarted }: WorkflowStarterProps) {
  const [step, setStep] = useState<Step>("mode")
  const [isEdit, setIsEdit] = useState(false)
  const [productType, setProductType] = useState<"simple" | "variant" | "bundle">("simple")
  const [productId, setProductId] = useState("")
  const [parentId, setParentId] = useState("")
  const [bundleInput, setBundleInput] = useState("")
  const [sourceUrl, setSourceUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const handleModeSelect = (edit: boolean) => {
    setIsEdit(edit)
    setStep(edit ? "details" : "type")
  }

  const handleTypeSelect = (type: "simple" | "variant" | "bundle") => {
    setProductType(type)
    setStep(type === "simple" ? "source" : "details")
  }

  const getMode = (): ProductMode => {
    if (isEdit) return "edit"
    if (productType === "variant") return "variant"
    if (productType === "bundle") return "bundle"
    return "new"
  }

  const parseBundleProducts = (): Record<string, number> => {
    const result: Record<string, number> = {}
    bundleInput.split("\n").forEach((line) => {
      const parts = line.trim().split(/[\s,]+/)
      if (parts.length >= 2) {
        const id = parts[0]
        const qty = parseInt(parts[1], 10)
        if (id && !isNaN(qty)) result[id] = qty
      }
    })
    return result
  }

  const handleStart = async () => {
    setError("")
    setLoading(true)
    try {
      const mode = getMode()
      const bundleProducts = productType === "bundle" ? parseBundleProducts() : undefined

      await fetch("/api/product-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          product_id: isEdit ? productId : undefined,
          parent_id: productType === "variant" ? parentId : undefined,
          bundle_products: bundleProducts,
        }),
      })

      onStarted({
        mode,
        productId: isEdit ? productId : undefined,
        parentId: productType === "variant" ? parentId : undefined,
        bundleProducts,
        sourceUrl: sourceUrl || undefined,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd inicjalizacji sesji")
    } finally {
      setLoading(false)
    }
  }

  const stepLabel: Record<Step, string> = {
    mode: "Tryb",
    type: "Typ produktu",
    details: "Szczegóły",
    source: "Źródło danych",
  }

  return (
    <Portal>
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-card border rounded-xl shadow-xl w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div>
                <h2 className="font-semibold text-sm">Ręczna oferta BaseLinker</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{stepLabel[step]}</p>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-md hover:bg-muted text-muted-foreground transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Step: Mode */}
              {step === "mode" && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Wybierz tryb pracy:</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => handleModeSelect(false)}
                      className="flex flex-col items-start gap-2 p-4 rounded-xl border border-border hover:border-primary hover:bg-accent transition-all text-left group"
                    >
                      <Package className="size-5 text-muted-foreground group-hover:text-primary transition-colors" />
                      <div>
                        <p className="text-sm font-medium">Nowy produkt</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Utwórz nowy wpis w BL</p>
                      </div>
                    </button>
                    <button
                      onClick={() => handleModeSelect(true)}
                      className="flex flex-col items-start gap-2 p-4 rounded-xl border border-border hover:border-primary hover:bg-accent transition-all text-left group"
                    >
                      <Edit3 className="size-5 text-muted-foreground group-hover:text-primary transition-colors" />
                      <div>
                        <p className="text-sm font-medium">Edycja istniejącego</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Zaktualizuj produkt w BL</p>
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {/* Step: Type */}
              {step === "type" && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Typ nowego produktu:</p>
                  <div className="space-y-2">
                    {[
                      { value: "simple" as const, label: "Prosty", desc: "Pojedynczy produkt", icon: Package },
                      { value: "variant" as const, label: "Wariant (child)", desc: "Wymaga ID produktu-rodzica", icon: GitBranch },
                      { value: "bundle" as const, label: "Zestaw (bundle)", desc: "Lista składników z ilościami", icon: Layers },
                    ].map(({ value, label, desc, icon: Icon }) => (
                      <button
                        key={value}
                        onClick={() => handleTypeSelect(value)}
                        className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:border-primary hover:bg-accent transition-all text-left group"
                      >
                        <Icon className="size-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                        <div>
                          <p className="text-sm font-medium">{label}</p>
                          <p className="text-xs text-muted-foreground">{desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setStep("mode")} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                    ← Wróć
                  </button>
                </div>
              )}

              {/* Step: Details */}
              {step === "details" && (
                <div className="space-y-4">
                  {isEdit && (
                    <div className="space-y-1.5">
                      <Label>ID produktu w BaseLinker</Label>
                      <Input
                        value={productId}
                        onChange={(e) => setProductId(e.target.value)}
                        placeholder="np. 123456"
                      />
                      <p className="text-xs text-muted-foreground">
                        Lub skorzystaj z zakładki „Edytuj istniejące" aby wyszukać po EAN/SKU/nazwie
                      </p>
                    </div>
                  )}
                  {productType === "variant" && (
                    <div className="space-y-1.5">
                      <Label>parent_id (ID produktu-rodzica)</Label>
                      <Input
                        value={parentId}
                        onChange={(e) => setParentId(e.target.value)}
                        placeholder="np. 100000"
                      />
                    </div>
                  )}
                  {productType === "bundle" && (
                    <div className="space-y-1.5">
                      <Label>Składniki zestawu</Label>
                      <p className="text-xs text-muted-foreground">ID wariantu i ilość — jeden per linia (np. <code>123456 2</code>)</p>
                      <textarea
                        value={bundleInput}
                        onChange={(e) => setBundleInput(e.target.value)}
                        placeholder={"123456 1\n789012 2"}
                        rows={4}
                        className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm font-mono outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 resize-none"
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2">
                    <button
                      onClick={() => setStep(isEdit ? "mode" : "type")}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      ← Wróć
                    </button>
                    <Button
                      size="sm"
                      onClick={() => setStep("source")}
                      disabled={(isEdit && !productId) || (productType === "variant" && !parentId)}
                    >
                      Dalej →
                    </Button>
                  </div>
                </div>
              )}

              {/* Step: Source */}
              {step === "source" && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>URL do scrapowania <span className="text-muted-foreground font-normal">(opcjonalne)</span></Label>
                    <Input
                      value={sourceUrl}
                      onChange={(e) => setSourceUrl(e.target.value)}
                      placeholder="https://www.amazon.de/dp/..."
                    />
                  </div>

                  {!sourceUrl && (
                    <div className="text-xs text-muted-foreground bg-muted px-3 py-2.5 rounded-lg leading-relaxed">
                      <strong>Tryb ręczny:</strong> Po kliknięciu „Rozpocznij" przejdziesz bezpośrednio do panelu BaseLinker. Możesz też użyć Asystenta AI w kroku 6 aby wygenerować opis.
                    </div>
                  )}

                  {error && (
                    <p className="text-xs text-destructive">{error}</p>
                  )}

                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => setStep("details")}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      ← Wróć
                    </button>
                    <Button size="sm" onClick={handleStart} disabled={loading} className="gap-1.5">
                      {loading && <Loader2 className="size-3.5 animate-spin" />}
                      Rozpocznij
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </Portal>
  )
}
