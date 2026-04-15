"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, Plus, Play, Image as ImageIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { SellerScrapedListing } from "@/lib/types"

interface Props {
  listings: SellerScrapedListing[]
  groups: Record<string, string[]>
  onMoveToGroup: (listingIds: string[], groupName: string) => void
  onCreateGroup: (name: string) => void
  onListGroup: (groupName: string) => void
}

const UNGROUPED = 'Nieprzypisane'

export function GroupingView({ listings, groups, onMoveToGroup, onCreateGroup, onListGroup }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [moveTarget, setMoveTarget] = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  const [showNewGroup, setShowNewGroup] = useState(false)

  // Build display groups including ungrouped
  const listingById = Object.fromEntries(listings.map(l => [l.id, l]))

  const allGroupNames = [...Object.keys(groups).filter(g => g !== UNGROUPED), UNGROUPED]
  const ungroupedIds = listings
    .filter(l => !Object.values(groups).flat().includes(l.id))
    .map(l => l.id)

  const displayGroups = allGroupNames.map(name => ({
    name,
    ids: name === UNGROUPED ? ungroupedIds : (groups[name] ?? []),
  })).filter(g => g.ids.length > 0 || g.name !== UNGROUPED)

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const handleMove = () => {
    if (!moveTarget || selected.size === 0) return
    onMoveToGroup([...selected], moveTarget)
    setSelected(new Set())
    setMoveTarget('')
  }

  const handleCreateGroup = () => {
    if (!newGroupName.trim()) return
    onCreateGroup(newGroupName.trim())
    setExpanded(prev => ({ ...prev, [newGroupName.trim()]: true }))
    setNewGroupName('')
    setShowNewGroup(false)
  }

  return (
    <div className="space-y-3">
      {/* Move selected toolbar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 p-3 bg-muted/60 rounded-lg border border-border">
          <span className="text-sm text-muted-foreground">{selected.size} zaznaczonych</span>
          <span className="text-sm">→</span>
          <select
            value={moveTarget}
            onChange={e => setMoveTarget(e.target.value)}
            className="flex-1 text-sm border border-border rounded px-2 py-1 bg-background"
          >
            <option value="">Wybierz grupę...</option>
            {Object.keys(groups).map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          <Button size="sm" disabled={!moveTarget} onClick={handleMove}>Przenieś</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Anuluj</Button>
        </div>
      )}

      {/* Groups accordion */}
      {displayGroups.map(group => {
        const isOpen = expanded[group.name] !== false // default open
        const groupListings = group.ids.map(id => listingById[id]).filter(Boolean)

        return (
          <div key={group.name} className="border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => setExpanded(prev => ({ ...prev, [group.name]: !isOpen }))}
              className="w-full flex items-center gap-3 px-4 py-3 bg-muted/30 hover:bg-muted/60 transition-colors text-left"
            >
              {isOpen ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
              <span className="font-medium flex-1">
                {group.name}
                <span className="ml-2 text-sm text-muted-foreground font-normal">({groupListings.length})</span>
              </span>
              {group.name !== UNGROUPED && (
                <Button
                  size="sm"
                  onClick={e => { e.stopPropagation(); onListGroup(group.name) }}
                  className="shrink-0"
                >
                  <Play className="size-3.5 mr-1" /> Wystaw
                </Button>
              )}
            </button>

            {isOpen && (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 p-3">
                {groupListings.map(listing => (
                  <div
                    key={listing.id}
                    onClick={() => toggleSelect(listing.id)}
                    className={cn(
                      "rounded border cursor-pointer transition-all overflow-hidden",
                      selected.has(listing.id)
                        ? "border-primary ring-1 ring-primary bg-primary/5"
                        : "border-border hover:border-primary/40"
                    )}
                  >
                    <div className="aspect-square bg-muted overflow-hidden">
                      {listing.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={listing.thumbnailUrl} alt={listing.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="flex items-center justify-center h-full">
                          <ImageIcon className="size-5 text-muted-foreground/40" />
                        </div>
                      )}
                    </div>
                    <p className="text-xs p-1 line-clamp-2 leading-tight">{listing.title}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* New group input */}
      {showNewGroup ? (
        <div className="flex gap-2">
          <input
            autoFocus
            value={newGroupName}
            onChange={e => setNewGroupName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreateGroup(); if (e.key === 'Escape') setShowNewGroup(false) }}
            placeholder="Nazwa nowej grupy..."
            className="flex-1 text-sm border border-border rounded px-3 py-1.5 bg-background"
          />
          <Button size="sm" onClick={handleCreateGroup}>Utwórz</Button>
          <Button size="sm" variant="ghost" onClick={() => setShowNewGroup(false)}>Anuluj</Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setShowNewGroup(true)}>
          <Plus className="size-4 mr-1.5" /> Nowa grupa
        </Button>
      )}
    </div>
  )
}
