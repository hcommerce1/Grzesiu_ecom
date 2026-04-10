"use client"

import { useState, useEffect } from "react"
import { Settings, X, RotateCcw, Package2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Portal } from "@/components/ui/portal"
import { AnimatePresence, motion } from "framer-motion"
import { cn } from "@/lib/utils"

const STORAGE_KEY = "ecom-scraper-system-prompt"

interface AppHeaderProps {
  onPromptChange: (prompt: string) => void
}

export function AppHeader({ onPromptChange }: AppHeaderProps) {
  const [promptOpen, setPromptOpen] = useState(false)
  const [prompt, setPrompt] = useState("")

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      setPrompt(saved)
      onPromptChange(saved)
    }
  }, [onPromptChange])

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, prompt)
    onPromptChange(prompt)
    setPromptOpen(false)
  }

  const handleReset = () => {
    setPrompt("")
    localStorage.removeItem(STORAGE_KEY)
    onPromptChange("")
  }

  return (
    <>
      <header className="sticky top-0 z-40 h-14 border-b bg-card flex items-center px-4 gap-3">
        <div className="flex items-center gap-2 flex-1">
          <Package2 className="size-5 text-primary shrink-0" />
          <span className="font-semibold text-sm">Menedżer ofert</span>
          <span className="hidden sm:inline text-xs text-muted-foreground">Allegro / BaseLinker</span>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setPromptOpen(true)}
          className="gap-1.5"
        >
          <Settings className="size-3.5" />
          <span className="hidden sm:inline">Prompt AI</span>
        </Button>
      </header>

      <Portal>
        <AnimatePresence>
          {promptOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
              onClick={() => setPromptOpen(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-card border rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-5 py-4 border-b">
                  <div>
                    <h3 className="font-semibold text-sm">Prompt systemowy AI</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Nadpisuje domyślny prompt do generowania opisów przez LLM
                    </p>
                  </div>
                  <button
                    onClick={() => setPromptOpen(false)}
                    className="p-2 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
                  >
                    <X className="size-4" />
                  </button>
                </div>

                <div className="flex-1 overflow-auto p-5">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={20}
                    className={cn(
                      "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm font-mono leading-relaxed",
                      "outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20",
                      "resize-y placeholder:text-muted-foreground"
                    )}
                    placeholder="Zostaw puste, aby używać domyślnego prompta Allegro zdefiniowanego w translator.ts.&#10;&#10;Wpisz własny prompt, aby go nadpisać."
                  />
                </div>

                <div className="flex items-center justify-between px-5 py-4 border-t">
                  <button
                    onClick={handleReset}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <RotateCcw className="size-3" />
                    Przywróć domyślny
                  </button>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPromptOpen(false)}>
                      Anuluj
                    </Button>
                    <Button size="sm" onClick={handleSave}>
                      Zapisz prompt
                    </Button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </Portal>
    </>
  )
}
