'use client';

import { useState, useCallback, useRef } from 'react';
import { SearchBar } from '@/components/SearchBar';
import { CollapsibleProductItem, type ScrapedItem } from '@/components/CollapsibleProductItem';
import { PromptEditor } from '@/components/PromptEditor';
import type { ScrapeResponse } from '@/lib/types';
import { Package, Loader2 } from 'lucide-react';

const DEFAULT_SYSTEM_PROMPT = `You are a professional e-commerce product translator. Translate ALL fields from the source language to Polish (pl-PL). 
Maintain technical terms, brand names, and model numbers unchanged.
Return ONLY a JSON object with the same structure:
{
  "title": "translated title",
  "description": "translated description",
  "attributes": { "translated_key": "translated_value", ... }
}
Be accurate, natural-sounding, and preserve formatting like bullet points and newlines.`;

export default function Home() {
  const [items, setItems] = useState<ScrapedItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState<string>(DEFAULT_SYSTEM_PROMPT);

  const abortControllerRef = useRef<AbortController | null>(null);

  const handlePromptChange = useCallback((prompt: string) => {
    setSystemPrompt(prompt);
  }, []);

  const handleScrapeBatch = async (urls: string[]) => {
    if (urls.length === 0) return;

    // Reset state
    const newItems: ScrapedItem[] = urls.map(url => ({
      url,
      status: 'pending'
    }));
    setItems(newItems);
    setIsProcessing(true);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    for (let i = 0; i < urls.length; i++) {
      if (abortController.signal.aborted) break;

      setItems(prev => {
        const copy = [...prev];
        copy[i].status = 'loading';
        return copy;
      });

      try {
        const res = await fetch('/api/scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: urls[i], systemPrompt }),
          signal: abortController.signal
        });

        const data: ScrapeResponse = await res.json();

        if (abortController.signal.aborted) break;

        if (data.success) {
          setItems(prev => {
            const copy = [...prev];
            copy[i] = {
              ...copy[i],
              status: 'success',
              product: data.data,
              originalProduct: data.originalData
            };
            return copy;
          });
        } else {
          setItems(prev => {
            const copy = [...prev];
            copy[i] = {
              ...copy[i],
              status: 'error',
              error: data.error
            };
            return copy;
          });
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') break;
        setItems(prev => {
          const copy = [...prev];
          copy[i] = {
            ...copy[i],
            status: 'error',
            error: err instanceof Error ? err.message : 'Network error'
          };
          return copy;
        });
      }

      if (i < urls.length - 1 && !abortController.signal.aborted) {
        // Wait 1.5s between requests to be gentle to server/target
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    if (!abortController.signal.aborted) {
      setIsProcessing(false);
    }
  };

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
              <Package className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground tracking-tight">
                E-Commerce Scraper
              </h1>
              <p className="text-xs text-muted">
                Extract product details from any URL
              </p>
            </div>
          </div>
          <PromptEditor onPromptChange={handlePromptChange} />
        </div>
      </header>

      {/* Search Section */}
      <section className="max-w-6xl mx-auto px-6 pt-12 pb-8">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-foreground mb-3 tracking-tight">
            Paste product URLs to get started
          </h2>
          <p className="text-muted text-sm max-w-md mx-auto">
            Supports Amazon.de, Amazon.com, and similar e-commerce platforms. Paste one URL per line.
          </p>
        </div>
        <SearchBar onSubmit={handleScrapeBatch} isLoading={isProcessing} />
      </section>

      {/* Results Section */}
      <section className="max-w-6xl mx-auto px-6 pb-20">
        {items.length === 0 && (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-card border border-border mx-auto mb-4 flex items-center justify-center">
              <Package className="w-8 h-8 text-muted/50" />
            </div>
            <p className="text-muted text-sm">
              Results will appear here after starting the extraction
            </p>
          </div>
        )}

        {items.length > 0 && (
          <div className="mb-6 flex items-center justify-between bg-card border border-border px-5 py-4 rounded-2xl animate-in fade-in slide-in-from-bottom-2">
            <div className="text-sm font-medium text-foreground">
              Extraction Progress
            </div>
            <div className="flex items-center gap-3">
              {isProcessing && <Loader2 className="w-4 h-4 animate-spin text-accent" />}
              <span className="text-sm font-medium text-foreground bg-accent/10 text-accent px-3 py-1 rounded-full">
                {items.filter(i => i.status === 'success' || i.status === 'error').length} / {items.length} completed
              </span>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {items.map((item, i) => (
            <CollapsibleProductItem key={i} item={item} index={i} />
          ))}
        </div>
      </section>
    </main>
  );
}
