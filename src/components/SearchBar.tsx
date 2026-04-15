"use client"

import { useRef, useState } from "react"
import { ArrowRight, Clipboard, Loader2, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface SearchBarProps {
  onSubmit: (urls: string[]) => void
  isLoading: boolean
}

export function SearchBar({ onSubmit, isLoading }: SearchBarProps) {
  const [value, setValue] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const parseUrls = (text: string): string[] =>
    text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && (l.startsWith("http://") || l.startsWith("https://")))

  const handleSubmit = () => {
    const urls = parseUrls(value)
    if (urls.length === 0) return
    onSubmit(urls)
    if (isLoading) setValue("")
  }

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      setValue((prev) => {
        const merged = prev ? `${prev.trimEnd()}\n${text.trim()}` : text.trim()
        return merged
      })
      textareaRef.current?.focus()
    } catch {
      textareaRef.current?.focus()
    }
  }

  const urlCount = parseUrls(value).length

  return (
    <div className="w-full space-y-3">
      <div
        className={cn(
          "relative rounded-xl border bg-background shadow-sm transition-all",
          "border-input focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20"
        )}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              handleSubmit()
            }
          }}
          rows={isLoading ? 3 : 5}
          className={cn(
            "w-full resize-none rounded-xl bg-transparent px-4 py-3 text-sm outline-none leading-relaxed",
            "placeholder:text-muted-foreground"
          )}
          placeholder={isLoading
            ? "Wklej dodatkowe linki i kliknij 'Dodaj do kolejki'..."
            : "Wklej linki do produktów — jeden na linię:\nhttps://amazon.de/dp/B0...\nhttps://www.oninen.pl/listwy-zasilajace/...\nhttps://www.costway.pl/..."}
        />
        {value && (
          <button
            onClick={() => setValue("")}
            className="absolute top-2.5 right-2.5 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={handlePaste}
          className="gap-1.5"
        >
          <Clipboard className="size-3.5" />
          Wklej ze schowka
        </Button>

        <div className="flex-1" />

        {urlCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {urlCount} {urlCount === 1 ? "link" : urlCount < 5 ? "linki" : "linków"}
          </span>
        )}

        <Button
          type="button"
          onClick={handleSubmit}
          disabled={urlCount === 0}
          className="gap-1.5 min-w-[120px]"
        >
          {isLoading ? (
            <>
              <Plus className="size-4" />
              Dodaj do kolejki
            </>
          ) : (
            <>
              Scrapuj
              <ArrowRight className="size-4" />
            </>
          )}
        </Button>
      </div>

    </div>
  )
}
