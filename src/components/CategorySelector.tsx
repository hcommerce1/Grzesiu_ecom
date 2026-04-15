'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronRight, Search, Check, Loader2, Sparkles, FolderTree, X, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import type { AllegroCategory, ProductData } from '@/lib/types';

interface CategorySuggestion {
  id: string;
  name: string;
  path: string;
  leaf: boolean;
  commission: string | null;
}

interface SearchResult {
  id: string;
  name: string;
  fullPath: string;
  leaf: boolean;
  commission?: string | null;
}

interface CategorySelectorProps {
  onSelect: (category: AllegroCategory) => void;
  onReset?: () => void;
  selectedCategory?: AllegroCategory | null;
  productData?: ProductData | null;
}

function parseCommission(commission: string | null | undefined): { pct: string; label: string } | null {
  if (!commission) return null;
  // Format "4.5% netto" or "8.5%"
  const match = commission.match(/(\d+([.,]\d+)?)\s*%\s*(netto)?/i);
  if (match) {
    const val = match[1].replace(',', '.');
    const suffix = match[3] ? ' netto' : '';
    return { pct: val + '%' + suffix, label: val };
  }
  // Try JSON
  try {
    const parsed = JSON.parse(commission);
    const p = parsed?.commission?.percentage ?? parsed?.percentage ?? parsed?.fee?.percentage;
    if (p) return { pct: p + '%', label: String(p) };
  } catch { /* not JSON */ }
  return null;
}

