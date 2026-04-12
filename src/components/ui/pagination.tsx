"use client"

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react"
import { Button } from "./button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select"
import { cn } from "@/lib/utils"

interface PaginationControlsProps {
  currentPage: number
  totalPages: number
  itemsPerPage: number
  onPageChange: (page: number) => void
  onItemsPerPageChange: (count: number) => void
  totalItems: number
  className?: string
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

export function PaginationControls({
  currentPage,
  totalPages,
  itemsPerPage,
  onPageChange,
  onItemsPerPageChange,
  totalItems,
  className,
}: PaginationControlsProps) {
  const start = totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1
  const end = Math.min(currentPage * itemsPerPage, totalItems)

  // Build page numbers with ellipsis
  const pages: (number | "ellipsis-start" | "ellipsis-end")[] = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    pages.push(1)
    if (currentPage > 3) pages.push("ellipsis-start")
    const rangeStart = Math.max(2, currentPage - 1)
    const rangeEnd = Math.min(totalPages - 1, currentPage + 1)
    for (let i = rangeStart; i <= rangeEnd; i++) pages.push(i)
    if (currentPage < totalPages - 2) pages.push("ellipsis-end")
    pages.push(totalPages)
  }

  return (
    <div className={cn("flex items-center justify-between gap-4 text-sm", className)}>
      {/* Info */}
      <span className="text-muted-foreground text-xs shrink-0">
        {totalItems > 0
          ? `Wyświetlanie ${start}–${end} z ${totalItems}`
          : "Brak wyników"}
      </span>

      {/* Page buttons */}
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-xs"
          onClick={() => onPageChange(1)}
          disabled={currentPage <= 1}
          title="Pierwsza strona"
        >
          <ChevronsLeft className="size-3" />
        </Button>
        <Button
          variant="outline"
          size="icon-xs"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          title="Poprzednia"
        >
          <ChevronLeft className="size-3" />
        </Button>

        {pages.map((p, i) =>
          typeof p === "number" ? (
            <Button
              key={p}
              variant={p === currentPage ? "default" : "outline"}
              size="icon-xs"
              onClick={() => onPageChange(p)}
              className="min-w-[24px] text-xs"
            >
              {p}
            </Button>
          ) : (
            <span key={p + i} className="px-1 text-muted-foreground text-xs select-none">
              ...
            </span>
          )
        )}

        <Button
          variant="outline"
          size="icon-xs"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          title="Następna"
        >
          <ChevronRight className="size-3" />
        </Button>
        <Button
          variant="outline"
          size="icon-xs"
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage >= totalPages}
          title="Ostatnia strona"
        >
          <ChevronsRight className="size-3" />
        </Button>
      </div>

      {/* Items per page */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs text-muted-foreground">Na stronie:</span>
        <Select
          value={String(itemsPerPage)}
          onValueChange={(v) => onItemsPerPageChange(Number(v))}
        >
          <SelectTrigger className="h-7 w-[65px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
