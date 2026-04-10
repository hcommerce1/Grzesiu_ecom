"use client"

import { useState, useRef, useEffect } from "react"
import { Send, Loader2, Bot, User, X, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface Message {
  role: "user" | "assistant"
  content: string
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
}

export function ClaudeChat({
  currentTitle,
  currentDescription,
  currentImages = [],
  onUpdate,
  onClose,
  className,
}: ClaudeChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMessage: Message = { role: "user", content: text }
    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setLoading(true)

    try {
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
    } catch (e: unknown) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Błąd: ${e instanceof Error ? e.message : "Nieznany błąd"}` },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={cn("flex flex-col bg-card rounded-xl ring-1 ring-foreground/10 overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <Sparkles className="size-4 text-primary shrink-0" />
        <span className="font-medium text-sm flex-1">Asystent AI</span>
        <span className="text-xs text-muted-foreground hidden sm:inline">Edytuje tytuł i opis</span>
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
            <p className="text-xs mt-1 opacity-70">np. „Skróć opis", „Dodaj więcej emocji w tytule", „Zmień styl na bardziej formalny"</p>
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
              {msg.content}
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
