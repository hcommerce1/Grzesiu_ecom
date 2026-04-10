'use client';

import { useState, useRef, useEffect } from 'react';
import { CopyButton } from './CopyButton';
import { ExternalLink, ChevronLeft, ChevronRight, Download, Loader2, Barcode, Tag } from 'lucide-react';
import type { ProductData } from '@/lib/types';

interface ProductDisplayProps {
    product: ProductData;
    originalProduct?: ProductData | null;
}

export function ProductDisplay({ product, originalProduct }: ProductDisplayProps) {
    const [viewMode, setViewMode] = useState<'translated' | 'original'>('translated');

    const displayProduct = viewMode === 'original' && originalProduct ? originalProduct : product;

    return (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* View Toggle */}
            {originalProduct && (
                <div className="flex justify-end mb-4">
                    <div className="inline-flex bg-card border border-border rounded-xl p-1">
                        <button
                            onClick={() => setViewMode('translated')}
                            className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-colors ${viewMode === 'translated'
                                ? 'bg-accent/10 text-accent'
                                : 'text-muted hover:text-foreground'
                                }`}
                        >
                            Polski (Tłumaczenie)
                        </button>
                        <button
                            onClick={() => setViewMode('original')}
                            className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-colors ${viewMode === 'original'
                                ? 'bg-accent/10 text-accent'
                                : 'text-muted hover:text-foreground'
                                }`}
                        >
                            Oryginał
                        </button>
                    </div>
                </div>
            )}

            {/* Title Card */}
            <TitleCard
                title={displayProduct.title}
                url={displayProduct.url}
                price={displayProduct.price}
                currency={displayProduct.currency}
                ean={displayProduct.ean}
                sku={displayProduct.sku}
            />

            {/* Image Gallery */}
            {displayProduct.images.length > 0 && (
                <ImageGallery images={displayProduct.images} zipFilename={displayProduct.ean || displayProduct.sku || 'product_images'} />
            )}

            {/* Description */}
            {displayProduct.description && <DescriptionCard description={displayProduct.description} />}

            {/* Attributes Table */}
            {Object.keys(displayProduct.attributes).length > 0 && (
                <AttributesCard attributes={displayProduct.attributes} />
            )}
        </div>
    );
}

/* ─── Title Card ─── */
function TitleCard({ title: initialTitle, url, price, currency, ean, sku }: { title: string; url: string; price?: string; currency?: string; ean?: string; sku?: string }) {
    const [isEditing, setIsEditing] = useState(false);
    const [title, setTitle] = useState(initialTitle);

    // Sync with upstream prop change
    useEffect(() => {
        setTitle(initialTitle);
    }, [initialTitle]);

    return (
        <div className="group bg-card rounded-2xl border border-border hover:border-border-hover transition-all duration-300 p-6">
            <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-[11px] font-medium uppercase tracking-wider text-accent">
                            Product Title
                        </span>
                        <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted hover:text-accent transition-colors"
                        >
                            <ExternalLink className="w-3 h-3" />
                        </a>
                    </div>
                    {isEditing ? (
                        <textarea
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            onBlur={() => setIsEditing(false)}
                            autoFocus
                            className="w-full text-xl font-semibold text-foreground leading-snug bg-transparent border-b border-accent/50 focus:outline-none resize-none overflow-hidden min-h-[40px] px-1 -mx-1"
                            onInput={(e) => {
                                const target = e.target as HTMLTextAreaElement;
                                target.style.height = 'auto';
                                target.style.height = `${target.scrollHeight}px`;
                            }}
                        />
                    ) : (
                        <h3
                            className="text-xl font-semibold text-foreground leading-snug cursor-text hover:bg-foreground/5 rounded px-1 -mx-1 transition-colors"
                            onClick={() => setIsEditing(true)}
                        >
                            {title}
                        </h3>
                    )}
                    {price && (
                        <p className="mt-3 text-2xl font-bold text-accent">
                            {currency && <span className="text-sm font-normal text-muted mr-1">{currency}</span>}
                            {price}
                        </p>
                    )}
                    {/* EAN / SKU badges */}
                    <div className="mt-3 flex items-center gap-3 flex-wrap">
                        {ean && (
                            <div className="group/badge flex items-center gap-1.5 text-xs text-muted bg-card-hover px-2.5 py-1 rounded-lg border border-border">
                                <Barcode className="w-3 h-3" />
                                <span className="text-muted/70">EAN:</span>
                                <span className="text-foreground font-mono">{ean}</span>
                                <CopyButton text={ean} className="ml-1 opacity-0 group-hover/badge:opacity-100" />
                            </div>
                        )}
                        {sku && (
                            <div className="group/badge flex items-center gap-1.5 text-xs text-muted bg-card-hover px-2.5 py-1 rounded-lg border border-border">
                                <Tag className="w-3 h-3" />
                                <span className="text-muted/70">SKU:</span>
                                <span className="text-foreground font-mono">{sku}</span>
                                <CopyButton text={sku} className="ml-1 opacity-0 group-hover/badge:opacity-100" />
                            </div>
                        )}
                    </div>
                </div>
                <CopyButton
                    text={title}
                    variant="button"
                    label="Copy Title"
                    className="opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                />
            </div>
        </div>
    );
}

