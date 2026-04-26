"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { AppPreview } from "./AppPreview"
import { AllegroPreview } from "./AllegroPreview"
import { EmpikPreview } from "./EmpikPreview"
import { ErliPreview } from "./ErliPreview"
import type { ImageMeta, AllegroParameter } from "@/lib/types"

type PreviewTab = "app" | "allegro" | "empik" | "erli"

interface PreviewContainerProps {
  title: string
  fullHtml: string
  imagesMeta: ImageMeta[]
  parameters: Record<string, string | string[]>
  price?: number
  parameterDefs?: AllegroParameter[]
  ean?: string
  sku?: string
  categoryPath?: string
}

const TABS: { key: PreviewTab; label: string; color: string }[] = [
  { key: "app", label: "Nasz", color: "bg-primary" },
  { key: "allegro", label: "Allegro", color: "bg-orange-500" },
  { key: "empik", label: "Empik", color: "bg-purple-600" },
  { key: "erli", label: "Erli", color: "bg-sky-500" },
]

export function PreviewContainer({
  title,
  fullHtml,
  imagesMeta,
  parameters,
  price,
  parameterDefs,
  ean,
  sku,
  categoryPath,
}: PreviewContainerProps) {
  const [activeTab, setActiveTab] = useState<PreviewTab>("app")
  const activeImages = imagesMeta.filter(i => !i.removed).map(i => i.url)

  // Marketplace previews są stylizowane jako "fake site" — blokujemy interakcje.
  // Nasz preview jest interaktywny (galeria, strzałki, klik na miniaturę).
  const isInteractive = activeTab === "app"

  return (
    <div className="space-y-4">
      {/* Tab selector */}
      <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "px-4 py-1.5 rounded-md text-xs font-semibold transition-colors",
              activeTab === tab.key
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <span className={cn("inline-block size-2 rounded-full mr-1.5", tab.color)} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Preview frame */}
      <div className={cn(
        "rounded-xl border border-border overflow-hidden",
        activeTab === "app" ? "bg-background" : "bg-white",
      )} style={{ maxWidth: 1200 }}>
        <div className="overflow-x-auto">
          <div style={{ pointerEvents: isInteractive ? 'auto' : 'none' }}>
            {activeTab === "app" && (
              <AppPreview
                title={title}
                fullHtml={fullHtml}
                imagesMeta={imagesMeta}
                parameters={parameters}
                parameterDefs={parameterDefs}
                price={price}
                ean={ean}
                sku={sku}
                categoryPath={categoryPath}
              />
            )}
            {activeTab === "allegro" && (
              <AllegroPreview
                title={title}
                fullHtml={fullHtml}
                images={activeImages}
                parameters={parameters}
                price={price}
                parameterDefs={parameterDefs}
              />
            )}
            {activeTab === "empik" && (
              <EmpikPreview
                title={title}
                fullHtml={fullHtml}
                images={activeImages}
                price={price}
              />
            )}
            {activeTab === "erli" && (
              <ErliPreview
                title={title}
                fullHtml={fullHtml}
                images={activeImages}
                price={price}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
