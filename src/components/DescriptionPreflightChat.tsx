'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, Sparkles, Send, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DESCRIPTION_STYLE_LIST, type DescriptionStyleId } from '@/lib/description-styles';
import type { ImageMeta } from '@/lib/types';

interface PreflightMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  title: string;
  translatedData: { title: string; attributes: Record<string, string> };
  imagesMeta: ImageMeta[];
  filledParameters: Record<string, string | string[]>;
  categoryPath: string;
  bundleContext?: string;
  referenceDescription?: string;
  uwagi?: string;
  onGenerate: (style: DescriptionStyleId, gatheredContext: string) => void;
  // Pełny kontekst produktu dla AI
  originalDescription?: string;
  price?: string;
  currency?: string;
  ean?: string;
  sku?: string;
}

export function DescriptionPreflightChat({
  title,
  translatedData,
  imagesMeta,
  filledParameters,
  categoryPath,
  bundleContext,
  referenceDescription,
  uwagi,
  onGenerate,
  originalDescription,
  price,
  currency,
  ean,
  sku,
}: Props) {
  const [messages, setMessages] = useState<PreflightMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState<DescriptionStyleId>('lifestyle');
  const [readyToGenerate, setReadyToGenerate] = useState(false);
  const [gatheredContext, setGatheredContext] = useState('');
  const [error, setError] = useState('');
  const hasTriggered = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const callPreflight = useCallback(async (history: PreflightMessage[]) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/description-preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          attributes: translatedData.attributes,
          category: categoryPath,
          imagesMeta,
          filledParameters,
          bundleContext,
          referenceDescription,
          uwagi,
          conversationHistory: history,
          originalDescription,
          price,
          currency,
          ean,
          sku,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const aiMsg: PreflightMessage = { role: 'assistant', content: data.message };
      const newHistory = [...history, aiMsg];
      setMessages(newHistory);

      if (data.suggestedStyle && DESCRIPTION_STYLE_LIST.some(s => s.id === data.suggestedStyle)) {
        setSelectedStyle(data.suggestedStyle as DescriptionStyleId);
      }
      if (data.gatheredContext) {
        setGatheredContext(data.gatheredContext);
      }
      if (data.readyToGenerate) {
        setReadyToGenerate(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd połączenia');
    } finally {
      setLoading(false);
    }
  }, [title, translatedData, categoryPath, imagesMeta, filledParameters, bundleContext, referenceDescription, uwagi, originalDescription, price, currency, ean, sku]);

  // Auto-trigger on mount
  useEffect(() => {
    if (hasTriggered.current) return;
    hasTriggered.current = true;
    callPreflight([]);
  }, [callPreflight]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: PreflightMessage = { role: 'user', content: text };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput('');
    await callPreflight(newHistory);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2 pb-1">
        <Sparkles className="size-4 text-violet-500" />
        <span className="text-sm font-semibold text-gray-800">Asystent opisu AI</span>
        <span className="text-xs text-gray-400">— odpowie na pytania przed generowaniem</span>
      </div>

      {/* Style chips */}
      <div className="flex gap-2 flex-wrap">
        {DESCRIPTION_STYLE_LIST.map(style => (
          <button
            key={style.id}
            onClick={() => setSelectedStyle(style.id)}
            title={style.description}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
              selectedStyle === style.id
                ? 'bg-violet-600 text-white border-violet-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300 hover:text-violet-600',
            )}
          >
            {style.name}
          </button>
        ))}
        <span className="text-xs text-gray-400 self-center">← styl opisu (AI sugeruje, możesz zmienić)</span>
      </div>

      {/* Chat messages */}
      <div className="flex flex-col gap-3 min-h-[120px] max-h-[320px] overflow-y-auto rounded-xl border border-gray-100 bg-gray-50/50 p-4">
        {messages.length === 0 && !loading && (
          <p className="text-xs text-gray-400 text-center mt-4">Analizuję dane produktu...</p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn(
              'rounded-lg px-3 py-2 text-sm max-w-[85%]',
              msg.role === 'user'
                ? 'bg-violet-50 text-violet-900 self-end border border-violet-100'
                : 'bg-white text-gray-800 self-start border border-gray-100 shadow-sm',
            )}
          >
            <div
              className="whitespace-pre-wrap leading-relaxed prose-sm"
              dangerouslySetInnerHTML={{
                __html: msg.content
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                  .replace(/\*(.+?)\*/g, '<em>$1</em>')
                  .replace(/`(.+?)`/g, '<code class="bg-gray-100 px-1 rounded text-xs">$1</code>')
                  .replace(/^(\d+)\. /gm, '<span class="font-semibold">$1.</span> ')
                  .replace(/^- /gm, '• '),
              }}
            />
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 self-start bg-white border border-gray-100 rounded-lg px-3 py-2 shadow-sm">
            <Loader2 className="size-3.5 animate-spin text-violet-400" />
            <span className="text-xs text-gray-400">AI analizuje...</span>
          </div>
        )}
        {error && (
          <p className="text-xs text-red-500 self-center">{error}</p>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Odpowiedz na pytania AI lub napisz 'generuj' gdy gotowy..."
          disabled={loading}
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:opacity-50"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={send}
          disabled={loading || !input.trim()}
          className="shrink-0"
        >
          <Send className="size-3.5" />
        </Button>
      </div>

      {/* Generate button — visible only when AI is ready */}
      {readyToGenerate && (
        <Button
          onClick={() => onGenerate(selectedStyle, gatheredContext)}
          disabled={loading}
          className="w-full gap-2 bg-violet-600 hover:bg-violet-700 text-white"
        >
          <ArrowRight className="size-4" />
          {`Generuj opis (styl: ${DESCRIPTION_STYLE_LIST.find(s => s.id === selectedStyle)?.name})`}
        </Button>
      )}
    </div>
  );
}
