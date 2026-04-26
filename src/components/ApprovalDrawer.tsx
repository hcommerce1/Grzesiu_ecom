'use client';

import { useState, useEffect } from 'react';
import { X, AlertTriangle, Send, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import type { ProductSession } from '@/lib/types';

interface ApprovalDrawerProps {
  session: ProductSession;
  onClose: () => void;
  onApproved: (productId: number) => void;
}

export function ApprovalDrawer({ session, onClose, onApproved }: ApprovalDrawerProps) {
  const [canSubmit, setCanSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [descExpanded, setDescExpanded] = useState(false);

  const isEdit = session.mode === 'edit';

  useEffect(() => {
    const timer = setTimeout(() => setCanSubmit(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  async function handleSubmit() {
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/bl-submit', { method: 'POST' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      onApproved(data.product_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd wysyłania');
    } finally {
      setSubmitting(false);
    }
  }

  const sel = session.fieldSelection ?? {};
  const images = session.images ?? session.data?.images ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-card border border-border w-full sm:max-w-4xl sm:mx-4 sm:rounded-2xl rounded-t-2xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-foreground">Zatwierdzenie wysyłki</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Sprawdź dane przed wysłaniem do BaseLinker</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-card-hover text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {/* Edit warning */}
          {isEdit && session.product_id && (
            <div className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-400">Edycja istniejącego produktu</p>
                <p className="text-xs text-red-400/80 mt-0.5">
                  To nadpisze produkt ID: <strong>{session.product_id}</strong> — akcja nieodwracalna.
                </p>
              </div>
            </div>
          )}

          {/* Summary grid */}
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Tryb" value={{ new: 'Nowy produkt', edit: 'Edycja', variant: 'Wariant', bundle: 'Edycja' }[session.mode]} />
            <StatCard label="Zdjęcia" value={`${images.length}`} sub="plików" />
            <StatCard label="VAT" value={`${session.tax_rate ?? 23}%`} />
          </div>

          {/* Basic info */}
          <Section title="Podstawowe informacje">
            <Row label="Nazwa" value={session.data?.title} />
            {sel['sku'] !== false && session.data?.sku && <Row label="SKU" value={session.data.sku} />}
            {sel['ean'] !== false && session.data?.ean && <Row label="EAN" value={session.data.ean} />}
            {session.data?.price && <Row label="Cena" value={`${session.data.price} ${session.data.currency ?? 'PLN'}`} />}
          </Section>

          {/* Images */}
          {sel['images'] !== false && images.length > 0 && (
            <Section title={`Zdjęcia (${images.length})`}>
              <div className="flex gap-2 flex-wrap">
                {images.slice(0, 16).map((img, i) => (
                  // eslint-disable-next-line @next/next/no-img-element -- external URLs (BL/Allegro/Cloudinary/blob:), Image optimization not worth runtime complexity
                  <img
                    key={i}
                    src={img}
                    alt={`Zdjęcie ${i + 1}`}
                    className="w-16 h-16 object-cover rounded-lg border border-border"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ))}
                {images.length > 16 && (
                  <div className="w-16 h-16 rounded-lg border border-border flex items-center justify-center text-xs text-muted-foreground">
                    +{images.length - 16}
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Category & commission */}
          {session.allegroCategory && (
            <Section title="Kategoria Allegro">
              <Row label="Kategoria" value={session.allegroCategory.path} />
              <Row label="ID" value={session.allegroCategory.id} />
              {session.commissionInfo && (
                <div className="mt-2 p-2.5 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                  <p className="text-xs text-yellow-400">{session.commissionInfo}</p>
                </div>
              )}
            </Section>
          )}

          {/* Parameters — tłumacz paramID i option_id na nazwy/wartości po polsku */}
          {session.filledParameters && Object.keys(session.filledParameters).length > 0 && (
            <Section title="Parametry Allegro">
              {Object.entries(session.filledParameters).map(([paramId, val]) => {
                const def = session.allegroParameters?.find(p => p.id === paramId);
                const label = def?.name ?? paramId;
                const rawOpts = def?.dictionary ?? (Array.isArray(def?.options) ? def?.options : null) ?? def?.restrictions?.allowedValues ?? [];
                const opts = Array.isArray(rawOpts) ? rawOpts : [];
                const translate = (v: string) => opts.find(o => o.id === v)?.value ?? v;
                const display = Array.isArray(val) ? val.map(translate).join(', ') : translate(String(val));
                return <Row key={paramId} label={label} value={display} />;
              })}
            </Section>
          )}

          {/* Description — preferuj wygenerowany strukturalny opis nad surowym scrape'em */}
          {sel['description'] !== false && (() => {
            const descSource = session.generatedDescription?.fullHtml || session.data?.description || ''
            if (!descSource) return null
            const descBody = descExpanded
              ? descSource
              : descSource.substring(0, 500) + (descSource.length > 500 ? '…' : '')
            return (
              <Section title="Opis">
                <div>
                  <div
                    className={`text-sm text-muted-foreground ${descExpanded ? '' : 'line-clamp-3'}`}
                    dangerouslySetInnerHTML={{ __html: descBody }}
                  />
                  {descSource.length > 200 && (
                    <button
                      onClick={() => setDescExpanded(!descExpanded)}
                      className="flex items-center gap-1 text-xs text-accent mt-1.5 hover:underline"
                    >
                      {descExpanded ? <><ChevronUp className="w-3 h-3" />Zwiń</> : <><ChevronDown className="w-3 h-3" />Rozwiń</>}
                    </button>
                  )}
                </div>
              </Section>
            )
          })()}

          {/* Inventory */}
          <Section title="Magazyn">
            <Row label="Inventory ID" value={session.inventoryId?.toString() ?? '—'} />
            <Row label="Magazyn" value={session.defaultWarehouse ?? '—'} />
          </Section>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            Anuluj
          </button>
          <div className="flex items-center gap-3">
            {!canSubmit && (
              <span className="text-xs text-muted-foreground">Poczekaj 3s...</span>
            )}
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
              className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white text-sm font-medium rounded-xl hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Wysyłam...</>
              ) : (
                <><Send className="w-4 h-4" />Wyślij do BaseLinker</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-background/50 border border-border rounded-xl px-4 py-3 text-center">
      <div className="text-lg font-bold text-foreground">
        {value}
        {sub && <span className="text-xs font-normal text-muted-foreground ml-1">{sub}</span>}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-background/50 border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border bg-card-hover/30">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</span>
      </div>
      <div className="px-4 py-3 space-y-2">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs text-muted-foreground flex-shrink-0">{label}</span>
      <span className="text-sm text-foreground text-right break-all">{value}</span>
    </div>
  );
}
