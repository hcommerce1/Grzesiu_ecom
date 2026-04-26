'use client';

import { useState, useRef, useCallback } from 'react';
import { X, FolderOpen, Loader2, Upload, Check, Star, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BLProductListItem, ImageMeta } from '@/lib/types';

interface AnalyzedImage {
  file: File;
  base64: string;
  previewUrl: string;
  analysis: {
    description: string;
    labelText?: string;
    imageType?: string;
    variantHint?: string;
  } | null;
  analyzing: boolean;
  assignedTo: string | 'all' | null; // productId, 'all', or null (skip)
  order: number;
  isFeature: boolean;
}

interface BatchImageAssignModalProps {
  products: BLProductListItem[];
  /** current product id if in single-edit mode */
  currentProductId?: string;
  onAssigned: (assignments: Record<string, ImageMeta[]>) => void;
  onCancel: () => void;
}

export function BatchImageAssignModal({
  products,
  currentProductId,
  onAssigned,
  onCancel,
}: BatchImageAssignModalProps) {
  const [images, setImages] = useState<AnalyzedImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isSingleMode = products.length <= 1 || !!currentProductId;
  const defaultProductId = currentProductId ?? products[0]?.id ?? 'all';

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const analyzeImages = useCallback(async (imgs: AnalyzedImage[]): Promise<AnalyzedImage[]> => {
    try {
      // Send all as data URLs (OpenAI vision supports data: URLs)
      const res = await fetch('/api/images/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: imgs.map(img => img.base64) }),
      });
      if (!res.ok) return imgs.map(img => ({ ...img, analyzing: false }));
      const data = await res.json();
      const results: Array<{
        aiDescription: string;
        labelText?: string;
        imageType?: string;
        variantHint?: string;
        isFeatureImage?: boolean;
      }> = data.results ?? [];
      return imgs.map((img, i) => ({
        ...img,
        analyzing: false,
        analysis: {
          description: results[i]?.aiDescription ?? '',
          labelText: results[i]?.labelText,
          imageType: results[i]?.imageType,
          variantHint: results[i]?.variantHint,
        },
        isFeature: img.isFeature || (results[i]?.isFeatureImage ?? false),
      }));
    } catch {
      return imgs.map(img => ({ ...img, analyzing: false }));
    }
  }, []);

  const handleFilesSelected = useCallback(async (files: FileList) => {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, 16);
    if (!imageFiles.length) return;

    // Create initial state with previews
    const initial: AnalyzedImage[] = await Promise.all(
      imageFiles.map(async (file, idx) => {
        const dataUrl = await readFileAsDataUrl(file);
        return {
          file,
          base64: dataUrl, // store as full data URL for analyze API
          previewUrl: URL.createObjectURL(file),
          analysis: null,
          analyzing: true,
          assignedTo: isSingleMode ? defaultProductId : null,
          order: idx,
          isFeature: idx === 0,
        };
      })
    );

    setImages(initial);

    // Analyze all in batches of 5 (API batch size)
    const batchSize = 5;
    let analyzed = [...initial];
    for (let i = 0; i < initial.length; i += batchSize) {
      const batch = analyzed.slice(i, i + batchSize);
      const results = await analyzeImages(batch);
      analyzed = [
        ...analyzed.slice(0, i),
        ...results,
        ...analyzed.slice(i + batchSize),
      ];
      setImages([...analyzed]);
    }
  }, [analyzeImages, isSingleMode, defaultProductId]);

  const updateImage = (idx: number, patch: Partial<AnalyzedImage>) => {
    setImages(prev => prev.map((img, i) => i === idx ? { ...img, ...patch } : img));
  };

  const handleConfirm = async () => {
    const toUpload = images.filter(img => img.assignedTo !== null);
    if (!toUpload.length) return;

    setUploading(true);
    try {
      // Upload all images to cloud
      const formData = new FormData();
      for (const img of toUpload) {
        formData.append('files', img.file);
      }
      formData.append('provider', 'auto');

      const res = await fetch('/api/images/upload', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Upload failed');
      const uploadData = await res.json();

      const urls: string[] = uploadData.uploads?.map((u: { url: string }) => u.url) ?? [];

      // Build assignments: productId → ImageMeta[]
      const assignments: Record<string, ImageMeta[]> = {};

      toUpload.forEach((img, i) => {
        const url = urls[i];
        if (!url) return;

        const meta: ImageMeta = {
          url,
          order: img.order,
          removed: false,
          aiDescription: img.analysis?.description ?? '',
          aiConfidence: 0.9,
          userDescription: img.analysis?.labelText ? `Etykieta: ${img.analysis.labelText}` : '',
          isFeatureImage: img.isFeature,
          features: img.analysis?.imageType ? [img.analysis.imageType] : [],
        };

        const targets = img.assignedTo === 'all'
          ? products.map(p => p.id)
          : [img.assignedTo as string];

        for (const pid of targets) {
          if (!assignments[pid]) assignments[pid] = [];
          assignments[pid].push(meta);
        }
      });

      onAssigned(assignments);
    } catch (e) {
      console.error('BatchImageAssign upload error:', e);
    } finally {
      setUploading(false);
    }
  };

  const assignedCount = images.filter(img => img.assignedTo !== null).length;
  const analyzingCount = images.filter(img => img.analyzing).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl mx-4 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <ImageIcon className="size-4 text-blue-500" />
            <h2 className="font-semibold text-gray-900">Wgraj zdjęcia do galerii produktów</h2>
            {analyzingCount > 0 && (
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <Loader2 className="size-3 animate-spin" /> AI analizuje {analyzingCount} zdjęć...
              </span>
            )}
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {images.length === 0 ? (
            <div
              className="border-2 border-dashed border-gray-300 rounded-xl p-12 text-center cursor-pointer hover:border-blue-400 transition-colors"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                if (e.dataTransfer.files.length) handleFilesSelected(e.dataTransfer.files);
              }}
            >
              <FolderOpen className="size-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600 font-medium">Kliknij lub przeciągnij zdjęcia / folder</p>
              <p className="text-xs text-gray-400 mt-1">JPG, PNG, WEBP — do 16 zdjęć na raz</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={e => e.target.files && handleFilesSelected(e.target.files)}
              />
            </div>
          ) : (
            <div className="space-y-3">
              {/* Add more button */}
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-gray-600">{images.length} zdjęć załadowanych</p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs text-blue-600 hover:underline"
                >
                  + Dodaj więcej
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  className="hidden"
                  onChange={e => e.target.files && handleFilesSelected(e.target.files)}
                />
              </div>

              {/* Image rows */}
              {images.map((img, idx) => (
                <div
                  key={idx}
                  className={`flex gap-3 p-3 rounded-lg border ${img.assignedTo === null ? 'border-gray-100 bg-gray-50 opacity-60' : 'border-blue-100 bg-blue-50/30'}`}
                >
                  {/* Preview */}
                  <div className="relative shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element -- external/blob preview URLs, Image not worth runtime complexity */}
                    <img
                      src={img.previewUrl}
                      alt=""
                      className="w-16 h-16 object-cover rounded"
                    />
                    {img.isFeature && (
                      <div className="absolute -top-1 -right-1 bg-yellow-400 rounded-full p-0.5">
                        <Star className="size-2.5 text-white fill-white" />
                      </div>
                    )}
                  </div>

                  {/* Analysis */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-700 truncate">{img.file.name}</p>
                    {img.analyzing ? (
                      <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                        <Loader2 className="size-3 animate-spin" /> Analiza AI...
                      </p>
                    ) : img.analysis ? (
                      <div className="mt-0.5 space-y-0.5">
                        <p className="text-xs text-gray-600 line-clamp-2">{img.analysis.description}</p>
                        {img.analysis.labelText && (
                          <p className="text-xs text-orange-600">Etykieta: {img.analysis.labelText}</p>
                        )}
                        {img.analysis.imageType && (
                          <span className="inline-block px-1.5 py-0.5 rounded bg-gray-100 text-[10px] text-gray-500">
                            {img.analysis.imageType}
                          </span>
                        )}
                      </div>
                    ) : null}
                  </div>

                  {/* Controls */}
                  <div className="flex flex-col gap-1.5 shrink-0 min-w-[160px]">
                    {/* Assignment dropdown */}
                    {!isSingleMode ? (
                      <select
                        value={img.assignedTo ?? ''}
                        onChange={e => updateImage(idx, { assignedTo: e.target.value || null })}
                        className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                      >
                        <option value="">— Pomiń —</option>
                        <option value="all">Wszystkie produkty</option>
                        {products.map(p => (
                          <option key={p.id} value={p.id}>{p.name.slice(0, 40)}</option>
                        ))}
                      </select>
                    ) : (
                      <div className="text-xs text-green-600 flex items-center gap-1">
                        <Check className="size-3" /> Dodaj do galerii
                      </div>
                    )}

                    {/* Order + feature */}
                    <div className="flex gap-1.5 items-center">
                      <input
                        type="number"
                        min={0}
                        value={img.order}
                        onChange={e => updateImage(idx, { order: Number(e.target.value) })}
                        className="w-14 text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white focus:outline-none"
                        title="Kolejność"
                        placeholder="Kolejność"
                      />
                      <button
                        onClick={() => updateImage(idx, { isFeature: !img.isFeature })}
                        className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${img.isFeature ? 'bg-yellow-50 border-yellow-300 text-yellow-700' : 'border-gray-200 text-gray-400 hover:bg-gray-50'}`}
                        title="Ustaw jako miniaturkę"
                      >
                        <Star className="size-3" /> Miniaturka
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4 border-t shrink-0">
          <Button variant="outline" onClick={onCancel} className="flex-1">
            Anuluj
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={uploading || assignedCount === 0 || analyzingCount > 0}
            className="flex-1 gap-2"
          >
            {uploading ? (
              <><Loader2 className="size-4 animate-spin" /> Wgrywam...</>
            ) : (
              <><Upload className="size-4" /> Wgraj {assignedCount} zdjęć do galerii</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
