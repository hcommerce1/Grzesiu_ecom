import { useQuery } from '@tanstack/react-query';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { BLProductListItem } from '../types';

// ─── Types ───

interface ProductListResponse {
  products: BLProductListItem[];
  totalCount: number;
  inventoryId: number;
}

interface DetailData {
  thumbnailUrl: string | null;
  manufacturerId: number;
  manufacturerName: string;
  price: number;
  isBundle?: boolean;
  variantIds?: string[];
  stock?: Record<string, number>;
  taxRate?: number;
  locations?: Record<string, string>;
  textFields?: Record<string, string>;
  quantity?: number;
}

export interface DetailsProgress {
  loaded: number;
  total: number;
  loading: boolean;
}

// ─── Main hook: fast list + progressive details ───

const DETAIL_BATCH_SIZE = 100;

export function useBLProductList() {
  // Phase 1: Fast product list
  const listQuery = useQuery<ProductListResponse>({
    queryKey: ['bl-products-list'],
    queryFn: async () => {
      const res = await fetch('/api/bl-products');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Phase 2: Progressive detail loading
  const [detailsMap, setDetailsMap] = useState<Map<string, DetailData>>(new Map());
  const [detailsProgress, setDetailsProgress] = useState<DetailsProgress>({
    loaded: 0,
    total: 0,
    loading: false,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Re-run details whenever list data updates (including refetches)
  const dataUpdatedAt = listQuery.dataUpdatedAt;

  useEffect(() => {
    const data = listQuery.data;
    if (!data || data.products.length === 0) return;

    const { products, inventoryId } = data;
    const allIds = products.map((p) => p.id);

    // Abort previous detail loading
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // Keep existing data — new data will overwrite progressively
    setIsRefreshing(detailsMap.size > 0);
    setDetailsProgress({ loaded: 0, total: allIds.length, loading: true });

    (async () => {
      const CONCURRENCY = 3;
      const batches: string[][] = [];
      for (let i = 0; i < allIds.length; i += DETAIL_BATCH_SIZE) {
        batches.push(allIds.slice(i, i + DETAIL_BATCH_SIZE));
      }

      let completedProducts = 0;

      async function fetchBatch(batch: string[]) {
        if (ctrl.signal.aborted) return;
        try {
          const res = await fetch('/api/bl-products/details', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inventory_id: inventoryId, product_ids: batch }),
            signal: ctrl.signal,
          });

          if (!res.ok) return;
          const json = await res.json();
          if (ctrl.signal.aborted) return;

          setDetailsMap((prev) => {
            const next = new Map(prev);
            for (const [id, detail] of Object.entries(json.details as Record<string, DetailData>)) {
              next.set(id, detail);
            }
            return next;
          });
        } catch (e) {
          if (e instanceof Error && e.name === 'AbortError') return;
        }

        completedProducts += batch.length;
        if (!ctrl.signal.aborted) {
          setDetailsProgress((prev) => ({
            ...prev,
            loaded: Math.min(completedProducts, allIds.length),
          }));
        }
      }

      let idx = 0;
      async function runWorker() {
        while (idx < batches.length) {
          if (ctrl.signal.aborted) return;
          const currentIdx = idx++;
          await fetchBatch(batches[currentIdx]);
        }
      }

      const workers = Array.from(
        { length: Math.min(CONCURRENCY, batches.length) },
        () => runWorker()
      );
      await Promise.all(workers);

      if (!ctrl.signal.aborted) {
        setDetailsProgress((prev) => ({ ...prev, loading: false }));
        setIsRefreshing(false);
      }
    })();

    return () => {
      ctrl.abort();
    };
  }, [dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Proactive background refresh — every 50min (before 1h cache expiry)
  const PROACTIVE_REFRESH_MS = 50 * 60 * 1000;
  useEffect(() => {
    if (!listQuery.data) return;
    const timer = setInterval(() => {
      listQuery.refetch();
    }, PROACTIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [listQuery.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Merge list + details
  const products = useMemo(() => {
    const list = listQuery.data?.products;
    if (!list) return [];
    if (detailsMap.size === 0) return list;

    return list.map((p) => {
      const detail = detailsMap.get(p.id);
      if (!detail) return p;

      // Correct product type from detailed data if list data was incomplete
      let productType = p.productType;
      if (detail.isBundle && productType !== 'bundle') {
        productType = 'bundle';
      } else if (detail.variantIds && detail.variantIds.length > 0 && productType === 'basic') {
        productType = 'parent';
      }

      const { isBundle: _ib, variantIds: _vi, ...restDetail } = detail;
      return { ...p, ...restDetail, productType, isBundle: detail.isBundle ?? p.isBundle };
    });
  }, [listQuery.data, detailsMap]);

  const inventoryId = listQuery.data?.inventoryId;

  return {
    products,
    inventoryId,
    isLoading: listQuery.isLoading,
    isFetching: listQuery.isFetching,
    isRefreshing,
    error: listQuery.error,
    refetch: listQuery.refetch,
    detailsProgress,
  };
}

// ─── Separate hook for single product detail (batch edit) ───

export function useBLProductDetails(productIds: string[], inventoryId: number, enabled: boolean) {
  return useQuery({
    queryKey: ['bl-product-details', ...productIds],
    queryFn: async () => {
      const res = await fetch('/api/baselinker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'getInventoryProductsData',
          parameters: { inventory_id: inventoryId, products: productIds },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled,
    staleTime: 2 * 60 * 1000,
  });
}
