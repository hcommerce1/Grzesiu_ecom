"use client"

import { useState } from "react"
import { Clock, ChevronDown, ChevronUp, Trash2, Package, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useScrapeHistoryStore, type ScrapeHistoryEntry } from "@/lib/stores/scrape-history-store"
import { cn, formatRelativeTime } from "@/lib/utils"
import { motion, AnimatePresence } from "framer-motion"

interface ScrapeHistoryPanelProps {
  onLoadEntry: (entry: ScrapeHistoryEntry) => void
}

export function ScrapeHistoryPanel({ onLoadEntry }: ScrapeHistoryPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const { entries, order, removeEntry, clearHistory } = useScrapeHistoryStore()

  if (order.length === 0) return null

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header — toggle */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors select-none"
      >
        <Clock className="size-4 text-muted-foreground" />
        <span>Historia scrapowania</span>
        <span className="text-xs text-muted-foreground">({order.length})</span>
        <div className="flex-1" />
        {isOpen ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
      </button>

      {/* Content */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border max-h-[340px] overflow-y-auto">
              {order.map((key) => {
                const entry = entries[key]
                if (!entry) return null
                return (
                  <div
                    key={key}
                    className="group flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 cursor-pointer transition-colors border-b border-border/50 last:border-b-0"
                    onClick={() => onLoadEntry(entry)}
                  >
                    {/* Thumbnail */}
                    {entry.thumbnail ? (
                      <img
                        src={entry.thumbnail}
                        alt=""
                        className="size-10 rounded-lg object-cover bg-muted flex-shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                    ) : (
                      <div className="size-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                        <Package className="size-5 text-muted-foreground/40" />
                      </div>
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{entry.title || "Bez tytułu"}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="truncate">{entry.hostname}</span>
                        <span>·</span>
                        <span className="whitespace-nowrap">{formatRelativeTime(entry.scrapedAt)}</span>
                      </div>
                    </div>

                    {/* Delete */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        removeEntry(entry.url)
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all flex-shrink-0"
                      title="Usuń"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>

            {/* Footer */}
            <div className="border-t border-border px-4 py-2 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  clearHistory()
                  setIsOpen(false)
                }}
                className="text-xs text-muted-foreground hover:text-destructive gap-1.5"
              >
                <X className="size-3" />
                Wyczyść historię
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
