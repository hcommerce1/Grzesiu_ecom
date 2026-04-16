"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Send, Loader2, Bot, User, X, Sparkles, ArrowRight, Target } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { DescriptionSection, AllegroParameter, ImageMeta, ChatAction, TargetableSection } from "@/lib/types"

interface Message {
  role: "user" | "assistant"
  content: string
  actions?: ChatAction[]
  targetedSections?: TargetableSection[]
}

interface ClaudeChatProps {
  currentTitle: string
  onClose?: () => void
  className?: string
  style?: React.CSSProperties
  sections?: DescriptionSection[]
  currentParameters?: Record<string, string | string[]>
  imagesMeta?: ImageMeta[]
  allegroParameters?: AllegroParameter[]
  onTitleChange?: (title: string) => void
  onParameterChange?: (id: string, value: string | string[]) => void
  onSectionUpdate?: (sectionId: string, heading?: string, bodyHtml?: string) => void
  onSectionImageReorder?: (sectionId: string, imageUrls: string[]) => void
  onSectionRemove?: (sectionId: string) => void
  onSectionAdd?: (section: DescriptionSection, afterSectionId?: string) => void
  onSectionLayoutChange?: (sectionId: string, layout: 'image-text' | 'images-only' | 'text-only') => void
  onSectionsReorder?: (sectionIds: string[]) => void
  onSectionImageAdd?: (sectionId: string, imageUrl: string) => void
  onSectionImageRemove?: (sectionId: string, imageUrl: string) => void
  onRegenerateRequest?: () => void
  /** Auto-ask about unfilled parameters on mount */
  autoAskUnfilled?: boolean
  /** Product data for scraping context */
  productData?: { title: string; description: string; attributes: Record<string, string> }
  /** Section targeting */
  targetedSections?: TargetableSection[]
  onRemoveTargetedSection?: (id: string) => void
  onClearTargets?: () => void
  /** Stan techniczny produktu (N/PW/PZ/U) — tylko Sheets */
  stanTechniczny?: string
  /** Uwagi magazynowe — tylko Sheets */
  uwagi?: string
  /** Pełny kontekst produktu dla AI */
  originalDescription?: string
  price?: string
  currency?: string
  ean?: string
  sku?: string
  productUrl?: string
}

const ACTION_LABELS: Record<string, string> = {
  update_title: "Zmieniono tytuł",
  update_parameter: "Zmieniono parametr",
  update_section: "Zaktualizowano sekcję",
  expand_section: "Rozszerzono sekcję",
  regenerate_description: "Regeneracja opisu",
  request_scrape: "Scrapowanie strony",
  reorder_section_images: "Zmieniono zdjęcia w sekcji",
  add_image_to_section: "Dodano zdjęcie do sekcji",
  remove_image_from_section: "Usunięto zdjęcie z sekcji",
  remove_section: "Usunięto sekcję",
  add_section: "Dodano nową sekcję",
  change_section_layout: "Zmieniono layout sekcji",
  reorder_sections: "Zmieniono kolejność sekcji",
  clear_targets: "Wyczyszczono zaznaczenie",
}

