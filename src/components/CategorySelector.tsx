'use client';

import { useState, useEffect } from 'react';
import { ChevronRight, Search, Check, Loader2 } from 'lucide-react';
import type { AllegroCategory } from '@/lib/types';

interface CategorySelectorProps {
  onSelect: (category: AllegroCategory) => void;
  selectedCategory?: AllegroCategory | null;
}

export function CategorySelector({ onSelect, selectedCategory }: CategorySelectorProps) {
  const [categories, setCategories] = useState<AllegroCategory[]>([]);
  const [path, setPath] = useState<AllegroCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [customId, setCustomId] = useState('');
  const [isDemo, setIsDemo] = useState(false);

  const currentParentId = path.length > 0 ? path[path.length - 1].id : '';

  useEffect(() => {
    loadCategories(currentParentId);
  }, [currentParentId]);

  async function loadCategories(parentId: string) {
    setLoading(true);
    setError('');
    try {
      const url = parentId
        ? `/api/allegro/categories?parentId=${parentId}`
        : '/api/allegro/categories';
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setCategories(data.categories ?? []);
      if (data._demo) setIsDemo(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd ładowania kategorii');
    } finally {
      setLoading(false);
    }
  }

  function navigateInto(cat: AllegroCategory) {
    if (cat.leaf) {
      onSelect({ ...cat, path: [...path.map(p => p.name), cat.name].join(' > ') });
    } else {
      setPath(prev => [...prev, cat]);
    }
  }

  function navigateBack(index: number) {
    setPath(prev => prev.slice(0, index));
  }

  async function handleCustomId() {
    if (!customId.trim()) return;
    try {
      const res = await fetch(`/api/allegro/parameters?categoryId=${customId.trim()}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      onSelect({ id: customId.trim(), name: `Kategoria ${customId}`, path: customId.trim(), leaf: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie znaleziono kategorii');
    }
  }

  return (
    <div className="space-y-3">
      {isDemo && (
        <div className="flex items-center gap-2 px-3 py-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-xs text-yellow-400">
          <span>⚠️</span>
          <span>TRYB DEMO — fikcyjne kategorie. Dodaj <code className="font-mono">ALLEGRO_CLIENT_ID</code> w .env.local aby użyć prawdziwego Allegro.</span>
        </div>
      )}
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-muted flex-wrap">
        <button onClick={() => setPath([])} className="hover:text-foreground transition-colors">
          Główna
        </button>
        {path.map((cat, i) => (
          <span key={cat.id} className="flex items-center gap-1">
            <ChevronRight className="w-3 h-3" />
            <button onClick={() => navigateBack(i + 1)} className="hover:text-foreground transition-colors">
              {cat.name}
            </button>
          </span>
        ))}
      </div>

      {/* Selected */}
      {selectedCategory && (
        <div className="flex items-center gap-2 p-2 bg-accent/10 border border-accent/30 rounded-lg text-xs">
          <Check className="w-3 h-3 text-accent flex-shrink-0" />
          <span className="text-accent font-medium truncate">{selectedCategory.path}</span>
        </div>
      )}

      {/* Categories list */}
      <div className="border border-border rounded-xl overflow-hidden max-h-64 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted" />
          </div>
        )}
        {error && (
          <div className="p-4 text-sm text-red-400 text-center">{error}</div>
        )}
        {!loading && !error && categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => navigateInto(cat)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-card-hover transition-colors border-b border-border last:border-0 group"
          >
            <span className="text-sm text-foreground">{cat.name}</span>
            <div className="flex items-center gap-2">
              {cat.leaf && (
                <span className="text-xs text-muted bg-background px-2 py-0.5 rounded-full">liść</span>
              )}
              {!cat.leaf && <ChevronRight className="w-3 h-3 text-muted group-hover:text-foreground" />}
              {cat.leaf && <Check className="w-3 h-3 text-green-500 opacity-0 group-hover:opacity-100 transition-opacity" />}
            </div>
          </button>
        ))}
      </div>

      {/* Custom ID input */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted" />
          <input
            value={customId}
            onChange={(e) => setCustomId(e.target.value)}
            placeholder="Wpisz ID kategorii Allegro..."
            onKeyDown={(e) => e.key === 'Enter' && handleCustomId()}
            className="w-full bg-background border border-border rounded-lg pl-8 pr-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent"
          />
        </div>
        <button
          onClick={handleCustomId}
          className="px-3 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover transition-colors"
        >
          OK
        </button>
      </div>
    </div>
  );
}
