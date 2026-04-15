"use client"

import { useState } from "react"
import { CheckSquare, Square, Image as ImageIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { SellerScrapedListing } from "@/lib/types"

interface Props {
  listings: SellerScrapedListing[]
  onToggle: (id: string) => void
  onSelectAll: (selected: boolean) => void
  onNext: () => void
}

export function SellerProductGrid({ listings, onToggle, onSelectAll, onNext }: Props) {
  const selectedCount = listings.filter(l => l.selected).length

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => onSelectAll(true)}>
          <CheckSquare className="size-4 mr-1.5" /> Wszystkie
        </Button>
        <Button variant="outline" size="sm" onClick={() => onSelectAll(false)}>
          <Square className="size-4 mr-1.5" /> Odznacz
        </Button>
        <span className="text-sm text-muted-foreground">
          {selectedCount} z {listings.length} zaznaczonych
        </span>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {listings.map(listing => (
          <div
            key={listing.id}
            onClick={() => onToggle(listing.id)}
            className={cn(
              "relative rounded-lg border cursor-pointer transition-all overflow-hidden",
              listing.selected
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "border-border hover:border-primary/40"
            )}
          >
            {/* Checkbox */}
            <div className={cn(
              "absolute top-1.5 left-1.5 size-5 rounded flex items-center justify-center z-10",
              listing.selected ? "bg-primary text-primary-foreground" : "bg-background border border-border"
            )}>
              {listing.selected && <CheckSquare className="size-3.5" />}
            </div>

            {/* Thumbnail */}
            <div className="aspect-square bg-muted flex items-center justify-center overflow-hidden">
              {listing.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={listing.thumbnailUrl}
                  alt={listing.title}
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              ) : (
                <ImageIcon className="size-8 text-muted-foreground/40" />
              )}
            </div>

            {/* Info */}
            <div className="p-2">
              <p className="text-xs font-medium line-clamp-2 leading-tight">{listing.title}</p>
              {listing.price && (
                <p className="text-xs text-muted-foreground mt-1">{listing.price} {listing.currency}</p>
              )}
              {listing.deepScraped && (
                <span className="text-xs text-green-600">✓ Deep scraped</span>
              )}
              {listing.deepScrapeError && (
                <span className="text-xs text-destructive">✗ Błąd</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Next button */}
      <div className="flex justify-end pt-2">
        <Button onClick={onNext} disabled={selectedCount === 0}>
          Dalej: Deep scrape {selectedCount > 0 ? `${selectedCount} zaznaczonych` : ''}
        </Button>
      </div>
    </div>
  )
}
