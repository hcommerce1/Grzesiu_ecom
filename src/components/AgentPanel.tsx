"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Bot, CheckCircle2, XCircle, Loader2, Send, Square } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ProductSession, ImageMeta, DescriptionSection, ChatAction, DescriptionInputSnapshot } from "@/lib/types"
import type { Step } from "./BaselinkerWorkflowPanel"

interface ToolStep {
  name: string
  label: string
  status: "running" | "done" | "error"
  summary?: string
}

interface Message {
  role: "user" | "assistant"
  content: string
}

interface CategorySuggestion {
  id: string
  name: string
  path: string
  commission: string | null
}

const STEP_LABEL_MAP: Record<Step, string> = {
  inventory: "Magazyn",
  category: "Kategoria",
  images: "Zdjęcia",
  "fields-params": "Parametry",
  preview: "Podgląd",
  approval: "Wyślij",
}

// Konkretne instrukcje per zakładka — zamiast vague "wykonaj odpowiednie działanie".
// Cel: agent wie dokładnie który tool wywołać, bez halucynacji.
const NOTE_BY_STEP: Record<Step, string> = {
  inventory: "Powiedz krótkim zdaniem że user wybiera produkt z listy w UI, potem przejdzie na zakładkę Kategoria. Zakończ turę.",
  category: "Wywołaj suggest_category teraz na podstawie tytułu i atrybutów produktu.",
  images: "Wywołaj analyze_images z URL-ami zdjęć z sesji (state.session.data.images).",
  "fields-params": "Jeśli params nie pobrane (state.allegroParams puste) → wywołaj fetch_category_parameters. W przeciwnym wypadku fill_parameters → validate_parameters.",
  preview: "Jeśli tytuł nie wygenerowany → generate_title. Następnie generate_description. Jeśli oba już są — czekaj na komendy edycji od usera.",
  approval: "Powiedz krótkim zdaniem że user klika Wyślij w UI. Zakończ turę.",
}

interface AgentPanelProps {
  session: ProductSession | null
  imagesMeta: ImageMeta[]
  productId: string
  currentStep?: Step
  onSessionPatch: (patch: Partial<ProductSession>) => void
  onImagesAnalyzed: (meta: ImageMeta[]) => void
  onTitleGenerated: (title: string, candidates: string[]) => void
  onDescriptionGenerated: (sections: DescriptionSection[], fullHtml: string, inputSnapshot?: DescriptionInputSnapshot) => void
  onAction: (action: ChatAction) => void
  className?: string
}