function CommissionBadge({ commission }: { commission: string | null | undefined }) {
  const parsed = parseCommission(commission);
  if (!parsed) return null;
  const num = parseFloat(parsed.label);
  let colorClass = 'bg-green-100 text-green-800 border-green-300';
  if (num >= 8) colorClass = 'bg-red-100 text-red-800 border-red-300';
  else if (num >= 5) colorClass = 'bg-yellow-100 text-yellow-800 border-yellow-300';

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${colorClass}`}>
      {parsed.pct}
    </span>
  );
}

// Module-level cache for suggestions so navigating away and back doesn't re-fetch
const suggestionsCache = new Map<string, CategorySuggestion[]>();

export function CategorySelector({ onSelect, onReset, selectedCategory, productData }: CategorySelectorProps) {
  // --- Shared state ---
  const [error, setError] = useState('');
  const [isDemo, setIsDemo] = useState(false);

  // --- AI suggestions ---
  const cacheKey = productData?.title ?? '';
  const [suggestions, setSuggestions] = useState<CategorySuggestion[]>(
    () => suggestionsCache.get(cacheKey) ?? []
  );
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState('');

  // --- Search ---
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const suggestionsAbortRef = useRef<AbortController | null>(null);

  // --- Tree browser ---
  const [showTree, setShowTree] = useState(true);
  const [categories, setCategories] = useState<AllegroCategory[]>([]);
  const [path, setPath] = useState<AllegroCategory[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);

  const currentParentId = path.length > 0 ? path[path.length - 1].id : '';

  // Auto-load suggestions on mount if not cached
  useEffect(() => {
    if (productData?.title && !selectedCategory && suggestions.length === 0) {
      loadSuggestions();
    }
  }, []);

  // Load tree categories when path changes
  useEffect(() => {
    if (showTree) {
      loadTreeCategories(currentParentId);
    }
  }, [currentParentId, showTree]);

  // Debounced search
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    searchTimeout.current = setTimeout(() => {
      performSearch(searchQuery.trim());
    }, 350);
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, [searchQuery]);

  async function loadSuggestions() {
    if (!productData) return;
    // Anuluj poprzedni request jeśli trwa
    suggestionsAbortRef.current?.abort();
    const controller = new AbortController();
    suggestionsAbortRef.current = controller;

    setSuggestionsLoading(true);
    setSuggestionsError('');
    try {
      const res = await fetch('/api/allegro/suggest-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productTitle: productData.title,
          productAttributes: productData.attributes,
          sourceCategory: productData.attributes?.['_sourceCategory'],
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const s = data.suggestions ?? [];
      setSuggestions(s);
      suggestionsCache.set(cacheKey, s);
      if (data._demo) setIsDemo(true);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setSuggestionsError(err instanceof Error ? err.message : 'Nie udało się pobrać sugestii');
    } finally {
      setSuggestionsLoading(false);
    }
  }

  async function performSearch(query: string) {
    setSearchLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/allegro/categories/search?q=${encodeURIComponent(query)}&withCommission=true`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSearchResults(data.results ?? []);
      if (data._demo) setIsDemo(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd wyszukiwania');
    } finally {
      setSearchLoading(false);
    }
  }

  async function loadTreeCategories(parentId: string) {
    setTreeLoading(true);
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
      setTreeLoading(false);
    }
  }

  function selectCategory(cat: { id: string; name: string; path?: string; fullPath?: string; leaf?: boolean }) {
    // Anuluj trwające ładowanie sugestii — żeby nie blokować serwera Next.js
    suggestionsAbortRef.current?.abort();

    const allegroCategory: AllegroCategory = {
      id: cat.id,
      name: cat.name,
      path: cat.fullPath ?? cat.path ?? cat.name,
      leaf: cat.leaf ?? true,
    };
    onSelect(allegroCategory);
  }

  function navigateInto(cat: AllegroCategory) {
    if (cat.leaf) {
      selectCategory({ ...cat, fullPath: [...path.map(p => p.name), cat.name].join(' > ') });
    } else {
      setPath(prev => [...prev, cat]);
    }
  }

  return (
    <div className="space-y-5">
      {/* Demo banner */}
      {isDemo && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>TRYB DEMO — fikcyjne kategorie. Dodaj <code className="font-mono bg-amber-100 px-1 rounded">ALLEGRO_CLIENT_ID</code> w .env.local</span>
        </div>
      )}

      {/* Currently selected category */}
      {selectedCategory && (
        <div className="flex items-center justify-between gap-3 p-3 bg-blue-50 border-2 border-blue-300 rounded-xl">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
              <Check className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900 truncate">{selectedCategory.name}</p>
              <p className="text-xs text-gray-500 truncate">{selectedCategory.path}</p>
            </div>
          </div>
          <button
            onClick={() => onReset?.()}
            className="text-xs text-blue-600 hover:text-blue-800 font-semibold whitespace-nowrap px-2 py-1 rounded hover:bg-blue-100 transition-colors"
          >
            Zmień
          </button>
        </div>
      )}

      {/* Search bar — always visible */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setError('');
          }}
          placeholder="Wyszukaj kategorię po nazwie (np. odkurzacze pionowe)..."
          className="w-full bg-white border border-gray-300 rounded-xl pl-10 pr-10 py-3 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm"
        />
        {searchQuery && (
          <button
            onClick={() => { setSearchQuery(''); setSearchResults([]); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-600"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Search results */}
      {searchLoading && (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          Szukam kategorii...
        </div>
      )}
      {!searchLoading && searchResults.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2 px-1">
            Wyniki wyszukiwania ({searchResults.length})
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {searchResults.map((cat) => (
              <button
                key={cat.id}
                onClick={() => selectCategory(cat)}
                className="flex items-start justify-between gap-2 px-3 py-2.5 text-left bg-white border border-gray-200 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-all group"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 group-hover:text-blue-700 truncate">{cat.name}</p>
                  <p className="text-[11px] text-gray-500 truncate mt-0.5">{cat.fullPath}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                  <CommissionBadge commission={cat.commission} />
                  {cat.leaf && (
                    <Check className="w-3.5 h-3.5 text-green-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      {!searchLoading && searchQuery && searchResults.length === 0 && !error && (
        <p className="text-sm text-gray-500 text-center py-4">
          Brak wyników dla &ldquo;{searchQuery}&rdquo; — spróbuj inną frazę
        </p>
      )}

      {/* AI Suggestions — hidden when searching */}
      {!searchQuery && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              <p className="text-sm font-semibold text-gray-700">Sugerowane kategorie</p>
            </div>
            {suggestions.length === 0 && productData?.title && (
              <button
                onClick={loadSuggestions}
                disabled={suggestionsLoading}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1"
              >
                {suggestionsLoading ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Ładuję...
                  </>
                ) : (
                  'Załaduj sugestie'
                )}
              </button>
            )}
            {suggestions.length > 0 && (
              <button
                onClick={loadSuggestions}
                disabled={suggestionsLoading}
                className="text-xs text-gray-500 hover:text-gray-600 font-medium px-2 py-1 rounded hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Odśwież
              </button>
            )}
          </div>

          {suggestionsLoading && (
            <div className="flex items-center gap-2 py-6 justify-center text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Analizuję produkt i szukam kategorii...
            </div>
          )}

          {suggestionsError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1">{suggestionsError}</span>
              <button onClick={() => setSuggestionsError('')} className="text-red-400 hover:text-red-600">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {suggestions.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => selectCategory(cat)}
                  className="flex items-start justify-between gap-2 px-3 py-2.5 text-left bg-white border border-gray-200 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-all group"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 group-hover:text-blue-700 truncate">{cat.name}</p>
                    <p className="text-[11px] text-gray-500 truncate mt-0.5">{cat.path}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                    <CommissionBadge commission={cat.commission} />
                    <Check className="w-3.5 h-3.5 text-green-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </button>
              ))}
            </div>
          )}

          {!suggestionsLoading && suggestions.length === 0 && !suggestionsError && !productData?.title && (
            <p className="text-xs text-gray-500 italic">
              Sugestie AI dostępne po zescrapowaniu produktu.
            </p>
          )}
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Tree browser — grid layout, no scrolls */}
      {!searchQuery && (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <button
            onClick={() => setShowTree(!showTree)}
            className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <div className="flex items-center gap-2">
              <FolderTree className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">Przeglądaj drzewo kategorii</span>
            </div>
            {showTree ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
          </button>

          {showTree && (
            <div className="border-t border-gray-200 bg-white">
              {/* Breadcrumb */}
              <div className="flex items-center gap-1 px-4 py-2 text-xs text-gray-500 flex-wrap border-b border-gray-100">
                <button onClick={() => setPath([])} className="hover:text-blue-600 font-semibold transition-colors">
                  Główna
                </button>
                {path.map((cat, i) => (
                  <span key={cat.id} className="flex items-center gap-1">
                    <ChevronRight className="w-3 h-3" />
                    <button onClick={() => setPath(prev => prev.slice(0, i + 1))} className="hover:text-blue-600 transition-colors">
                      {cat.name}
                    </button>
                  </span>
                ))}
              </div>

              {/* Categories as horizontal grid — no vertical scroll */}
              <div className="p-3">
                {treeLoading && (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
                  </div>
                )}
                {!treeLoading && categories.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-4">Brak kategorii</p>
                )}
                {!treeLoading && categories.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {categories.map((cat) => (
                      <button
                        key={cat.id}
                        onClick={() => navigateInto(cat)}
                        className={`
                          inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all
                          ${cat.leaf
                            ? 'bg-green-50 border border-green-200 text-green-800 hover:bg-green-100 hover:border-green-400'
                            : 'bg-gray-100 border border-gray-200 text-gray-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700'
                          }
                        `}
                      >
                        <span className="truncate max-w-[200px]">{cat.name}</span>
                        {!cat.leaf && <ChevronRight className="w-3 h-3 flex-shrink-0 opacity-50" />}
                        {cat.leaf && <Check className="w-3 h-3 flex-shrink-0 opacity-50" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
