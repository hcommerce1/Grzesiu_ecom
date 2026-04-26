"use client"

import { Package2 } from "lucide-react"
import { GlobalTokenCostBadge } from "./GlobalTokenCostBadge"

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 h-14 border-b bg-card flex items-center px-4 gap-3">
      <div className="flex items-center gap-2 flex-1">
        <Package2 className="size-5 text-primary shrink-0" />
        <span className="font-semibold text-sm">Menedżer ofert</span>
        <span className="hidden sm:inline text-xs text-muted-foreground">Allegro / BaseLinker</span>
      </div>
      <GlobalTokenCostBadge />
    </header>
  )
}
