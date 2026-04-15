"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { AllegroPreview } from "./AllegroPreview"
import { EmpikPreview } from "./EmpikPreview"
import { ErliPreview } from "./ErliPreview"
import type { ImageMeta } from "@/lib/types"

type PreviewTab = "allegro" | "empik" | "erli"

interface PreviewContainerProps {
  title: string
  fullHtml: string
  imagesMeta: ImageMeta[]
  parameters: Record<string, string | string[]>
  price?: number
}

const TABS: { key: PreviewTab; label: string; color: string }[] = [
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
}: PreviewContainerProps) {
  const [activeTab, setActiveTab] = useState<PreviewTab>("allegro")
  const activeImages = imagesMeta.filter(i => !i.removed).map(i => i.url)

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
      <div className="rounded-xl border border-border overflow-hidden bg-white" style={{ maxWidth: 1200 }}>
        <div className="overflow-x-auto">
          <div style={{ pointerEvents: 'none' }}>
            {activeTab === "allegro" && (
              <AllegroPreview
                title={title}
                fullHtml={fullHtml}
                images={activeImages}
                parameters={parameters}
                price={price}
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
