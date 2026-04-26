'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Search, Plus, Minus, Trash2, Loader2, Package } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { BLProductListItem } from '@/lib/types';

interface BundleProductsPickerProps {
  inventoryId?: number;
  bundleProducts: Record<string, number>;
  onChange: (val: Record<string, number>) => void;
}

export function BundleProductsPicker({ inventoryId, bundleProducts, onChange }: BundleProductsPickerProps) {
  // null = nie załadowane jeszcze; [] = załadowane bez wyników
  const [products, setProducts] = useState<BLProductListItem[] | null>(null);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  // Loading derived from products state — eliminuje set-state-in-effect anti-pattern
  const loading = inventoryId != null && products === null;

  // Load products from BL
  useEffect(() => {
    if (!inventoryId) return;
    let cancelled = false;
    const url = `/api/bl-products?inventory_id=${inventoryId}`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setProducts(data.products ?? []);
      })
      .catch(() => { if (!cancelled) setProducts([]); });
    return () => { cancelled = true; };
  }, [inventoryId]);

  const addProduct = useCallback(
    (productId: string) => {
      if (bundleProducts[productId]) return;
      onChange({ ...bundleProducts, [productId]: 1 });
      setShowSearch(false);
      setSearch('');
    },
    [bundleProducts, onChange]
  );

  const updateQuantity = useCallback(
    (productId: string, qty: number) => {
      if (qty < 1) return;
      onChange({ ...bundleProducts, [productId]: qty });
    },
    [bundleProducts, onChange]
  );

  const removeProduct = useCallback(
    (productId: string) => {
      const next = { ...bundleProducts };
      delete next[productId];
      onChange(next);
    },
    [bundleProducts, onChange]
  );

  const productList = products ?? [];
  const productMap = new Map(productList.map((p) => [p.id, p]));

  // Filter available products (exclude already selected, exclude bundles)
  const selectedIds = new Set(Object.keys(bundleProducts));
  const searchNorm = search.toLowerCase();
  const filteredProducts = productList.filter((p) => {
    if (selectedIds.has(p.id)) return false;
    if (p.productType === 'bundle') return false;
    if (!search) return true;
    return (
      p.name.toLowerCase().includes(searchNorm) ||
      p.sku.toLowerCase().includes(searchNorm) ||
      p.ean.includes(search) ||
      p.id.includes(search)
    );
  });

  const selectedEntries = Object.entries(bundleProducts);

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Produkty składowe zestawu
        </span>
        <span className="text-xs text-muted-foreground">
          {selectedEntries.length} {selectedEntries.length === 1 ? 'produkt' : 'produktów'}
        </span>
      </div>

      {/* Selected products */}
      {selectedEntries.length > 0 && (
        <div className="space-y-1.5">
          {selectedEntries.map(([id, qty]) => {
            const product = productMap.get(id);
            return (
              <div
                key={id}
                className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2"
              >
                <Package className="size-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">
                    {product?.name || `Produkt #${id}`}
                  </p>
                  {product && (product.sku || product.ean) && (
                    <p className="text-[10px] text-muted-foreground">
                      {[product.sku && `SKU: ${product.sku}`, product.ean && `EAN: ${product.ean}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                </div>

                {/* Quantity controls */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => updateQuantity(id, qty - 1)}
                    disabled={qty <= 1}
                    className="size-7 flex items-center justify-center rounded border border-input hover:bg-muted disabled:opacity-30"
                  >
                    <Minus className="size-3" />
                  </button>
                  <input
                    type="number"
                    min={1}
                    value={qty}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      if (!isNaN(n) && n >= 1) updateQuantity(id, n);
                    }}
                    className="w-12 h-7 text-center text-sm rounded border border-input bg-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => updateQuantity(id, qty + 1)}
                    className="size-7 flex items-center justify-center rounded border border-input hover:bg-muted"
                  >
                    <Plus className="size-3" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => removeProduct(id)}
                  className="size-7 flex items-center justify-center rounded border border-input hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add product */}
      {!showSearch ? (
        <button
          type="button"
          onClick={() => setShowSearch(true)}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
        >
          <Plus className="size-4" />
          Dodaj produkt składowy
        </button>
      ) : (
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Szukaj po nazwie, SKU, EAN lub ID..."
              className="pl-9"
              autoFocus
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Ładowanie produktów...
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border">
              {filteredProducts.length === 0 ? (
                <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                  {search ? 'Brak wyników' : 'Brak dostępnych produktów'}
                </div>
              ) : (
                filteredProducts.slice(0, 50).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addProduct(p.id)}
                    className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-accent transition-colors"
                  >
                    <Package className="size-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{p.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {[
                          `ID: ${p.id}`,
                          p.sku && `SKU: ${p.sku}`,
                          p.ean && `EAN: ${p.ean}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <Plus className="size-4 text-primary shrink-0" />
                  </button>
                ))
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setShowSearch(false);
              setSearch('');
            }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Anuluj
          </button>
        </div>
      )}
    </div>
  );
}