/* ─── Image Gallery ─── */
function ImageGallery({ images, zipFilename }: { images: string[]; zipFilename: string }) {
    const [scrollRef, setScrollRef] = useState<HTMLDivElement | null>(null);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [downloading, setDownloading] = useState(false);

    const scroll = (direction: 'left' | 'right') => {
        if (!scrollRef) return;
        const scrollAmount = direction === 'left' ? -250 : 250;
        scrollRef.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    };

    const handleDownloadZip = async () => {
        setDownloading(true);
        try {
            const res = await fetch('/api/download-images', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ images, filename: zipFilename }),
            });

            if (!res.ok) throw new Error('Download failed');

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${zipFilename}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('ZIP download failed:', err);
        } finally {
            setDownloading(false);
        }
    };

    return (
        <>
            <div className="group bg-card rounded-2xl border border-border hover:border-border-hover transition-all duration-300 p-6">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium uppercase tracking-wider text-accent">
                            Images
                        </span>
                        <span className="text-[11px] text-muted bg-card-hover px-2 py-0.5 rounded-full">
                            {images.length}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Download ZIP button */}
                        <button
                            onClick={handleDownloadZip}
                            disabled={downloading}
                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all duration-200 bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-50"
                        >
                            {downloading ? (
                                <>
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    Downloading…
                                </>
                            ) : (
                                <>
                                    <Download className="w-3 h-3" />
                                    Download All ({images.length})
                                </>
                            )}
                        </button>
                        <div className="flex gap-1 ml-1">
                            <button
                                onClick={() => scroll('left')}
                                className="p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-card-hover transition-colors"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => scroll('right')}
                                className="p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-card-hover transition-colors"
                            >
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>

                <div
                    ref={(el) => setScrollRef(el)}
                    className="flex gap-3 overflow-x-auto scrollbar-hide pb-2"
                >
                    {images.map((src, i) => (
                        <button
                            key={i}
                            onClick={() => setSelectedImage(src)}
                            className="flex-shrink-0 w-40 h-40 rounded-xl bg-white/5 border border-border hover:border-accent/50 overflow-hidden transition-all duration-200 hover:scale-[1.02] group/img"
                        >
                            <img
                                src={src}
                                alt={`Product image ${i + 1}`}
                                className="w-full h-full object-contain p-2"
                                loading="lazy"
                                onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    target.style.display = 'none';
                                    const parent = target.parentElement;
                                    if (parent) {
                                        const placeholder = document.createElement('div');
                                        placeholder.className = 'w-full h-full flex items-center justify-center text-muted';
                                        placeholder.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
                                        parent.appendChild(placeholder);
                                    }
                                }}
                            />
                        </button>
                    ))}
                </div>
            </div>

            {/* Lightbox */}
            {selectedImage && (
                <div
                    className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-8 animate-in fade-in duration-200"
                    onClick={() => setSelectedImage(null)}
                >
                    <div className="relative max-w-3xl max-h-[80vh]">
                        <img
                            src={selectedImage}
                            alt="Product image enlarged"
                            className="max-w-full max-h-[80vh] object-contain rounded-xl"
                        />
                        <CopyButton
                            text={selectedImage}
                            variant="button"
                            label="Copy URL"
                            className="absolute top-3 right-3"
                        />
                    </div>
                </div>
            )}
        </>
    );
}

