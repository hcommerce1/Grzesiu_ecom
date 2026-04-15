"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { DiffFieldInfo } from "@/lib/types"

interface Props {
  groupName: string
  diffFields: DiffFieldInfo[]
  selectedFields: string[]
  onToggle: (field: string) => void
  onNext: () => void
}

export function DiffFieldsStep({ groupName, diffFields, selectedFields, onToggle, onNext }: Props) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">Różnicujące pola — {groupName}</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Zaznacz pola, które różnią się między produktami. Zostaną podmienione z danych każdego wariantu.
        </p>
      </div>

      <div className="space-y-1.5">
        {diffFields.map(field => {
          const isSelected = selectedFields.includes(field.field)
          return (
            <button
              key={field.field}
              onClick={() => onToggle(field.field)}
              className={cn(
                "w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors",
                isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
              )}
            >
              <div className={cn(
                "size-5 rounded border mt-0.5 shrink-0 flex items-center justify-center",
                isSelected ? "bg-primary border-primary text-primary-foreground" : "border-border"
              )}>
                {isSelected && <span className="text-xs">✓</span>}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{field.label}</span>
                  {field.isDiff ? (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">diff</span>
                  ) : (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">same</span>
                  )}
                  <span className="text-xs text-muted-foreground ml-auto">
                    {field.totalUnique} unikat. · {Math.round(field.coverage * 100)}% pokrycia
                  </span>
                </div>
                {field.uniqueValues.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    → {field.uniqueValues.slice(0, 5).join(', ')}{field.totalUnique > 5 ? '...' : ''}
                  </p>
                )}
              </div>
            </button>
          )
        })}
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={onNext} disabled={selectedFields.length === 0}>
          Dalej: Konfiguruj template ({selectedFields.length} pól)
        </Button>
      </div>
    </div>
  )
}
