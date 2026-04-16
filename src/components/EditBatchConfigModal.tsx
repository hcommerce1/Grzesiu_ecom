'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { X, Settings2, Loader2, Plus } from 'lucide-react';
import type { BLProductListItem } from '@/lib/types';
import type { EditBatchConfig } from '@/lib/stores/edit-products-store';

interface EditBatchConfigModalProps {
  products: BLProductListItem[];
  onConfirm: (config: EditBatchConfig) => void;
  onCancel: () => void;
  onManual: () => void;
}

export function EditBatchConfigModal({ products, onConfirm, onCancel, onManual }: EditBatchConfigModalProps) {
  const [detectedAttrs, setDetectedAttrs] = useState<string[]>([]);
  const [selectedAttrs, setSelectedAttrs] = useState<Set<string>>(new Set());
  const [detecting, setDetecting] = useState(true);
  const [detectError, setDetectError] = useState('');
  const [customAttr, setCustomAttr] = useState('');
  const [keepExistingImages, setKeepExistingImages] = useState(true);

  const eans = new Set(products.map(p => p.ean).filter(Boolean));
  const skus = new Set(products.map(p => p.sku).filter(Boolean));
  const hasUniqueEans = eans.size > 1;
  const hasUniqueSkus = skus.size > 1;

  useEffect(() => {
    const detect = async () => {
      try {
        const res = await fetch('/api/ai-detect-diff-attrs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ products: products.map(p => ({ id: p.id, name: p.name })) }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        const attrs: string[] = data.detectedAttrs ?? [];
        setDetectedAttrs(attrs);
        setSelectedAttrs(new Set(attrs));
      } catch (e) {
        setDetectError(String(e));
      } finally {
        setDetecting(false);
      }
    };
    detect();
  }, []);

  const toggleAttr = (attr: string) => {
    setSelectedAttrs(prev => {
      const next = new Set(prev);
      if (next.has(attr)) next.delete(attr);
      else next.add(attr);
      return next;
    });
  };

  const addCustomAttr = () => {
    const trimmed = customAttr.trim();
    if (!trimmed) return;
    setDetectedAttrs(prev => prev.includes(trimmed) ? prev : [...prev, trimmed]);
    setSelectedAttrs(prev => new Set([...prev, trimmed]));
    setCustomAttr('');
  };

  const handleConfirm = () => {
    const diffFields: string[] = ['title'];
    if (hasUniqueEans) diffFields.push('ean');
    if (hasUniqueSkus) diffFields.push('sku');

    const extraParsed = [...selectedAttrs];
    for (const attr of extraParsed) {
      diffFields.push(`attr:${attr}`);
    }

    onConfirm({
      diffFields,
      extraAttributesToExtract: extraParsed,
      keepExistingImages,
    });
  };

  const previewProducts = products.slice(0, 5);
  const remaining = products.length - previewProducts.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <Settings2 className="size-4 text-gray-500" />
            <h2 className="font-semibold text-gray-900">Konfiguracja edycji masowej</h2>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5 flex-1 overflow-y-auto">
          {/* Product list */}
          <div>
            <p className="text-sm text-gray-600 mb-2">
              Zaznaczone produkty ({products.length}):
            </p>
            <ul className="space-y-1">
              {previewProducts.map(p => (
                <li key={p.id} className="text-xs text-gray-700 truncate flex gap-2">
                  <span className="text-gray-400 font-mono shrink-0">{p.id}</span>
                  <span className="truncate">{p.name}</span>
                </li>
              ))}
              {remaining > 0 && (
                <li className="text-xs text-gray-400 italic">...i {remaining} więcej</li>
              )}
            </ul>
          </div>

          {/* Auto-detected diff fields */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Automatycznie wykryte różnice:</p>
            <div className="flex flex-wrap gap-2">
              <span className="px-2 py-1 rounded bg-blue-100 text-blue-700 text-xs">Tytuł (zawsze)</span>
              {hasUniqueEans && (
                <span className="px-2 py-1 rounded bg-blue-100 text-blue-700 text-xs">EAN</span>
              )}
              {hasUniqueSkus && (
                <span className="px-2 py-1 rounded bg-blue-100 text-blue-700 text-xs">SKU</span>
              )}
            </div>
          </div>

          {/* AI-detected attributes */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">
              Atrybuty różniące produkty (AI):
            </p>
            {detecting ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="size-4 animate-spin" />
                AI analizuje nazwy produktów...
              </div>
            ) : detectError ? (
              <p className="text-xs text-red-500">{detectError}</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 mb-3">
                  {detectedAttrs.length === 0 && (
                    <span className="text-xs text-gray-400 italic">Brak wykrytych atrybutów</span>
                  )}
                  {detectedAttrs.map(attr => (
                    <button
                      key={attr}
                      onClick={() => toggleAttr(attr)}
                      className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                        selectedAttrs.has(attr)
                          ? 'bg-blue-100 border-blue-300 text-blue-700 font-medium'
                          : 'bg-gray-100 border-gray-200 text-gray-400 line-through'
                      }`}
                    >
                      {attr}
                    </button>
                  ))}
                </div>
                {/* Add custom attribute */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customAttr}
                    onChange={e => setCustomAttr(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addCustomAttr()}
                    placeholder="Dodaj atrybut..."
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={addCustomAttr}
                    disabled={!customAttr.trim()}
                    className="px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 disabled:opacity-40 transition-colors"
                  >
                    <Plus className="size-4" />
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Images option */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setKeepExistingImages(v => !v)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                keepExistingImages ? 'bg-blue-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  keepExistingImages ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
            <div>
              <p className="text-sm font-medium text-gray-700">Zachowaj istniejące zdjęcia</p>
              <p className="text-xs text-gray-400">
                {keepExistingImages
                  ? 'Zdjęcia każdego produktu pozostaną bez zmian'
                  : 'Zdjęcia zostaną zastąpione zdjęciami z szablonu'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-3 px-5 py-4 border-t shrink-0">
          <Button variant="outline" onClick={onCancel}>
            Anuluj
          </Button>
          <Button variant="outline" onClick={onManual} className="flex-1">
            Edytuj po kolei ręcznie
          </Button>
          <Button onClick={handleConfirm} disabled={detecting} className="flex-1">
            Rozpocznij edycję szablonu →
          </Button>
        </div>
      </div>
    </div>
  );
}
