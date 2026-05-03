"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  RefreshCw,
  RotateCcw,
  Loader2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  AlertCircle,
  CheckCircle2,
  Clock,
  Zap,
  ExternalLink,
  SkipForward,
  XCircle,
  Edit3,
  Package,
  Play,
  X,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PaginationControls } from "@/components/ui/pagination";
import { BaselinkerWorkflowPanel } from "@/components/BaselinkerWorkflowPanel";
import { cn } from "@/lib/utils";
import type { SheetProductRow } from "@/lib/db";
import type { ProductData, SheetMeta } from "@/lib/types";

// ─── Image helpers ───

function firstImageUrl(zdjecie: string | null | undefined): string | null {
  if (!zdjecie) return null;
  // Support comma-separated, semicolon-separated, or newline-separated URLs
  const first = zdjecie.split(/[,;\n]/)[0].trim();
  // Fallback: extract URL from =IMAGE("url") formula (Google Sheets formula syntax)
  const imageMatch = first.match(/=IMAGE\("([^"]+)"/i);
  const url = imageMatch ? imageMatch[1] : first;
  return url.startsWith("http") ? url : null;
}

function Thumbnail({ src }: { src: string | null }) {
  const [errored, setErrored] = useState(false);
  if (!src || errored) return <span className="text-muted-foreground/40 text-xs">—</span>;
  return (
    <img
      src={src}
      alt=""
      className="size-12 object-cover rounded-md border border-border bg-white"
      loading="lazy"
      onError={() => setErrored(true)}
    />
  );
}

type SheetSortField = "id" | "sku" | "nazwa" | "ean" | "stan_techniczny";

function SortableHeader({
  field,
  label,
  align = "left",
  sortField,
  sortDirection,
  onSort,
}: {
  field: SheetSortField;
  label: string;
  align?: "left" | "center";
  sortField: SheetSortField | null;
  sortDirection: "asc" | "desc";
  onSort: (f: SheetSortField) => void;
}) {
  const isActive = sortField === field;
  const Icon = !isActive ? ChevronsUpDown : sortDirection === "asc" ? ChevronUp : ChevronDown;
  return (
    <th
      className={cn(
        "px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider",
        align === "center" ? "text-center" : "text-left",
      )}
    >
      <button
        onClick={() => onSort(field)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground transition-colors",
          isActive && "text-foreground",
        )}
      >
        {label}
        <Icon className={cn("size-3.5", isActive ? "opacity-100" : "opacity-40")} />
      </button>
    </th>
  );
}

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
    icon: <XCircle className="size-3" />,
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
  translationFailed?: boolean;
}