export function ClaudeChat({
  currentTitle,
  onClose,
  className,
  style,
  sections,
  currentParameters,
  imagesMeta,
  allegroParameters,
  onTitleChange,
  onParameterChange,
  onSectionUpdate,
  onSectionImageReorder,
  onSectionRemove,
  onSectionAdd,
  onSectionLayoutChange,
  onSectionsReorder,
  onSectionImageAdd,
  onSectionImageRemove,
  onRegenerateRequest,
  autoAskUnfilled,
  // productData available via props for future use
  targetedSections,
  onRemoveTargetedSection,
  onClearTargets,
  stanTechniczny,
  uwagi,
  originalDescription,
  price,
  currency,
  ean,
  sku,
  productUrl,
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
    if (!autoAskUnfilled || hasAutoAsked.current) return
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
  }, [autoAskUnfilled, allegroParameters, currentParameters])


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
          case "add_image_to_section":
            if (action.sectionId && action.imageUrl) {
              onSectionImageAdd?.(action.sectionId, action.imageUrl)
            }
            break
          case "remove_image_from_section":
            if (action.sectionId && action.imageUrl) {
              onSectionImageRemove?.(action.sectionId, action.imageUrl)
            }
            break
          case "remove_section":
            if (action.sectionId) {
              onSectionRemove?.(action.sectionId)
            }
            break
          case "add_section":
            if (action.heading) {
              onSectionAdd?.(
                {
                  id: `section-${crypto.randomUUID().slice(0, 8)}`,
                  heading: action.heading,
                  bodyHtml: action.bodyHtml || '',
                  layout: action.layout || 'image-text',
                  imageUrls: action.imageUrls || [],
                },
                action.afterSectionId,
              )
            }
            break
          case "change_section_layout":
            if (action.sectionId && action.layout) {
              onSectionLayoutChange?.(action.sectionId, action.layout)
            }
            break
          case "reorder_sections":
            if (action.sectionIds?.length) {
              onSectionsReorder?.(action.sectionIds)
            }
            break
          case "clear_targets":
            onClearTargets?.()
            break
        }
      }
    },
    [onTitleChange, onParameterChange, onSectionUpdate, onSectionImageReorder, onSectionRemove, onSectionAdd, onSectionLayoutChange, onSectionsReorder, onSectionImageAdd, onSectionImageRemove, onRegenerateRequest, onClearTargets, handleScrapeAndFill],
  )

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || loading) return

    // Capture targeted sections before clearing
    const currentTargets = targetedSections?.length ? [...targetedSections] : undefined

    const userMessage: Message = {
      role: "user",
      content: text,
      targetedSections: currentTargets,
    }
    setMessages((prev) => [...prev, userMessage])
    setInput("")
    onClearTargets?.()
    setLoading(true)

    // Build message with targeting context
    let messageToSend = text
    if (currentTargets?.length) {
      const labels = currentTargets.map(s => s.label).join(', ')
      messageToSend = `[Dotyczy: ${labels}]\n${text}`
    }

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }))
        const res = await fetch("/api/description-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: messageToSend,
            currentTitle,
            sections,
            currentParameters: currentParameters || {},
            imagesMeta: (imagesMeta || []).filter(i => !i.removed),
            allegroParameters,
            conversationHistory: history,
            stanTechniczny,
            uwagi,
            originalDescription,
            price,
            currency,
            ean,
            sku,
            productUrl,
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
    } catch (e: unknown) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Błąd: ${e instanceof Error ? e.message : "Nieznany błąd"}` },
      ])
    } finally {
      setLoading(false)
    }
  }

  const placeholderExamples = '„Zmień wagę na 6 kg", „Rozwiń opis pod zdjęciem 3", „Zmień tytuł"'
  const subtitleText = "Edytuje opis, parametry, tytuł"

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
              {/* Targeted sections badges on user messages */}
              {msg.role === "user" && msg.targetedSections && msg.targetedSections.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1.5 pb-1.5 border-b border-primary-foreground/20">
                  {msg.targetedSections.map(s => (
                    <span key={s.id} className="inline-flex items-center gap-0.5 rounded bg-primary-foreground/20 px-1.5 py-0.5 text-[10px] font-medium">
                      {s.label}
                    </span>
                  ))}
                </div>
              )}
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

      {/* Targeted sections pills */}
      {targetedSections && targetedSections.length > 0 && (
        <div className="px-3 py-2 flex flex-wrap items-center gap-1.5 border-t bg-primary/5">
          <Target className="size-3 text-primary shrink-0" />
          <span className="text-[10px] text-primary font-medium mr-0.5">Dotyczy:</span>
          {targetedSections.map(s => (
            <Badge key={s.id} variant="secondary" className="gap-1 text-[10px] pr-1 bg-primary/10 text-primary border-primary/20">
              {s.label}
              <button
                onClick={() => onRemoveTargetedSection?.(s.id)}
                className="ml-0.5 rounded-full hover:bg-primary/20 p-0.5"
              >
                <X className="size-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Input */}
      <div className={cn("p-3 flex gap-2", (!targetedSections || targetedSections.length === 0) && "border-t")}>
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
