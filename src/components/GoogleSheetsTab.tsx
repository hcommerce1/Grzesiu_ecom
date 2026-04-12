"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Clock,
  Zap,
  ExternalLink,
  SkipForward,
  XCircle,
  Edit3,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BaselinkerWorkflowPanel } from "@/components/BaselinkerWorkflowPanel";
import { cn } from "@/lib/utils";
import type { SheetProductRow } from "@/lib/db";
import type { ProductData, SheetMeta } from "@/lib/types";

// ─── Status helpers ───

type Status = SheetProductRow["status"];

const STATUS_CONFIG: Record<
  Status,
  { label: string; color: string; icon: React.ReactNode; pulse?: boolean }
> = {
  new: { label: "", color: "", icon: null },
  queued: {
    label: "W kolejce",
    color: "bg-gray-100 text-gray-600 border-gray-200",
    icon: <Clock className="size-3" />,
  },
  scraping: {
    label: "Scrapuję...",
    color: "bg-yellow-50 text-yellow-700 border-yellow-200",
    icon: <Loader2 className="size-3 animate-spin" />,
    pulse: true,
  },
  in_progress: {
    label: "W trakcie",
    color: "bg-blue-50 text-blue-700 border-blue-200",
    icon: <Zap className="size-3" />,
  },
  done: {
    label: "Dodany",
    color: "bg-green-50 text-green-700 border-green-200",
    icon: <CheckCircle2 className="size-3" />,
  },
  error: {
    label: "Błąd",
    color: "bg-red-50 text-red-700 border-red-200",
    icon: <AlertCircle className="size-3" />,
  },
};

function StatusBadge({ product }: { product: SheetProductRow }) {
  const cfg = STATUS_CONFIG[product.status];
  if (!cfg.label) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border",
        cfg.color,
        cfg.pulse && "animate-pulse"
      )}
      title={product.status === "error" ? product.error_message ?? "" : undefined}
    >
      {cfg.icon}
      {cfg.label}
      {product.status === "done" && product.bl_product_id && (
        <span className="text-[10px] opacity-70">BL:{product.bl_product_id}</span>
      )}
    </span>
  );
}

// ─── Main component ───

interface SheetsBatchState {
  queue: string[]; // IDs of products in batch
  currentIndex: number;
  currentProductData: ProductData | null;
  currentSheetMeta: SheetMeta | null;
  currentId: string | null;
}