export function GoogleSheetsTab() {
  const [active, setActive] = useState<SheetProductRow[]>([]);
  const [done, setDone] = useState<SheetProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [doneExpanded, setDoneExpanded] = useState(false);
  const [urlDrafts, setUrlDrafts] = useState<Record<string, string>>({});
  const [batchScraping, setBatchScraping] = useState(false);

  // Batch workflow state
  const [batch, setBatch] = useState<SheetsBatchState | null>(null);
  const abortRef = useRef(false);

  // Pagination state
  const [activePage, setActivePage] = useState(1);
  const [activePerPage, setActivePerPage] = useState(25);
  const [donePage, setDonePage] = useState(1);
  const [donePerPage, setDonePerPage] = useState(25);

  // Status filter
  type StatusFilter = "all" | "ready" | "no_url" | "error" | "in_progress";
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Sort state — sortowanie po klik na nagłówek (ID, SKU, nazwa, stan, EAN)
  type SortField = "id" | "sku" | "nazwa" | "ean" | "stan_techniczny";
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
    setActivePage(1);
  };

  // Missing URL dialog
  const [missingUrlProducts, setMissingUrlProducts] = useState<SheetProductRow[]>([]);
  const [showMissingUrlDialog, setShowMissingUrlDialog] = useState(false);
  const [missingUrlDrafts, setMissingUrlDrafts] = useState<Record<string, string>>({});

  // Reset confirmation dialog
  const [showResetDialog, setShowResetDialog] = useState(false);

  // ─── Data fetching ───

  const [syncing, setSyncing] = useState(false);

  const applyData = useCallback((data: { active?: SheetProductRow[]; done?: SheetProductRow[] }) => {
    setActive(data.active ?? []);
    setDone(data.done ?? []);
    setActivePage(1);
    setDonePage(1);

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
      .filter((p) => {
        if (p.status !== "new" && p.status !== "error") return false;
        const url = urlDrafts[p.id] ?? p.scrape_url;
        return url && url.trim().length > 0;
      })
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

  // ─── Auto-scrape on URL paste ───

  async function autoScrapeOnPaste(productId: string, pastedUrl: string) {
    setUrlDrafts((prev) => ({ ...prev, [productId]: pastedUrl }));
    await saveUrl(productId, pastedUrl);
    await fetch('/api/sheets/batch-scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [productId] }),
    });
    setTimeout(() => syncFromSheets(), 2000);
  }

  // ─── Batch scraping (background) ───

  async function handleBatchScrape() {
    const ids = Array.from(selected).filter(id => {
      const p = active.find(p => p.id === id);
      return p && (urlDrafts[id] || p.scrape_url);
    });
    if (ids.length === 0) return;
    setBatchScraping(true);
    try {
      // Save URL drafts first
      await Promise.all(
        ids
          .filter(id => urlDrafts[id])
          .map(id =>
            fetch(`/api/sheets/products/${encodeURIComponent(id)}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ scrape_url: urlDrafts[id] }),
            })
          )
      );
      await fetch('/api/sheets/batch-scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      // Refresh list after a moment
      setTimeout(() => syncFromSheets(), 1500);
    } finally {
      setBatchScraping(false);
    }
  }

  // ─── Batch start ───

  async function startBatch(forceSkipMissing = false) {
    const queue = Array.from(selected).filter((id) => {
      const product = active.find((p) => p.id === id);
      if (!product) return false;
      const url = urlDrafts[id] ?? product.scrape_url;
      return url && url.trim().length > 0;
    });

    // Check for products without URLs
    const noUrl = Array.from(selected).filter((id) => !queue.includes(id));
    if (noUrl.length > 0 && !forceSkipMissing) {
      const products = noUrl
        .map((id) => active.find((p) => p.id === id))
        .filter((p): p is SheetProductRow => p != null);
      setMissingUrlProducts(products);
      setMissingUrlDrafts({});
      setShowMissingUrlDialog(true);
      return;
    }

    if (queue.length === 0) {
      setError("Zaznacz produkty z wklejonymi URL-ami.");
      return;
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
    setShowMissingUrlDialog(false);
    setBatch({ queue, currentIndex: 0, currentProductData: null, currentSheetMeta: null, currentId: null });
    processBatchItem(queue, 0);
  }

  async function handleMissingUrlSave() {
    // Save URLs from the missing dialog, then re-run startBatch
    for (const [id, url] of Object.entries(missingUrlDrafts)) {
      if (url.trim()) {
        setUrlDrafts((prev) => ({ ...prev, [id]: url }));
        await saveUrl(id, url);
      }
    }
    setShowMissingUrlDialog(false);
    // Re-trigger with updated drafts — use setTimeout to let state settle
    setTimeout(() => startBatch(false), 50);
  }

  function handleMissingUrlSkip() {
    setShowMissingUrlDialog(false);
    startBatch(true);
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
              translationFailed: data.translationFailed ?? false,
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
    if (batch) {
      const remaining = batch.queue.length - batch.currentIndex - 1;
      if (remaining > 0) {
        const confirmed = window.confirm(
          `Produkt pozostanie w statusie "w trakcie" i będzie można go kontynuować.\n\nPrzejść do następnego produktu? (Pozostało: ${remaining})`
        );
        if (!confirmed) {
          // Cancel entire batch, user stays on list view
          setBatch(null);
          fetchCached();
          return;
        }
      }
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

  async function resumeInProgress() {
    const ids = inProgressProducts.map((p) => p.id);
    if (ids.length === 0) return;

    // For a single in-progress product, try to use cached scraped data
    if (ids.length === 1) {
      await resumeSingle(ids[0]);
      return;
    }

    // For multiple: reset all to queued and re-scrape (no other option for batch)
    for (const id of ids) {
      await fetch(`/api/sheets/products/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "queued" }),
      });
    }
    setActive((prev) => prev.map((p) => (ids.includes(p.id) ? { ...p, status: "queued" as const } : p)));

    abortRef.current = false;
    setSelected(new Set());
    setBatch({ queue: ids, currentIndex: 0, currentProductData: null, currentSheetMeta: null, currentId: null });
    processBatchItem(ids, 0);
  }

  // ─── Retry error product ───

  async function retryProduct(id: string) {
    await fetch(`/api/sheets/products/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "new", error_message: null }),
    });
    setActive((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status: "new" as const, error_message: null } : p))
    );
  }

  // ─── Reset all ───

  async function confirmResetAll() {
    try {
      const res = await fetch('/api/sheets/products/reset', { method: 'POST' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      applyData(data);
      setSelected(new Set());
      setBatch(null);
      setUrlDrafts({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd resetu');
    } finally {
      setShowResetDialog(false);
    }
  }

  // ─── Reset single product ───

  async function resetSingleProduct(id: string) {
    try {
      const res = await fetch(`/api/sheets/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const updated = data.product as SheetProductRow;
      // Move from done back to active if it was done
      setDone((prev) => prev.filter((p) => p.id !== id));
      setActive((prev) => {
        const exists = prev.some((p) => p.id === id);
        if (exists) {
          return prev.map((p) => (p.id === id ? updated : p));
        }
        return [...prev, updated];
      });
      setUrlDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd resetu produktu');
    }
  }

  // ─── Launch single product ───

  async function launchSingle(id: string) {
    const product = active.find((p) => p.id === id);
    if (!product) return;

    const url = urlDrafts[id] ?? product.scrape_url;
    if (!url?.trim()) {
      setError("Wklej URL producenta przed wystawieniem.");
      return;
    }

    if (url !== product.scrape_url) {
      await saveUrl(id, url);
    }

    await fetch(`/api/sheets/products/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "queued" }),
    });
    setActive((prev) => prev.map((p) => (p.id === id ? { ...p, status: "queued" as const } : p)));

    abortRef.current = false;
    setSelected(new Set());
    setBatch({ queue: [id], currentIndex: 0, currentProductData: null, currentSheetMeta: null, currentId: null });
    processBatchItem([id], 0);
  }

  // ─── Resume single in-progress product ───

  async function resumeSingle(id: string) {
    // Try cached scraped data first — avoid re-scraping if already done
    try {
      const res = await fetch(`/api/sheets/products/${encodeURIComponent(id)}/scrape`);
      const cached = await res.json();

      if (cached.cached) {
        // Restore per-product workflow session to the correct per-product slot
        if (cached.workflowSession) {
          try {
            await fetch(`/api/product-session?productKey=${encodeURIComponent(`sheet_${id}`)}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(cached.workflowSession),
            });
          } catch { /* non-fatal */ }
        }

        abortRef.current = false;
        setSelected(new Set());
        setActive((prev) => prev.map((p) => (p.id === id ? { ...p, status: "in_progress" as const } : p)));
        setBatch({
          queue: [id],
          currentIndex: 0,
          currentId: id,
          currentProductData: cached.data,
          currentSheetMeta: cached.sheetMeta,
          translationFailed: cached.translationFailed ?? false,
        });
        return;
      }
    } catch {
      // fallthrough to re-scrape
    }

    // No cache — re-scrape
    await fetch(`/api/sheets/products/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "queued" }),
    });
    setActive((prev) => prev.map((p) => (p.id === id ? { ...p, status: "queued" as const } : p)));

    abortRef.current = false;
    setSelected(new Set());
    setBatch({ queue: [id], currentIndex: 0, currentProductData: null, currentSheetMeta: null, currentId: null });
    processBatchItem([id], 0);
  }

  // ─── URL helpers ───

  function hasUrl(p: SheetProductRow): boolean {
    const url = urlDrafts[p.id] ?? p.scrape_url;
    return !!(url && url.trim().length > 0);
  }

  function isValidUrl(val: string): boolean {
    if (!val.trim()) return true; // empty is ok (not filled yet)
    try { new URL(val); return true; } catch { return false; }
  }

  // ─── Status counts ───

  const counts = {
    total: active.length,
    ready: active.filter((p) => (p.status === "new" || p.status === "error") && hasUrl(p)).length,
    noUrl: active.filter((p) => (p.status === "new") && !hasUrl(p)).length,
    error: active.filter((p) => p.status === "error").length,
    inProgress: active.filter((p) => p.status === "in_progress" || p.status === "scraping" || p.status === "queued").length,
  };

  // ─── Filtered + paginated ───

  const filteredActive = active.filter((p) => {
    switch (statusFilter) {
      case "ready": return (p.status === "new" || p.status === "error") && hasUrl(p);
      case "no_url": return p.status === "new" && !hasUrl(p);
      case "error": return p.status === "error";
      case "in_progress": return p.status === "in_progress" || p.status === "scraping" || p.status === "queued";
      default: return true;
    }
  });

  // Sort gdy sortField jest aktywny (numeric collation dla ID/Stan; locale-aware dla tekstu)
  const sortedActive = sortField
    ? [...filteredActive].sort((a, b) => {
        const av = a[sortField] ?? "";
        const bv = b[sortField] ?? "";
        const cmp = String(av).localeCompare(String(bv), "pl", { numeric: true, sensitivity: "base" });
        return sortDirection === "asc" ? cmp : -cmp;
      })
    : filteredActive;

  const activeTotalPages = Math.max(1, Math.ceil(sortedActive.length / activePerPage));
  const safeActivePage = Math.min(activePage, activeTotalPages);
  const paginatedActive = sortedActive.slice(
    (safeActivePage - 1) * activePerPage,
    safeActivePage * activePerPage
  );

  const doneTotalPages = Math.max(1, Math.ceil(done.length / donePerPage));
  const safeDonePage = Math.min(donePage, doneTotalPages);
  const paginatedDone = done.slice(
    (safeDonePage - 1) * donePerPage,
    safeDonePage * donePerPage
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

        {/* Translation warning */}
        {batch.translationFailed && (
          <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 px-4 py-2.5 rounded-lg">
            <AlertCircle className="size-4 shrink-0" />
            Tłumaczenie nie powiodło się — dane mogą być w oryginalnym języku. Sprawdź tytuł i opis.
          </div>
        )}

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

  // Scraping banner (inline — nie blokuje listy produktów)
  const scrapingBanner = batch && !batch.currentProductData ? (() => {
    const currentProduct = active.find((p) => p.id === batch.queue[batch.currentIndex]);
    return (
      <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 mb-3">
        <Loader2 className="size-4 animate-spin text-blue-600 shrink-0" />
        <span className="text-sm text-blue-800 font-medium truncate">
          Scrapuję: {currentProduct?.nazwa ?? batch.queue[batch.currentIndex]} ({batch.currentIndex + 1}/{batch.queue.length})
        </span>
        <Button size="sm" variant="ghost" onClick={cancelBatch} className="ml-auto gap-1 text-xs text-destructive shrink-0 h-6 px-2">
          <XCircle className="size-3" />
          Anuluj
        </Button>
      </div>
    );
  })() : null;

  return (
    <div className="space-y-6">
      {scrapingBanner}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Import z Google Sheets</h2>
          <p className="text-sm text-muted-foreground">
            Zaznacz produkty, wklej linki i wystaw na Allegro przez BaseLinker.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-blue-200 bg-blue-50">
          <div className="flex items-center gap-3">
            <Zap className="size-4 text-blue-600" />
            <span className="text-sm text-blue-700">
              <strong>{inProgressProducts.length}</strong> produkt(ów) w trakcie wystawiania
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={resumeInProgress}
            className="gap-1.5 text-xs border-blue-300 text-blue-700 hover:bg-blue-100"
          >
            <Zap className="size-3.5" />
            Kontynuuj
          </Button>
        </div>
      )}

      {/* Status filter bar + counters */}
      {active.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="size-3.5 text-muted-foreground" />
            {([
              ["all", `Wszystkie (${counts.total})`],
              ["ready", `Gotowe (${counts.ready})`],
              ["no_url", `Bez URL (${counts.noUrl})`],
              ["error", `Błędy (${counts.error})`],
              ["in_progress", `W trakcie (${counts.inProgress})`],
            ] as [StatusFilter, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => { setStatusFilter(key); setActivePage(1); }}
                className={cn(
                  "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                  statusFilter === key
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary/50"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Selection toolbar */}
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-3">
              <button
                onClick={selected.size > 0 ? deselectAll : selectAll}
                className="text-xs text-primary hover:underline"
              >
                {selected.size > 0 ? "Odznacz wszystko" : "Zaznacz gotowe"}
              </button>
              {selected.size > 0 && (
                <span className="text-xs text-muted-foreground">
                  Zaznaczono: <strong>{selected.size}</strong>
                </span>
              )}
            </div>
            {selected.size > 0 && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleBatchScrape}
                  disabled={batchScraping || !!batch}
                  className="gap-1.5"
                >
                  {batchScraping
                    ? <Loader2 className="size-3.5 animate-spin" />
                    : <RefreshCw className="size-3.5" />}
                  Scrapuj ({selected.size})
                </Button>
                <Button size="sm" onClick={() => startBatch()} className="gap-1.5">
                  <ExternalLink className="size-3.5" />
                  Wystaw zaznaczone ({selected.size})
                </Button>
              </div>
            )}
          </div>
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
            <Package className="size-8 text-muted-foreground/60" />
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
                  <th className="w-12 px-2 py-2.5 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Foto
                  </th>
                  <SortableHeader field="id" label="ID" align="left" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                  <SortableHeader field="sku" label="SKU" align="left" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                  <SortableHeader field="nazwa" label="Nazwa" align="left" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                  <SortableHeader field="ean" label="EAN" align="left" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                  <SortableHeader field="stan_techniczny" label="Stan" align="left" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider min-w-[280px]">
                    URL producenta
                  </th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider w-28">
                    Akcja
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedActive.map((product) => {
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
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-center">
                        <Thumbnail src={firstImageUrl(product.zdjecie)} />
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
                        {(() => {
                          const val = urlDrafts[product.id] ?? product.scrape_url ?? "";
                          const valid = isValidUrl(val);
                          return (
                            <input
                              type="url"
                              value={val}
                              onChange={(e) =>
                                setUrlDrafts((prev) => ({
                                  ...prev,
                                  [product.id]: e.target.value,
                                }))
                              }
                              onBlur={(e) => saveUrl(product.id, e.target.value)}
                              onPaste={(e) => {
                                const pasted = e.clipboardData.getData('text').trim();
                                const notBusy = product.status !== 'scraping' && product.status !== 'in_progress';
                                if (notBusy && pasted.startsWith('http')) {
                                  setTimeout(() => autoScrapeOnPaste(product.id, pasted), 100);
                                }
                              }}
                              placeholder="https://..."
                              className={cn(
                                "w-full bg-background border rounded-md px-2.5 py-1.5 text-xs placeholder:text-muted focus:outline-none focus:border-primary",
                                !valid ? "border-red-400 bg-red-50/50" : "border-border"
                              )}
                            />
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <StatusBadge product={product} />
                          {product.status === "error" && product.error_message && (
                            <div className="flex items-center gap-1 max-w-[180px]">
                              <span className="text-[10px] text-red-600 truncate" title={product.error_message}>
                                {product.error_message}
                              </span>
                              <button
                                onClick={() => retryProduct(product.id)}
                                className="shrink-0 p-0.5 rounded hover:bg-red-100 text-red-400 hover:text-red-600"
                                title="Wyczyść błąd"
                              >
                                <X className="size-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {product.status === "new" && hasUrl(product) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => launchSingle(product.id)}
                            className="h-6 px-2 text-[10px] gap-1"
                          >
                            <Play className="size-3" />
                            Wystaw
                          </Button>
                        )}
                        {product.status === "error" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => hasUrl(product) ? launchSingle(product.id) : retryProduct(product.id)}
                            className="h-6 px-2 text-[10px] gap-1 text-orange-600 border-orange-200 hover:bg-orange-50"
                          >
                            <RefreshCw className="size-3" />
                            Ponów
                          </Button>
                        )}
                        {product.status === "in_progress" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => resumeSingle(product.id)}
                            className="h-6 px-2 text-[10px] gap-1 text-blue-600 border-blue-200 hover:bg-blue-50"
                          >
                            <Zap className="size-3" />
                            Kontynuuj
                          </Button>
                        )}
                        {product.status !== "new" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => resetSingleProduct(product.id)}
                            className="h-6 px-1.5 text-[10px] gap-1 text-muted-foreground hover:text-destructive"
                            title="Resetuj produkt"
                          >
                            <RotateCcw className="size-3" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filteredActive.length > activePerPage && (
            <div className="border-t border-border px-4 py-2">
              <PaginationControls
                currentPage={safeActivePage}
                totalPages={activeTotalPages}
                itemsPerPage={activePerPage}
                onPageChange={setActivePage}
                onItemsPerPageChange={(n) => { setActivePerPage(n); setActivePage(1); }}
                totalItems={filteredActive.length}
              />
            </div>
          )}
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
                  {paginatedDone.map((product) => (
                    <tr key={product.id} className="border-b last:border-b-0 opacity-60 hover:opacity-100 transition-opacity">
                      <td className="px-2 py-1 text-center w-10">
                        <Thumbnail src={firstImageUrl(product.zdjecie)} />
                      </td>
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
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1 text-xs h-7"
                            onClick={() => {
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
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1 text-xs h-7 text-destructive hover:text-destructive"
                            onClick={() => resetSingleProduct(product.id)}
                          >
                            <RotateCcw className="size-3" />
                            Cofnij
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {done.length > donePerPage && (
                <div className="border-t border-border px-4 py-2">
                  <PaginationControls
                    currentPage={safeDonePage}
                    totalPages={doneTotalPages}
                    itemsPerPage={donePerPage}
                    onPageChange={setDonePage}
                    onItemsPerPageChange={(n) => { setDonePerPage(n); setDonePage(1); }}
                    totalItems={done.length}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Missing URL Dialog */}
      {showMissingUrlDialog && missingUrlProducts.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowMissingUrlDialog(false)} />
          <div className="relative bg-card border border-border rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <AlertCircle className="size-5 text-amber-500" />
                <h3 className="text-sm font-semibold">Brakujące linki do produktów</h3>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {missingUrlProducts.length} {missingUrlProducts.length === 1 ? "produkt nie ma" : "produktów nie ma"} wklejonego linku.
                Wklej linki poniżej lub pomiń te produkty.
              </p>
            </div>

            <div className="px-5 py-3 max-h-[50vh] overflow-y-auto space-y-3">
              {missingUrlProducts.map((product) => (
                <div key={product.id} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{product.nazwa || product.id}</span>
                    {product.sku && (
                      <span className="text-[10px] font-mono text-muted-foreground">SKU: {product.sku}</span>
                    )}
                  </div>
                  <input
                    type="url"
                    value={missingUrlDrafts[product.id] ?? ""}
                    onChange={(e) =>
                      setMissingUrlDrafts((prev) => ({ ...prev, [product.id]: e.target.value }))
                    }
                    placeholder="https://..."
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                  />
                </div>
              ))}
            </div>

            <div className="px-5 py-4 border-t border-border flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowMissingUrlDialog(false)}
              >
                Anuluj
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleMissingUrlSkip}
                className="gap-1.5"
              >
                <SkipForward className="size-3.5" />
                Pomiń produkty bez linków
              </Button>
              {Object.values(missingUrlDrafts).some((v) => v.trim()) && (
                <Button
                  size="sm"
                  onClick={handleMissingUrlSave}
                  className="gap-1.5"
                >
                  Zapisz linki i kontynuuj
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reset All Dialog */}
      {showResetDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowResetDialog(false)} />
          <div className="relative bg-card border border-border rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <RotateCcw className="size-5 text-destructive" />
                <h3 className="text-sm font-semibold">Zacznij od nowa</h3>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Wszystkie produkty zostaną zresetowane do stanu początkowego. Wyczyszczone zostaną:
              </p>
              <ul className="text-xs text-muted-foreground mt-1.5 space-y-0.5 ml-4 list-disc">
                <li>Statusy (w trakcie, w kolejce, błędy, dodane)</li>
                <li>Wklejone URL-e producentów</li>
                <li>Powiązania z produktami BaseLinker</li>
              </ul>
              <p className="text-xs text-muted-foreground mt-2">
                Dane z arkusza Google Sheets <strong>nie zostaną</strong> usunięte.
              </p>
            </div>

            <div className="px-5 py-4 border-t border-border flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowResetDialog(false)}
              >
                Anuluj
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={confirmResetAll}
                className="gap-1.5"
              >
                <RotateCcw className="size-3.5" />
                Resetuj wszystko
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
