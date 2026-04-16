'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { X, Zap, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import type { BLProductListItem } from '@/lib/types';
import type { ExtractionResult } from '@/app/api/ai-extract-variants/route';

interface EditBatchApplyModalProps {
  products: BLProductListItem[];
  diffFields: string[];
  extractions: ExtractionResult[];
  isLoading: boolean;
  onApprove: (correctedExtractions: ExtractionResult[]) => void;
  onBack: () => void;
}

export function EditBatchApplyModal({
  products,
  diffFields,
  extractions,
  isLoading,
  onApprove,
  onBack,
}: EditBatchApplyModalProps) {
  const [edited, setEdited] = useState<Record<string, Record<string, string>>>({});

  const attrFields = diffFields.filter(f => f.startsWith('attr:')).map(f => f.replace('attr:', ''));
  const simpleFields = diffFields.filter(f => !f.startsWith('attr:') && f !== 'title' && f !== 'images');
  const allDisplayFields = [...attrFields, ...simpleFields];

  const getExtractionForProduct = (blProductId: string): ExtractionResult | undefined =>
    extractions.find(e => e.productId === blProductId);

  const getCellValue = (blProductId: string, field: string): string => {
    if (edited[blProductId]?.[field] !== undefined) return edited[blProductId][field];
    const ext = getExtractionForProduct(blProductId);
    return ext?.values[field] ?? '';
  };

  const isMissing = (blProductId: string, field: string): boolean => {
    if (edited[blProductId]?.[field] !== undefined) return !edited[blProductId][field];
    const ext = getExtractionForProduct(blProductId);
    return ext?.missing.includes(field) ?? false;
  };

  const handleCellEdit = (blProductId: string, field: string, value: string) => {
    setEdited(prev => ({
      ...prev,
      [blProductId]: { ...(prev[blProductId] ?? {}), [field]: value },
    }));
  };

  const problemCount = products.filter(p => {
    const ext = getExtractionForProduct(p.id);
    return ext?.missing.some(f => !edited[p.id]?.[f]) || (ext?.confidence ?? 1) < 0.6;
  }).length;

  const handleApprove = () => {
    // Merge edits back into extractions
    const corrected: ExtractionResult[] = products.map(p => {
      const base = getExtractionForProduct(p.id) ?? {
        productId: p.id,
        values: {},
        confidence: 1,
        missing: [],
      };
      const overrides = edited[p.id] ?? {};
      return {
        ...base,
        values: { ...base.values, ...overrides },
        missing: base.missing.filter(f => !overrides[f]),
      };
    });
    onApprove(corrected);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl mx-4 flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Zap className="size-4 text-blue-500" />
            <h2 className="font-semibold text-gray-900">Zastosuj szablon do pozostałych produktów</h2>
          </div>
          <button onClick={onBack} className="text-gray-400 hover:text-gray-600">
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b shrink-0">
          <p className="text-sm text-gray-600">
            AI wyciągnął wartości z nazw produktów. Sprawdź i popraw jeśli coś jest nie tak.
            Kliknij w komórkę aby edytować.
          </p>
          {problemCount > 0 && (
            <div className="flex items-center gap-1.5 mt-2 text-amber-600 text-sm">
              <AlertTriangle className="size-4" />
              {problemCount} produktów wymaga uwagi (brakujące wartości lub niska pewność)
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto px-5 py-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 gap-3 text-gray-500">
              <Loader2 className="size-5 animate-spin" />
              <span>AI analizuje nazwy produktów...</span>
            </div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-3 py-2 font-medium text-gray-600 border-b w-64">Produkt</th>
                  {allDisplayFields.map(f => (
                    <th key={f} className="text-left px-3 py-2 font-medium text-gray-600 border-b whitespace-nowrap">{f}</th>
                  ))}
                  <th className="text-left px-3 py-2 font-medium text-gray-600 border-b w-20">Pewność</th>
                </tr>
              </thead>
              <tbody>
                {products.map(p => {
                  const ext = getExtractionForProduct(p.id);
                  const confidence = ext?.confidence ?? 1;
                  const rowProblem = (ext?.missing.some(f => !edited[p.id]?.[f]) || confidence < 0.6);

                  return (
                    <tr key={p.id} className={rowProblem ? 'bg-amber-50' : 'hover:bg-gray-50'}>
                      <td className="px-3 py-2 border-b">
                        <div className="font-medium text-gray-800 truncate max-w-[15rem]" title={p.name}>{p.name}</div>
                        <div className="text-xs text-gray-400 font-mono">{p.id}</div>
                      </td>
                      {allDisplayFields.map(f => {
                        const missing = isMissing(p.id, f);
                        const value = getCellValue(p.id, f);
                        return (
                          <td key={f} className="px-1 py-1 border-b">
                            <input
                              type="text"
                              value={value}
                              onChange={e => handleCellEdit(p.id, f, e.target.value)}
                              placeholder={missing ? 'brak' : ''}
                              className={`w-full px-2 py-1 rounded border text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 min-w-[80px] ${
                                missing && !value
                                  ? 'border-red-300 bg-red-50 placeholder:text-red-400'
                                  : 'border-gray-200 bg-white'
                              }`}
                            />
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 border-b text-center">
                        {confidence >= 0.8 ? (
                          <CheckCircle2 className="size-4 text-green-500 mx-auto" />
                        ) : confidence >= 0.5 ? (
                          <span className="text-xs text-amber-600">{Math.round(confidence * 100)}%</span>
                        ) : (
                          <span className="text-xs text-red-500">{Math.round(confidence * 100)}%</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex gap-3 px-5 py-4 border-t shrink-0">
          <Button variant="outline" onClick={onBack} className="flex-1">
            ← Wróć do edycji ręcznej
          </Button>
          <Button
            onClick={handleApprove}
            disabled={isLoading}
            className="flex-1"
          >
            <Zap className="size-4 mr-2" />
            Zatwierdź i uruchom automatycznie ({products.length} produktów)
          </Button>
        </div>
      </div>
    </div>
  );
}
