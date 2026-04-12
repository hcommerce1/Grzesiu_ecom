"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Send, Loader2, Bot, User, X, Sparkles, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { DescriptionSection, AllegroParameter, ImageMeta, ChatAction } from "@/lib/types"

interface Message {
  role: "user" | "assistant"
  content: string
  actions?: ChatAction[]
}

interface ChatResult {
  title?: string
  description?: string
}

interface ClaudeChatProps {
  currentTitle: string
  currentDescription: string
  currentImages?: string[]
  onUpdate: (result: ChatResult) => void
  onClose?: () => void
  className?: string
  style?: React.CSSProperties
  // Nowe propsy dla trybu opisu strukturalnego
  mode?: "simple" | "description"
  sections?: DescriptionSection[]
  currentParameters?: Record<string, string | string[]>
  imagesMeta?: ImageMeta[]
  allegroParameters?: AllegroParameter[]
  onTitleChange?: (title: string) => void
  onParameterChange?: (id: string, value: string | string[]) => void
  onSectionUpdate?: (sectionId: string, heading?: string, bodyHtml?: string) => void
  onSectionImageReorder?: (sectionId: string, imageUrls: string[]) => void
  onRegenerateRequest?: () => void
  /** Auto-ask about unfilled parameters on mount */
  autoAskUnfilled?: boolean
  /** Product data for scraping context */
  productData?: { title: string; description: string; attributes: Record<string, string> }
}

const ACTION_LABELS: Record<string, string> = {
  update_title: "Zmieniono tytuł",
  update_parameter: "Zmieniono parametr",
  update_section: "Zaktualizowano sekcję",
  expand_section: "Rozszerzono sekcję",
  regenerate_description: "Regeneracja opisu",
  request_scrape: "Scrapowanie strony",
  reorder_section_images: "Zmieniono zdjęcia w sekcji",
}