export function AgentPanel({
  session,
  imagesMeta,
  productId,
  currentStep,
  onSessionPatch,
  onImagesAnalyzed,
  onTitleGenerated,
  onDescriptionGenerated,
  onAction,
  className,
}: AgentPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [steps, setSteps] = useState<ToolStep[]>([])
  const [input, setInput] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const [started, setStarted] = useState(false)
  const [totalCost, setTotalCost] = useState<{ pln: number; tokens: number } | null>(null)
  const [categoryGate, setCategoryGate] = useState<{ suggestions: CategorySuggestion[]; awaiting: boolean } | null>(null)
  const [manualCategoryQuery, setManualCategoryQuery] = useState("")
  const [manualCategoryResults, setManualCategoryResults] = useState<CategorySuggestion[] | null>(null)
  const [manualCategoryLoading, setManualCategoryLoading] = useState(false)
  const [sessionKey] = useState(() => crypto.randomUUID())

  const conversationHistory = useRef<Message[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const stepsEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastNotifiedStep = useRef<Step | undefined>(undefined)
  const lastNotifiedCategoryId = useRef<string | undefined>(undefined)
  // S: kolejka notyfikacji zamiast single string — szybkie klikanie nie nadpisuje starych.
  // Q: dedupe identycznych — jeśli ten sam tekst już jest w kolejce, nie dodawaj.
  const pendingNotifications = useRef<string[]>([])
  const lastSentNote = useRef<string>('')
  const notifyDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  // N: hard-block przed równoczesnym start — `started` to React state (asynchroniczne),
  // ten ref blokuje natychmiast (przed zaplanowanym setStarted).
  const startInFlight = useRef(false)

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Auto-start when product data arrives
  useEffect(() => {
    if (started || startInFlight.current) return
    if (!session?.data?.title) return
    startInFlight.current = true
    setStarted(true)
    lastNotifiedStep.current = currentStep
    lastNotifiedCategoryId.current = session?.allegroCategory?.id
    sendMessage("", "start")
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.data?.title])

  const enqueueNotification = (note: string) => {
    if (note === lastSentNote.current) return // Q: identyczne ostatnio wysłane → skip
    if (pendingNotifications.current[pendingNotifications.current.length - 1] === note) return
    pendingNotifications.current.push(note)
    if (notifyDebounce.current) clearTimeout(notifyDebounce.current)
    notifyDebounce.current = setTimeout(() => {
      notifyDebounce.current = null
      flushNotifications()
    }, 800) // Q: debounce 800ms — szybkie klikanie zlewa się w jedną notyfikację
  }

  const flushNotifications = () => {
    if (isStreaming) return // czekamy aż useEffect na isStreaming odpali ponownie
    if (pendingNotifications.current.length === 0) return
    const combined = pendingNotifications.current.join('\n\n')
    pendingNotifications.current = []
    if (combined === lastSentNote.current) return
    lastSentNote.current = combined
    sendMessage(combined, "chat")
  }

  // Auto-notify agent gdy user zmieni zakładkę (po starcie)
  useEffect(() => {
    if (!started || !currentStep) return
    if (lastNotifiedStep.current === currentStep) return
    lastNotifiedStep.current = currentStep
    enqueueNotification(`[SYSTEM] User przeszedł na zakładkę "${STEP_LABEL_MAP[currentStep]}". ${NOTE_BY_STEP[currentStep]}`)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, started])

  // Auto-notify agent gdy user (lub UI) zmieni kategorię
  useEffect(() => {
    if (!started) return
    const cid = session?.allegroCategory?.id
    if (!cid) return
    if (lastNotifiedCategoryId.current === cid) return
    lastNotifiedCategoryId.current = cid
    const path = session?.allegroCategory?.path ?? ''
    const name = session?.allegroCategory?.name ?? ''
    enqueueNotification(`[SYSTEM] User wybrał kategorię Allegro: "${name}" (id=${cid}, ścieżka: ${path}). Jeśli jesteś na zakładce Parametry — wywołaj fetch_category_parameters z tym categoryId.`)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.allegroCategory?.id, started])

  // Po zakończeniu streamingu — opróżnij kolejkę zaległych notyfikacji
  useEffect(() => {
    if (!isStreaming) {
      startInFlight.current = false
      // małe opóźnienie żeby React zdążył zaaplikować ostatnie SSE patche przed wysłaniem nowego POST
      const t = setTimeout(() => flushNotifications(), 50)
      return () => clearTimeout(t)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming])

  const sendMessage = useCallback(
    async (text: string, mode: "start" | "chat" = "chat", sessionOverride?: ProductSession) => {
      if (isStreaming) return
      const activeSession = sessionOverride ?? session
      if (!activeSession) return

      if (text.trim()) {
        const userMsg: Message = { role: "user", content: text.trim() }
        conversationHistory.current.push(userMsg)
        setMessages(prev => [...prev, userMsg])
      }

      if (mode === "start") {
        setSteps([])
        setCategoryGate(null)
        setManualCategoryQuery("")
        setManualCategoryResults(null)
        setTotalCost(null)
        setMessages([])
        conversationHistory.current = []
      }

      setIsStreaming(true)
      abortRef.current = new AbortController()

      let assistantText = ""
      let assistantMsgAdded = false

      try {
        const res = await fetch("/api/agent/workflow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: abortRef.current.signal,
          body: JSON.stringify({
            message: text.trim(),
            mode,
            conversationHistory: conversationHistory.current.slice(-20),
            session: activeSession,
            imagesMeta,
            productId,
            sessionKey,
            currentStep,
          }),
        })

        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`)
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() ?? ""

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue
            let event: Record<string, unknown>
            try {
              event = JSON.parse(line.slice(6))
            } catch {
              continue
            }

            switch (event.type) {
              case "tool_start":
                setSteps(prev => [
                  ...prev,
                  { name: event.name as string, label: event.label as string, status: "running" },
                ])
                stepsEndRef.current?.scrollIntoView({ behavior: "smooth" })
                break

              case "tool_result":
                setSteps(prev =>
                  prev.map(s =>
                    s.name === event.name && s.status === "running"
                      ? { ...s, status: event.success ? "done" : "error", summary: event.summary as string }
                      : s
                  )
                )
                break

              case "tool_progress":
                setSteps(prev =>
                  prev.map(s =>
                    s.name === event.name && s.status === "running"
                      ? { ...s, summary: event.message as string }
                      : s
                  )
                )
                break

              case "category_suggestions_ready":
                setCategoryGate({
                  suggestions: (event.suggestions as CategorySuggestion[]) ?? [],
                  awaiting: (event.awaiting as boolean | undefined) ?? true,
                })
                setManualCategoryResults(null)
                setManualCategoryQuery("")
                break

              case "message_delta": {
                const delta = event.text as string
                assistantText += delta
                if (!assistantMsgAdded) {
                  setMessages(prev => [...prev, { role: "assistant", content: assistantText }])
                  assistantMsgAdded = true
                } else {
                  setMessages(prev => {
                    const last = prev[prev.length - 1]
                    if (last?.role === "assistant") {
                      return [...prev.slice(0, -1), { role: "assistant", content: assistantText }]
                    }
                    return prev
                  })
                }
                break
              }

              case "session_patch":
                onSessionPatch(event.patch as Partial<ProductSession>)
                break

              case "images_analyzed":
                onImagesAnalyzed(event.imagesMeta as ImageMeta[])
                break

              case "title_generated":
                onTitleGenerated(event.title as string, event.candidates as string[])
                break

              case "description_generated":
                onDescriptionGenerated(
                  event.sections as DescriptionSection[],
                  event.fullHtml as string,
                  event.inputSnapshot as DescriptionInputSnapshot | undefined,
                )
                break

              case "action":
                onAction(event.action as ChatAction)
                break

              case "total_cost": {
                const inputTok = (event.input_tokens as number) ?? 0
                const outputTok = (event.output_tokens as number) ?? 0
                setTotalCost({
                  pln: (event.pln as number) ?? 0,
                  tokens: inputTok + outputTok,
                })
                break
              }

              case "done":
                if (assistantText) {
                  conversationHistory.current.push({ role: "assistant", content: assistantText })
                }
                break

              case "error":
                console.error("[AgentPanel] Agent error:", event.message)
                setMessages(prev => [
                  ...prev,
                  { role: "assistant", content: `Błąd: ${event.message}` },
                ])
                break
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return
        console.error("[AgentPanel] fetch error:", err)
        setMessages(prev => [...prev, { role: "assistant", content: "Połączenie przerwane." }])
      } finally {
        setIsStreaming(false)
        abortRef.current = null
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, imagesMeta, productId, sessionKey, isStreaming]
  )

  function handleSend() {
    const text = input.trim()
    if (!text || isStreaming) return
    setInput("")
    sendMessage(text, "chat")
  }

  function handleStop() {
    abortRef.current?.abort()
  }

  function handlePickCategory(c: CategorySuggestion) {
    if (!session) return
    const patched: ProductSession = {
      ...session,
      allegroCategory: { id: c.id, name: c.name, path: c.path, leaf: true },
    }
    onSessionPatch({ allegroCategory: patched.allegroCategory })
    setCategoryGate(null)
    setManualCategoryResults(null)
    setManualCategoryQuery("")
    sendMessage(`Kategoria potwierdzona: ${c.name} (${c.id}). Kontynuuj workflow.`, "chat", patched)
  }

  async function handleManualCategorySearch() {
    const q = manualCategoryQuery.trim()
    if (!q) return
    setManualCategoryLoading(true)
    try {
      const res = await fetch(`/api/allegro/categories/search?q=${encodeURIComponent(q)}&withCommission=true`)
      const data = await res.json()
      const results = ((data.results ?? []) as Array<{ id: string; name: string; fullPath: string; leaf: boolean; commission?: string | null }>)
        .filter(r => r.leaf)
        .slice(0, 10)
        .map(r => ({ id: r.id, name: r.name, path: r.fullPath, commission: r.commission ?? null }))
      setManualCategoryResults(results)
    } catch {
      setManualCategoryResults([])
    } finally {
      setManualCategoryLoading(false)
    }
  }

  const hasData = !!session?.data?.title

  return (
    <div className={cn("flex flex-col bg-white border-l h-full overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b bg-violet-50 shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-violet-600" />
          <span className="text-sm font-semibold text-violet-800">Asystent</span>
          {currentStep && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-violet-200 text-violet-900 font-medium">
              {STEP_LABEL_MAP[currentStep]}
            </span>
          )}
        </div>
        {isStreaming && (
          <button
            onClick={handleStop}
            className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 transition-colors"
          >
            <Square className="size-3" />
            Stop
          </button>
        )}
      </div>

      {/* Tool steps */}
      {steps.length > 0 && (
        <div className="px-3 py-2 border-b bg-slate-50 space-y-1 max-h-52 overflow-y-auto shrink-0">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              {step.status === "running" ? (
                <Loader2 className="size-3 mt-0.5 text-violet-500 animate-spin shrink-0" />
              ) : step.status === "done" ? (
                <CheckCircle2 className="size-3 mt-0.5 text-green-500 shrink-0" />
              ) : (
                <XCircle className="size-3 mt-0.5 text-red-500 shrink-0" />
              )}
              <div className="min-w-0">
                <span className="text-slate-600 font-medium">{step.label.replace("...", "")}</span>
                {step.summary && (
                  <p className="text-slate-400 truncate">{step.summary}</p>
                )}
              </div>
            </div>
          ))}
          <div ref={stepsEndRef} />
        </div>
      )}

      {/* Category picker — widoczny zawsze gdy gate aktywny, nawet przy 0 sugestii */}
      {categoryGate?.awaiting && (
        <div className="px-3 py-3 border-b bg-amber-50 shrink-0 max-h-[50vh] overflow-y-auto">
          {categoryGate.suggestions.length > 0 ? (
            <>
              <p className="text-xs font-semibold text-amber-900 mb-2">
                Wybierz kategorię Allegro (top {categoryGate.suggestions.length}):
              </p>
              <div className="space-y-1.5 mb-3">
                {categoryGate.suggestions.map(c => (
                  <button
                    key={c.id}
                    onClick={() => handlePickCategory(c)}
                    className="w-full text-left bg-white border border-amber-200 hover:border-amber-400 hover:bg-amber-50 rounded-md px-2.5 py-1.5 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-slate-800 truncate">{c.name}</p>
                        <p className="text-[10px] text-slate-500 truncate">{c.path}</p>
                      </div>
                      {c.commission && (
                        <span className="text-[10px] text-amber-700 font-semibold shrink-0 whitespace-nowrap">
                          {c.commission}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-amber-900 mb-2">
              Brak auto-sugestii — wyszukaj kategorię ręcznie (fragment nazwy).
            </p>
          )}

          {/* Manualny search */}
          <div className="flex gap-1.5">
            <input
              type="text"
              value={manualCategoryQuery}
              onChange={e => setManualCategoryQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleManualCategorySearch()
                }
              }}
              placeholder="np. odkurzacze pionowe"
              className="flex-1 text-xs px-2 py-1.5 bg-white border border-amber-200 rounded-md focus:outline-none focus:border-amber-400"
            />
            <button
              onClick={handleManualCategorySearch}
              disabled={manualCategoryLoading || !manualCategoryQuery.trim()}
              className="text-xs px-2.5 py-1.5 bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50"
            >
              {manualCategoryLoading ? "..." : "Szukaj"}
            </button>
          </div>

          {manualCategoryResults && (
            <div className="mt-2 space-y-1.5">
              {manualCategoryResults.length === 0 ? (
                <p className="text-[10px] text-slate-500">Brak wyników dla &quot;{manualCategoryQuery}&quot;.</p>
              ) : (
                manualCategoryResults.map(c => (
                  <button
                    key={c.id}
                    onClick={() => handlePickCategory(c)}
                    className="w-full text-left bg-white border border-amber-200 hover:border-amber-400 hover:bg-amber-50 rounded-md px-2.5 py-1.5 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-slate-800 truncate">{c.name}</p>
                        <p className="text-[10px] text-slate-500 truncate">{c.path}</p>
                      </div>
                      {c.commission && (
                        <span className="text-[10px] text-amber-700 font-semibold shrink-0 whitespace-nowrap">
                          {c.commission}
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {!hasData && !started && (
          <p className="text-xs text-slate-400 text-center mt-4">
            Asystent uruchomi się automatycznie po załadowaniu danych produktu.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[88%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words",
                m.role === "user"
                  ? "bg-violet-600 text-white rounded-br-sm"
                  : "bg-slate-100 text-slate-800 rounded-bl-sm"
              )}
            >
              {m.content}
            </div>
          </div>
        ))}
        {isStreaming && !messages.some(m => m.role === "assistant") && (
          <div className="flex justify-start">
            <div className="bg-slate-100 rounded-xl px-3 py-2">
              <Loader2 className="size-3.5 animate-spin text-slate-500" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Token cost badge */}
      {totalCost && (
        <div className="px-3 py-1.5 border-t bg-slate-50 flex justify-between items-center shrink-0">
          <span className="text-xs text-slate-400">
            {totalCost.tokens >= 1000
              ? `${(totalCost.tokens / 1000).toFixed(1)}k tokenów`
              : `${totalCost.tokens} tokenów`}
          </span>
          <span className="text-xs font-semibold text-slate-700">
            ~{totalCost.pln.toFixed(2)} zł
          </span>
        </div>
      )}

      {/* Input */}
      <div className="p-2.5 border-t flex gap-2 shrink-0">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          placeholder={isStreaming ? "Asystent pracuje..." : "Napisz instrukcję..."}
          disabled={isStreaming || !hasData}
          className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:opacity-50 disabled:bg-slate-50"
        />
        <button
          onClick={handleSend}
          disabled={isStreaming || !input.trim() || !hasData}
          className="px-3 py-2 bg-violet-600 text-white rounded-lg text-sm disabled:opacity-40 hover:bg-violet-700 transition-colors"
          aria-label="Wyślij"
        >
          <Send className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
