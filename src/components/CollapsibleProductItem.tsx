"use client"

import { useState, useEffect, useRef } from "react"
import { ChevronDown, ChevronUp, CheckCircle2, XCircle, Loader2, Clock, Trash2 } from "lucide-react"
import { ProductDisplay } from "./ProductDisplay"
import { BaselinkerWorkflowPanel } from "./BaselinkerWorkflowPanel"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"
import type { ProductData } from "@/lib/types"

export type ScrapedItemStatus = "pending" | "loading" | "success" | "error"

export interface ScrapedItem {
  id: string
  url: string
  status: ScrapedItemStatus
  product?: ProductData
  originalProduct?: ProductData | null
  error?: string
}

interface Props {
  item: ScrapedItem
  index: number
  onRemove?: (id: string) => void
}

function getHostname(url: string) {
  try { return new URL(url).hostname.replace("www.", "") } catch { return url }
}

const statusConfig = {
  pending: { icon: <Clock className="size-3.5 text-muted-foreground" />, label: "Oczekuje", variant: "outline" as const },
  loading: { icon: <Loader2 className="size-3.5 text-primary animate-spin" />, label: "Scrapuję...", variant: "secondary" as const },
  success: { icon: <CheckCircle2 className="size-3.5 text-green-600" />, label: "Gotowe", variant: "success" as const },
  error: { icon: <XCircle className="size-3.5 text-destructive" />, label: "Błąd", variant: "destructive" as const },
}

export function CollapsibleProductItem({ item, index, onRemove }: Props) {
  const [isOpen, setIsOpen] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => { if (confirmTimer.current) clearTimeout(confirmTimer.current) }
  }, [])

  const hasData = item.status === "success" && item.product
  const canExpand = hasData || item.status === "error"
  const status = statusConfig[item.status]

  return (
    <div className={cn(
      "rounded-xl ring-1 ring-foreground/10 bg-card overflow-hidden transition-shadow",
      isOpen && "shadow-sm"
    )}>
      {/* Header */}
      <div
        className={cn(
          "flex items-center gap-3 px-4 py-3 select-none transition-colors",
          canExpand ? "cursor-pointer hover:bg-muted/50" : "cursor-default",
          isOpen && "bg-muted/30"
        )}
        onClick={() => canExpand && setIsOpen((v) => !v)}
      >
        {/* Index */}
        <span className="text-xs text-muted-foreground w-5 text-right shrink-0">{index + 1}</span>

        {/* Thumbnail */}
        {hasData && item.product?.images?.[0] ? (
          <img
            src={item.product.images[0]}
            alt=""
            className="size-10 rounded-lg object-cover border border-border shrink-0"
          />
        ) : (
          <div className="size-10 rounded-lg bg-muted border border-border flex items-center justify-center shrink-0">
            {status.icon}
          </div>
        )}

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate leading-snug">
            {hasData ? item.product!.title : getHostname(item.url)}
          </p>
          <p className="text-xs text-muted-foreground truncate">{item.url}</p>
        </div>

        {/* Price */}
        {hasData && item.product?.price && (
          <span className="hidden sm:block text-sm font-semibold shrink-0 text-foreground">
            {item.product.price} {item.product.currency}
          </span>
        )}

        {/* Status badge */}
        <Badge variant={status.variant} className="shrink-0 hidden xs:flex items-center gap-1">
          {status.icon}
          {status.label}
        </Badge>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          {onRemove && (
            confirmDelete ? (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  if (confirmTimer.current) clearTimeout(confirmTimer.current)
                  setConfirmDelete(false)
                  onRemove(item.id)
                }}
                className="gap-1 text-xs animate-pulse"
              >
                <Trash2 className="size-3.5" />
                Na pewno?
              </Button>
            ) : (
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => {
                  setConfirmDelete(true)
                  if (confirmTimer.current) clearTimeout(confirmTimer.current)
                  confirmTimer.current = setTimeout(() => setConfirmDelete(false), 3000)
                }}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </Button>
            )
          )}
        </div>

        {/* Chevron */}
        {canExpand && (
          <ChevronDown
            className={cn("size-4 text-muted-foreground transition-transform shrink-0", isOpen && "rotate-180")}
          />
        )}
      </div>

      {/* Expanded */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border p-4 space-y-4 bg-background/60">
              {item.status === "error" && (
                <div className="text-sm text-destructive bg-destructive/10 px-4 py-3 rounded-lg border border-destructive/20">
                  {item.error || "Nieznany błąd podczas scrapowania"}
                </div>
              )}
              {hasData && (
                <ProductDisplay product={item.product!} originalProduct={item.originalProduct} />
              )}
              {hasData && (
                <BaselinkerWorkflowPanel
                  productData={item.product!}
                  onClose={() => setIsOpen(false)}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