export function ClaudeChat({
  currentTitle,
  currentDescription,
  currentImages = [],
  onUpdate,
  onClose,
  className,
  style,
  // Nowe
  mode = "simple",
  sections,
  currentParameters,
  imagesMeta,
  allegroParameters,
  onTitleChange,
  onParameterChange,
  onSectionUpdate,
  onSectionImageReorder,
  onRegenerateRequest,
  autoAskUnfilled,
  // productData available via props for future use
}: ClaudeChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Auto-ask about unfilled parameters on mount
  const hasAutoAsked = useRef(false)
  useEffect(() => {
    if (!autoAskUnfilled || hasAutoAsked.current || mode !== "description") return
    if (!allegroParameters?.length) return

    const unfilled = allegroParameters.filter(
      (p) => !currentParameters?.[p.id],
    )
    const unfilledRequired = unfilled.filter((p) => p.required)
    const unfilledOptional = unfilled.filter((p) => !p.required)

    if (unfilledRequired.length === 0 && unfilledOptional.length === 0) return

    hasAutoAsked.current = true

    const formatParam = (p: AllegroParameter) => {
      const opts = p.options ?? p.restrictions?.allowedValues ?? []
      let line = `**${p.name}** (${p.type}${p.unit ? ', ' + p.unit : ''})`
      if (opts.length > 0) {
        const displayOpts = opts.slice(0, 8)
        line += ` — opcje: ${displayOpts.map((o) => o.value).join(', ')}`
        if (opts.length > 8) line += `, ... (+${opts.length - 8})`
      }
      return line
    }

    let msg = 'Nie udało mi się automatycznie uzupełnić następujących parametrów:\n\n'

    if (unfilledRequired.length > 0) {
      msg += '**Wymagane:**\n'
      msg += unfilledRequired.map((p, i) => `${i + 1}. ${formatParam(p)}`).join('\n')
      msg += '\n\n'
    }

    if (unfilledOptional.length > 0) {
      msg += '**Opcjonalne:**\n'
      msg += unfilledOptional.map((p, i) => `${i + 1}. ${formatParam(p)}`).join('\n')
      msg += '\n\n'
    }

    msg += 'Podaj wartość dla każdego parametru, napisz "pomiń" jeśli nie chcesz go uzupełniać, lub wklej link do strony z danymi produktu.'

    setMessages([{ role: "assistant", content: msg }])
  }, [autoAskUnfilled, mode, allegroParameters, currentParameters])

  const isDescriptionMode = mode === "description" && sections

  const handleScrapeAndFill = useCallback(
    async (url: string) => {
      setMessages(prev => [...prev, { role: "assistant", content: `Scrapuję stronę: ${url}...` }])
      setLoading(true)

      try {
        // 1. Scrape the URL
        const scrapeRes = await fetch("/api/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        })
        const scrapeData = await scrapeRes.json()

        if (!scrapeData.success) {
          setMessages(prev => [...prev, {
            role: "assistant",
            content: `Nie udało się zescrapować strony: ${scrapeData.error || "Nieznany błąd"}. Spróbuj podać dane ręcznie.`,
          }])
          return
        }

        // 2. Get unfilled params
        const unfilledParams = (allegroParameters || []).filter(
          p => !currentParameters?.[p.id]
        )

        if (unfilledParams.length === 0) {
          setMessages(prev => [...prev, {
            role: "assistant",
            content: "Wszystkie parametry są już uzupełnione.",
          }])
          return
        }

        // 3. AI auto-fill with new data
        const fillRes = await fetch("/api/ai-autofill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productData: scrapeData.data,
            parameters: unfilledParams,
            alreadyFilled: currentParameters || {},
          }),
        })
        const fillData = await fillRes.json()

        if (fillData.error) {
          setMessages(prev => [...prev, {
            role: "assistant",
            content: `Pobrano dane ze strony, ale nie udało się dopasować parametrów: ${fillData.error}`,
          }])
          return
        }

        // 4. Apply filled parameters
        const filledEntries = fillData.details || []
        if (filledEntries.length > 0) {
          for (const entry of filledEntries) {
            onParameterChange?.(entry.parameterId, entry.value)
          }

          const paramNames = filledEntries.map((e: { parameterId: string }) => {
            const p = (allegroParameters || []).find(ap => ap.id === e.parameterId)
            return p?.name || e.parameterId
          })

          setMessages(prev => [...prev, {
            role: "assistant",
            content: `Ze strony udało się uzupełnić ${filledEntries.length} parametrów:\n${paramNames.map((n: string) => `- ${n}`).join('\n')}`,
          }])
        } else {
          setMessages(prev => [...prev, {
            role: "assistant",
            content: "Pobrano dane ze strony, ale nie znaleziono pasujących wartości dla brakujących parametrów.",
          }])
        }
      } catch {
        setMessages(prev => [...prev, {
          role: "assistant",
          content: "Wystąpił błąd podczas scrapowania strony. Spróbuj ponownie lub podaj dane ręcznie.",
        }])
      } finally {
        setLoading(false)
      }
    },
    [allegroParameters, currentParameters, onParameterChange],
  )

  const applyActions = useCallback(
    (actions: ChatAction[]) => {
      for (const action of actions) {
        switch (action.type) {
          case "update_title":
            if (action.title) {
              onTitleChange?.(action.title)
              onUpdate({ title: action.title })
            }
            break
          case "update_parameter":
            if (action.parameterId && action.parameterValue !== undefined) {
              onParameterChange?.(action.parameterId, action.parameterValue)
            }
            break
          case "update_section":
          case "expand_section":
            if (action.sectionId) {
              onSectionUpdate?.(action.sectionId, action.heading, action.bodyHtml)
            }
            break
          case "regenerate_description":
            onRegenerateRequest?.()
            break
          case "request_scrape":
            if (action.scrapeUrl) {
              handleScrapeAndFill(action.scrapeUrl)
            }
            break
          case "reorder_section_images":
            if (action.sectionId && action.imageUrls) {
              onSectionImageReorder?.(action.sectionId, action.imageUrls)
            }
            break
        }
      }
    },
    [onTitleChange, onParameterChange, onSectionUpdate, onSectionImageReorder, onRegenerateRequest, onUpdate, handleScrapeAndFill],
  )

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMessage: Message = { role: "user", content: text }
    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setLoading(true)

    try {
      if (isDescriptionMode) {
        // Tryb opisu strukturalnego - nowy endpoint
        const history = messages.map(m => ({ role: m.role, content: m.content }))
        const res = await fetch("/api/description-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            currentTitle,
            sections,
            currentParameters: currentParameters || {},
            imagesMeta: (imagesMeta || []).filter(i => !i.removed),
            allegroParameters,
            conversationHistory: history,
          }),
        })

        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Błąd odpowiedzi")

        const actions: ChatAction[] = data.actions || []
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.message || "Wykonano.", actions },
        ])

        if (actions.length) {
          applyActions(actions)
        }
      } else {
        // Tryb prosty - stary endpoint (fallback)
        const res = await fetch("/api/claude-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            currentTitle,
            currentDescription,
            currentImages,
          }),
        })

        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Błąd odpowiedzi")

        const assistantContent = data.message || "Zaktualizowałem dane produktu."
        setMessages((prev) => [...prev, { role: "assistant", content: assistantContent }])

        if (data.title || data.description) {
          onUpdate({ title: data.title, description: data.description })
        }
      }
    } catch (e: unknown) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Błąd: ${e instanceof Error ? e.message : "Nieznany błąd"}` },
      ])
    } finally {
      setLoading(false)
    }
  }

  const placeholderExamples = isDescriptionMode
    ? '„Zmień wagę na 6 kg", „Rozwiń opis pod zdjęciem 3", „Zmień tytuł"'
    : '„Skróć opis", „Dodaj więcej emocji w tytule", „Zmień styl na bardziej formalny"'

  const subtitleText = isDescriptionMode
    ? "Edytuje opis, parametry, tytuł"
    : "Edytuje tytuł i opis"

  return (
    <div className={cn("flex flex-col bg-card rounded-xl ring-1 ring-foreground/10 overflow-hidden", className)} style={style}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <Sparkles className="size-4 text-primary shrink-0" />
        <span className="font-medium text-sm flex-1">Asystent AI</span>
        <span className="text-xs text-muted-foreground hidden sm:inline">{subtitleText}</span>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3" style={{ minHeight: '200px' }}>
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-8 text-muted-foreground">
            <Bot className="size-8 mb-2 opacity-40" />
            <p className="text-sm font-medium">Powiedz mi co zmienić</p>
            <p className="text-xs mt-1 opacity-70">np. {placeholderExamples}</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={cn("flex gap-2.5", msg.role === "user" ? "justify-end" : "justify-start")}>
            {msg.role === "assistant" && (
              <div className="size-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="size-3.5 text-primary" />
              </div>
            )}
            <div
              className={cn(
                "max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed",
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground"
              )}
            >
              <span className="whitespace-pre-wrap">{msg.content}</span>
              {/* Wykonane akcje */}
              {msg.actions && msg.actions.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-foreground/10">
                  {msg.actions.map((a, j) => (
                    <Badge key={j} variant="secondary" className="text-[10px] gap-1">
                      <ArrowRight className="size-2.5" />
                      {ACTION_LABELS[a.type] || a.type}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            {msg.role === "user" && (
              <div className="size-7 rounded-full bg-secondary flex items-center justify-center shrink-0 mt-0.5">
                <User className="size-3.5 text-secondary-foreground" />
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex gap-2.5">
            <div className="size-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Bot className="size-3.5 text-primary" />
            </div>
            <div className="bg-muted rounded-xl px-3 py-2">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="border-t p-3 flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              sendMessage()
            }
          }}
          placeholder="Napisz polecenie... (Enter aby wysłać)"
          rows={2}
          disabled={loading}
          className="flex-1 resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:opacity-60 placeholder:text-muted-foreground"
        />
        <Button
          size="icon-sm"
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          className="self-end size-9"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </div>
    </div>
  )
}