export function GoogleSheetsTab() {
  const [active, setActive] = useState<SheetProductRow[]>([]);
  const [done, setDone] = useState<SheetProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [doneExpanded, setDoneExpanded] = useState(false);
  const [urlDrafts, setUrlDrafts] = useState<Record<string, string>>({});

  // Batch workflow state
  const [batch, setBatch] = useState<SheetsBatchState | null>(null);
  const abortRef = useRef(false);

  // ─── Data fetching ───

  const [syncing, setSyncing] = useState(false);

  const applyData = useCallback((data: { active?: SheetProductRow[]; done?: SheetProductRow[] }) => {
    setActive(data.active ?? []);
    setDone(data.done ?? []);

    const drafts: Record<string, string> = {};
    for (const p of [...(data.active ?? []), ...(data.done ?? [])]) {
      if (p.scrape_url) drafts[p.id] = p.scrape_url;
    }
    setUrlDrafts((prev) => ({ ...prev, ...drafts }));
  }, []);

  // Load cached data from SQLite (instant)
  const fetchCached = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sheets/products");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      applyData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd pobierania danych");
    } finally {
      setLoading(false);
    }
  }, [applyData]);

  // Sync from Google Sheets (slower, runs in background)
  const syncFromSheets = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/sheets/products", { method: "POST" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      applyData(data);
    } catch (err) {
      console.error("Sync error:", err);
    } finally {
      setSyncing(false);
    }
  }, [applyData]);

  // On mount: load cache instantly, then sync in background
  useEffect(() => {
    fetchCached().then(() => syncFromSheets());
  }, [fetchCached, syncFromSheets]);

  // Auto-sync every 5 minutes
  useEffect(() => {
    const interval = setInterval(syncFromSheets, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [syncFromSheets]);

  // ─── Selection ───

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    const selectableIds = active
      .filter((p) => p.status === "new" || p.status === "error")
      .map((p) => p.id);
    setSelected(new Set(selectableIds));
  }

  function deselectAll() {
    setSelected(new Set());
  }

  // ─── URL saving ───

  async function saveUrl(id: string, url: string) {
    try {
      await fetch(`/api/sheets/products/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scrape_url: url }),
      });
    } catch {
      // silent — URL will be re-saved on next attempt
    }
  }

  // ─── Batch start ───

  async function startBatch() {
    const queue = Array.from(selected).filter((id) => {
      const product = active.find((p) => p.id === id);
      if (!product) return false;
      const url = urlDrafts[id] ?? product.scrape_url;
      return url && url.trim().length > 0;
    });

    if (queue.length === 0) {
      setError("Zaznacz produkty z wklejonymi URL-ami.");
      return;
    }

    // Check for products without URLs
    const noUrl = Array.from(selected).filter((id) => !queue.includes(id));
    if (noUrl.length > 0) {
      const names = noUrl
        .map((id) => active.find((p) => p.id === id)?.nazwa ?? id)
        .join(", ");
      setError(`Pominięto produkty bez URL: ${names}`);
    }

    // Mark all as queued
    for (const id of queue) {
      await fetch(`/api/sheets/products/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "queued" }),
      });
    }

    abortRef.current = false;
    setSelected(new Set());
    setBatch({ queue, currentIndex: 0, currentProductData: null, currentSheetMeta: null, currentId: null });
    processBatchItem(queue, 0);
  }

  // ─── Process single batch item ───

  async function processBatchItem(queue: string[], index: number) {
    if (index >= queue.length || abortRef.current) {
      setBatch(null);
      fetchCached();
      return;
    }

    const id = queue[index];
    const product = active.find((p) => p.id === id);
    if (!product) {
      processBatchItem(queue, index + 1);
      return;
    }

    // Ensure URL is saved
    const url = urlDrafts[id] ?? product.scrape_url;
    if (url !== product.scrape_url) {
      await saveUrl(id, url);
    }

    setBatch((prev) =>
      prev ? { ...prev, currentIndex: index, currentId: id, currentProductData: null, currentSheetMeta: null } : null
    );

    // Scrape
    try {
      const res = await fetch(`/api/sheets/products/${encodeURIComponent(id)}/scrape`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();

      if (!data.success) {
        // Error — update local state, skip to next
        setActive((prev) =>
          prev.map((p) => (p.id === id ? { ...p, status: "error" as const, error_message: data.error } : p))
        );
        processBatchItem(queue, index + 1);
        return;
      }

      // Success — show workflow panel
      setActive((prev) => prev.map((p) => (p.id === id ? { ...p, status: "in_progress" as const } : p)));
      setBatch((prev) =>
        prev
          ? {
              ...prev,
              currentProductData: data.data as ProductData,
              currentSheetMeta: data.sheetMeta as SheetMeta,
            }
          : null
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Scraping failed";
      setActive((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: "error" as const, error_message: message } : p))
      );
      processBatchItem(queue, index + 1);
    }
  }

  // ─── Workflow callbacks ───

  function handleWorkflowClose() {
    // User closed workflow — keep status as in_progress, move to next
    if (batch) {
      processBatchItem(batch.queue, batch.currentIndex + 1);
    }
  }

  function handleWorkflowDone(blProductId: number) {
    if (batch?.currentId) {
      // Mark done locally
      setActive((prev) => prev.filter((p) => p.id !== batch.currentId));
      setDone((prev) => [
        ...prev,
        {
          ...active.find((p) => p.id === batch.currentId)!,
          status: "done" as const,
          bl_product_id: String(blProductId),
        },
      ]);

      // Move to next
      processBatchItem(batch.queue, batch.currentIndex + 1);
    }
  }

  function skipCurrent() {
    if (batch) {
      processBatchItem(batch.queue, batch.currentIndex + 1);
    }
  }

  function cancelBatch() {
    abortRef.current = true;
    setBatch(null);
    fetchCached();
  }

  // ─── Resume in-progress ───

  const inProgressProducts = active.filter(
    (p) => p.status === "in_progress" || p.status === "scraping"
  );

  // ─── Render ───

  if (batch && batch.currentProductData && batch.currentId) {
    const currentProduct = active.find((p) => p.id === batch.currentId);
    return (
      <div className="space-y-4">
        {/* Batch progress bar */}
        <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Package className="size-4 text-primary" />
              Produkt {batch.currentIndex + 1}/{batch.queue.length}
            </div>
            <span className="text-sm text-muted-foreground truncate max-w-[300px]">
              {currentProduct?.nazwa ?? batch.currentId}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={skipCurrent} className="gap-1.5 text-xs">
              <SkipForward className="size-3.5" />
              Pomiń
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelBatch} className="gap-1.5 text-xs text-destructive">
              <XCircle className="size-3.5" />
              Anuluj
            </Button>
          </div>
        </div>

        {/* Progress bar visual */}
        <div className="w-full bg-muted rounded-full h-1.5">
          <div
            className="bg-primary h-1.5 rounded-full transition-all duration-500"
            style={{ width: `${((batch.currentIndex + 1) / batch.queue.length) * 100}%` }}
          />
        </div>

        {/* Workflow panel */}
        <BaselinkerWorkflowPanel
          productData={batch.currentProductData}
          onClose={handleWorkflowClose}
          sheetProductId={batch.currentId}
          sheetMeta={batch.currentSheetMeta ?? undefined}
          onSheetDone={handleWorkflowDone}
        />
      </div>
    );
  }

  // Scraping in progress for a batch item
  if (batch && !batch.currentProductData) {
    const currentProduct = active.find((p) => p.id === batch.queue[batch.currentIndex]);
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="text-sm font-medium">
          Scrapuję produkt {batch.currentIndex + 1}/{batch.queue.length}
        </p>
        <p className="text-xs text-muted-foreground">{currentProduct?.nazwa ?? "..."}</p>
        <Button size="sm" variant="ghost" onClick={cancelBatch} className="gap-1.5 text-xs text-destructive">
          <XCircle className="size-3.5" />
          Anuluj
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Import z Google Sheets</h2>
          <p className="text-sm text-muted-foreground">
            Zaznacz produkty, wklej linki i wystaw na Allegro przez BaseLinker.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={syncFromSheets}
          disabled={loading || syncing}
          className="gap-1.5"
        >
          <RefreshCw className={cn("size-3.5", (loading || syncing) && "animate-spin")} />
          {syncing ? "Synchronizuję..." : "Odśwież"}
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 px-4 py-3 rounded-lg">
          <AlertCircle className="size-4 shrink-0" />
          {error}
          <button onClick={() => setError("")} className="ml-auto text-xs underline">
            Zamknij
          </button>
        </div>
      )}

      {/* In-progress resume banner */}
      {inProgressProducts.length > 0 && !batch && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-blue-200 bg-blue-50">
          <Zap className="size-4 text-blue-600" />
          <span className="text-sm text-blue-700">
            <strong>{inProgressProducts.length}</strong> produkt(ów) w trakcie wystawiania
          </span>
        </div>
      )}

      {/* Selection toolbar */}
      {active.length > 0 && (
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-3">
            <button
              onClick={selected.size > 0 ? deselectAll : selectAll}
              className="text-xs text-primary hover:underline"
            >
              {selected.size > 0 ? "Odznacz wszystko" : "Zaznacz wszystko"}
            </button>
            {selected.size > 0 && (
              <span className="text-xs text-muted-foreground">
                Zaznaczono: <strong>{selected.size}</strong>
              </span>
            )}
          </div>
          {selected.size > 0 && (
            <Button size="sm" onClick={startBatch} className="gap-1.5">
              <ExternalLink className="size-3.5" />
              Wystaw zaznaczone ({selected.size})
            </Button>
          )}
        </div>
      )}

      {/* Loading state */}
      {loading && active.length === 0 && (
        <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span className="text-sm">Ładowanie danych z arkusza...</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && active.length === 0 && done.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="size-16 rounded-2xl bg-muted border border-border flex items-center justify-center mb-4">
            <Package className="size-8 text-muted-foreground/40" />
          </div>
          <p className="text-sm text-muted-foreground">
            Brak produktów w arkuszu. Dodaj dane do Google Sheets i kliknij <strong>Odśwież</strong>.
          </p>
        </div>
      )}

      {/* Active products table */}
      {active.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="w-10 px-3 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={selected.size > 0 && selected.size === active.filter((p) => p.status === "new" || p.status === "error").length}
                      onChange={selected.size > 0 ? deselectAll : selectAll}
                      className="rounded border-border"
                    />
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    ID
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    SKU
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Nazwa
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    EAN
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Stan
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider min-w-[280px]">
                    URL producenta
                  </th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {active.map((product) => {
                  const isSelectable =
                    product.status === "new" || product.status === "error";
                  const isSelected = selected.has(product.id);

                  return (
                    <tr
                      key={product.id}
                      className={cn(
                        "border-b last:border-b-0 transition-colors",
                        isSelected && "bg-accent/40",
                        !isSelectable && "opacity-60"
                      )}
                    >
                      <td className="px-3 py-2 text-center">
                        {isSelectable ? (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(product.id)}
                            className="rounded border-border"
                          />
                        ) : (
                          <span className="text-muted-foreground/30">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        {product.id}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        {product.sku || "—"}
                      </td>
                      <td className="px-3 py-2 font-medium max-w-[200px] truncate" title={product.nazwa ?? ""}>
                        {product.nazwa || "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {product.ean || "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">{product.stan_techniczny || "—"}</td>
                      <td className="px-3 py-2">
                        <input
                          type="url"
                          value={urlDrafts[product.id] ?? product.scrape_url ?? ""}
                          onChange={(e) =>
                            setUrlDrafts((prev) => ({
                              ...prev,
                              [product.id]: e.target.value,
                            }))
                          }
                          onBlur={(e) => saveUrl(product.id, e.target.value)}
                          placeholder="https://..."
                          className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-xs placeholder:text-muted focus:outline-none focus:border-primary"
                          disabled={!isSelectable}
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <StatusBadge product={product} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Done products (collapsed) */}
      {done.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden">
          <button
            onClick={() => setDoneExpanded(!doneExpanded)}
            className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
          >
            {doneExpanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            Dodane do BaseLinker ({done.length})
          </button>

          {doneExpanded && (
            <div className="border-t">
              <table className="w-full text-sm">
                <tbody>
                  {done.map((product) => (
                    <tr key={product.id} className="border-b last:border-b-0 opacity-60 hover:opacity-100 transition-opacity">
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                        {product.sku || product.id}
                      </td>
                      <td className="px-3 py-2 font-medium max-w-[250px] truncate">
                        {product.nazwa || "—"}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="secondary" className="text-[10px]">
                          BL: {product.bl_product_id}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1 text-xs h-7"
                          onClick={() => {
                            // Navigate to edit tab with this product
                            // For now, we emit a custom event that page.tsx can listen to
                            window.dispatchEvent(
                              new CustomEvent("sheets:edit-product", {
                                detail: { productId: product.bl_product_id },
                              })
                            );
                          }}
                        >
                          <Edit3 className="size-3" />
                          Edytuj
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
