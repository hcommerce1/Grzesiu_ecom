'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { ProductDisplay } from './ProductDisplay';
import type { ProductData } from '@/lib/types';

export type ScrapedItemStatus = 'pending' | 'loading' | 'success' | 'error';

export interface ScrapedItem {
    url: string;
    status: ScrapedItemStatus;
    product?: ProductData;
    originalProduct?: ProductData | null;
    error?: string;
}

interface CollapsibleProductItemProps {
    item: ScrapedItem;
    index: number;
}

export function CollapsibleProductItem({ item, index }: CollapsibleProductItemProps) {
    const [isOpen, setIsOpen] = useState(false);

    const hasData = item.status === 'success' && item.product;

    const getHostName = (urlString: string) => {
        try { return new URL(urlString).hostname; } catch { return urlString; }
    };

    return (
        <div className="bg-card border border-border rounded-2xl overflow-hidden transition-all duration-300 hover:border-border-hover">
            {/* Header / Summary Row */}
            <div
                className={`p-4 flex items-center justify-between gap-4 cursor-pointer select-none transition-colors ${isOpen ? 'bg-card-hover/50' : 'hover:bg-card-hover/10'}`}
                onClick={() => {
                    if (hasData || item.status === 'error') {
                        setIsOpen(!isOpen);
                    }
                }}
            >
                <div className="flex items-center gap-4 flex-1 min-w-0">
                    <span className="text-muted text-sm font-medium w-6 text-right">{index + 1}.</span>

                    {/* Status Icon */}
                    <div className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-background border border-border">
                        {item.status === 'pending' && <div className="w-2 h-2 rounded-full bg-muted/30" />}
                        {item.status === 'loading' && <Loader2 className="w-4 h-4 text-accent animate-spin" />}
                        {item.status === 'success' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                        {item.status === 'error' && <XCircle className="w-4 h-4 text-red-500" />}
                    </div>

                    {/* Title / URL */}
                    <div className="flex-1 min-w-0 truncate">
                        <p className="text-sm font-medium text-foreground truncate">
                            {hasData ? item.product!.title : getHostName(item.url)}
                        </p>
                        <p className="text-xs text-muted truncate">
                            {item.url}
                        </p>
                    </div>

                    {/* Price if available */}
                    {hasData && item.product!.price && (
                        <div className="hidden sm:block text-right whitespace-nowrap">
                            <span className="text-sm font-semibold text-foreground">
                                {item.product!.price} {item.product!.currency}
                            </span>
                        </div>
                    )}
                </div>

                {/* Chevron */}
                {(hasData || item.status === 'error') && (
                    <div className="flex-shrink-0 text-muted">
                        {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                )}
            </div>

            {/* Expanded Content */}
            {isOpen && (
                <div className="border-t border-border p-6 bg-background/50 animate-in fade-in duration-300 slide-in-from-top-2">
                    {item.status === 'error' && (
                        <div className="text-sm text-red-500 bg-red-500/10 p-4 rounded-xl">
                            {item.error}
                        </div>
                    )}
                    {hasData && (
                        <ProductDisplay product={item.product!} originalProduct={item.originalProduct} />
                    )}
                </div>
            )}
        </div>
    );
}