/* ─── Description Card ─── */
function DescriptionCard({ description: initialDescription }: { description: string }) {
    const [expanded, setExpanded] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [description, setDescription] = useState(initialDescription);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Sync with upstream prop change
    useEffect(() => {
        setDescription(initialDescription);
    }, [initialDescription]);

    // Auto-resize textarea when editing starts or content changes
    useEffect(() => {
        if (isEditing && textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [isEditing, description]);

    const isLong = description.length > 500;
    const displayText = isLong && !expanded && !isEditing ? description.slice(0, 500) + '…' : description;

    return (
        <div className="group bg-card rounded-2xl border border-border hover:border-border-hover transition-all duration-300 p-6">
            <div className="flex items-start justify-between gap-4 mb-3">
                <span className="text-[11px] font-medium uppercase tracking-wider text-accent">
                    Description
                </span>
                <CopyButton
                    text={description}
                    variant="button"
                    label="Copy"
                    className="opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                />
            </div>
            {isEditing ? (
                <textarea
                    ref={textareaRef}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    onBlur={() => setIsEditing(false)}
                    autoFocus
                    className="w-full text-sm text-foreground/80 leading-relaxed bg-transparent border-b border-accent/50 focus:outline-none resize-none overflow-hidden min-h-[150px] p-2 -mx-2 bg-card-hover rounded-lg"
                />
            ) : (
                <div
                    className="text-sm text-foreground/80 leading-relaxed whitespace-pre-line cursor-text hover:bg-foreground/5 p-2 -mx-2 rounded-lg transition-colors"
                    onClick={() => {
                        setIsEditing(true);
                        setExpanded(true);
                    }}
                >
                    {displayText}
                </div>
            )}
            {isLong && !isEditing && (
                <button
                    onClick={() => setExpanded(!expanded)}
                    className="mt-3 text-xs text-accent hover:text-accent-hover transition-colors"
                >
                    {expanded ? 'Show less' : 'Show more'}
                </button>
            )}
        </div>
    );
}

/* ─── Attributes Card ─── */
function AttributesCard({ attributes }: { attributes: Record<string, string> }) {
    const entries = Object.entries(attributes);

    const copyAll = () => {
        return entries.map(([k, v]) => `${k}: ${v}`).join('\n');
    };

    return (
        <div className="group bg-card rounded-2xl border border-border hover:border-border-hover transition-all duration-300 p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-accent">
                        Specifications
                    </span>
                    <span className="text-[11px] text-muted bg-card-hover px-2 py-0.5 rounded-full">
                        {entries.length}
                    </span>
                </div>
                <CopyButton
                    text={copyAll()}
                    variant="button"
                    label="Copy All"
                    className="opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                />
            </div>

            <div className="divide-y divide-border/50">
                {entries.map(([key, value], i) => (
                    <div
                        key={i}
                        className="group/row flex items-center justify-between py-2.5 text-sm hover:bg-card-hover/50 -mx-3 px-3 rounded-lg transition-colors"
                    >
                        <span className="text-muted font-medium min-w-[140px]">{key}</span>
                        <div className="flex items-center gap-2">
                            <span className="text-foreground text-right">{value}</span>
                            <CopyButton
                                text={`${key}: ${value}`}
                                className="opacity-0 group-hover/row:opacity-100"
                            />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
