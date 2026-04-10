'use client';

import { useState, useEffect, useRef } from 'react';
import { Heart, ShoppingCart, Copy, Send, Edit2, Image } from 'lucide-react';
import type { ProductSession } from '@/lib/types';

export default function OfferPreviewPage() {
  const [session, setSession] = useState<ProductSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeImg, setActiveImg] = useState(0);
  const [copied, setCopied] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const descIframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    fetch('/api/product-session')
      .then(r => r.json())
      .then(d => {
        setSession(d.session);
        setTitleDraft(d.session?.data?.title ?? '');
      })
      .finally(() => setLoading(false));
  }, []);

  // Build srcDoc for sandboxed iframe (avoids document.write deprecation warnings)
  const descSrcDoc = session?.data?.description
    ? `<!DOCTYPE html><html><head><style>
  body{margin:0;padding:16px;font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.6;color:#333;background:#fff}
  img{max-width:100%;height:auto}
  table{border-collapse:collapse;width:100%}
  td,th{border:1px solid #ddd;padding:8px}
  ul,ol{padding-left:1.5em}
  h1,h2,h3{line-height:1.3}
</style></head><body>${session.data.description}</body></html>`
    : undefined;

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center text-gray-500">
        <div className="text-center">
          <p className="text-lg font-medium">Brak aktywnej sesji produktu</p>
          <p className="text-sm mt-2">Najpierw zescrapuj produkt i utwórz sesję.</p>
          <a href="/" className="mt-4 inline-block text-orange-500 hover:underline text-sm">← Powrót do scraperа</a>
        </div>
      </div>
    );
  }

  const { data, allegroCategory, filledParameters, commissionInfo } = session;
  const images = session.images?.length ? session.images : (data?.images ?? []);
  const title = data?.title ?? '';
  const price = data?.price ?? '–';
  const currency = data?.currency ?? 'PLN';
  const parameters = { ...(data?.attributes ?? {}), ...(filledParameters ?? {}) };

  async function saveTitle() {
    await fetch('/api/product-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { ...data, title: titleDraft } }),
    });
    setSession(prev => prev ? { ...prev, data: { ...prev.data, title: titleDraft } } : prev);
    setEditingTitle(false);
  }

  function copyDescHtml() {
    navigator.clipboard.writeText(data?.description ?? '').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const breadcrumbParts = allegroCategory?.path?.split(' > ') ?? ['Kategoria'];

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Preview banner */}
      <div className="sticky top-0 z-50 bg-yellow-400 text-yellow-900 text-center text-xs font-semibold py-1.5 px-4">
        [PODGLĄD — nie jest to prawdziwa oferta Allegro]
      </div>

      {/* Allegro Header */}
      <header style={{ background: '#ff5a00' }} className="px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          {/* Logo */}
          <svg width="100" height="28" viewBox="0 0 100 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <text x="0" y="22" fill="white" fontSize="20" fontWeight="bold" fontFamily="system-ui">allegro</text>
          </svg>

          {/* Search */}
          <div className="flex-1 max-w-2xl">
            <div className="flex bg-white rounded overflow-hidden">
              <input
                readOnly
                placeholder="Szukaj w Allegro..."
                className="flex-1 px-3 py-2 text-sm text-gray-700 focus:outline-none"
              />
              <button style={{ background: '#ff5a00', color: 'white' }} className="px-4 py-2 text-sm font-medium border-l border-orange-400">
                Szukaj
              </button>
            </div>
          </div>

          {/* Cart */}
          <div className="flex items-center gap-2 text-white text-sm">
            <ShoppingCart className="w-5 h-5" />
            <span>Koszyk 0</span>
          </div>
        </div>
      </header>

      {/* Breadcrumb */}
      <div className="max-w-6xl mx-auto px-4 py-2">
        <nav className="flex items-center gap-1 text-xs" style={{ color: '#767676' }}>
          <span>Strona główna</span>
          {breadcrumbParts.map((part, i) => (
            <span key={i} className="flex items-center gap-1">
              <span>&gt;</span>
              <span className={i === breadcrumbParts.length - 1 ? 'text-gray-800' : ''}>{part}</span>
            </span>
          ))}
        </nav>
      </div>

      {/* Main product area */}
      <div className="max-w-6xl mx-auto px-4 pb-8">
        <div className="flex gap-8">
          {/* Gallery */}
          <div className="flex-shrink-0" style={{ width: '500px' }}>
            {/* Main image */}
            <div
              className="flex items-center justify-center mb-3 rounded"
              style={{ width: '500px', height: '500px', border: '1px solid #e5e7eb', background: '#fafafa' }}
            >
              {images.length > 0 ? (
                <img
                  src={images[activeImg]}
                  alt={title}
                  className="max-w-full max-h-full object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect fill="%23f0f0f0" width="200" height="200"/><text x="50%" y="50%" text-anchor="middle" fill="%23aaa" font-size="14">Brak zdjęcia</text></svg>'; }}
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-gray-400">
                  <Image className="w-12 h-12" />
                  <span className="text-sm">Brak zdjęcia</span>
                </div>
              )}
            </div>

            {/* Thumbnails */}
            <div className="flex gap-2 flex-wrap">
              {images.slice(0, 6).map((img, i) => (
                <button
                  key={i}
                  onClick={() => setActiveImg(i)}
                  className="rounded overflow-hidden flex-shrink-0"
                  style={{
                    width: '60px',
                    height: '60px',
                    border: i === activeImg ? '2px solid #ff5a00' : '1px solid #e5e7eb',
                  }}
                >
                  <img src={img} alt={`Miniatura ${i + 1}`} className="w-full h-full object-cover" />
                </button>
              ))}
              {images.length > 6 && (
                <div
                  className="flex items-center justify-center flex-shrink-0 rounded text-xs text-gray-500"
                  style={{ width: '60px', height: '60px', border: '1px solid #e5e7eb', background: '#f9f9f9' }}
                >
                  +{images.length - 6}
                </div>
              )}
            </div>
          </div>

          {/* Product info */}
          <div className="flex-1">
            {/* Title */}
            {editingTitle ? (
              <div className="mb-3">
                <input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  className="w-full text-xl font-bold text-gray-900 border-b-2 border-orange-500 focus:outline-none pb-1"
                  style={{ fontSize: '22px' }}
                />
                <div className="flex gap-2 mt-2">
                  <button onClick={saveTitle} className="text-xs text-white bg-green-600 px-3 py-1 rounded hover:bg-green-500">Zapisz</button>
                  <button onClick={() => setEditingTitle(false)} className="text-xs text-gray-500 px-3 py-1 rounded border hover:bg-gray-50">Anuluj</button>
                </div>
              </div>
            ) : (
              <h1
                className="font-bold text-gray-900 mb-3 leading-snug"
                style={{ fontSize: '22px', maxWidth: '520px' }}
              >
                {title || 'Tytuł produktu'}
              </h1>
            )}

            {/* Stars */}
            <div className="flex items-center gap-3 mb-4" style={{ color: '#767676', fontSize: '13px' }}>
              <div className="flex" style={{ color: '#ff5a00' }}>{'★'.repeat(5)}</div>
              <span>0 ocen</span>
              <span>|</span>
              <button className="flex items-center gap-1 hover:text-gray-800">
                <Heart className="w-3.5 h-3.5" /> Obserwuj
              </button>
            </div>

            {/* Price */}
            <div className="mb-4">
              <div className="text-sm text-gray-500 mb-1">Cena:</div>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#e4264a' }}>
                {price} {currency}
              </div>
            </div>

            <hr style={{ borderColor: '#e5e7eb', marginBottom: '16px' }} />

            {/* Buttons */}
            <div className="flex flex-col gap-3 mb-5" style={{ maxWidth: '300px' }}>
              <button
                style={{ background: '#00b140', color: 'white', borderRadius: '4px', padding: '12px 24px', fontSize: '15px', fontWeight: '600', border: 'none', cursor: 'pointer' }}
              >
                KUP TERAZ
              </button>
              <button
                style={{ background: 'white', color: '#00b140', borderRadius: '4px', padding: '11px 24px', fontSize: '15px', fontWeight: '600', border: '1.5px solid #00b140', cursor: 'pointer' }}
              >
                DO KOSZYKA
              </button>
            </div>

            {/* Commission info */}
            {(allegroCategory || commissionInfo) && (
              <div
                className="rounded-lg p-3"
                style={{ background: '#fffbeb', border: '1px solid #fde68a', fontSize: '13px' }}
              >
                <div className="flex items-start gap-2">
                  <span style={{ fontSize: '16px' }}>ℹ️</span>
                  <div>
                    {allegroCategory && (
                      <div className="font-medium text-gray-800 mb-1">
                        Kategoria: {allegroCategory.path}
                      </div>
                    )}
                    {commissionInfo && (
                      <div style={{ color: '#92400e' }}>{commissionInfo}</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Description */}
        <div className="mt-8 border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-200 bg-gray-50">
            <h2 className="font-semibold text-gray-800" style={{ fontSize: '15px' }}>Opis produktu</h2>
          </div>
          {descSrcDoc ? (
            <iframe
              ref={descIframeRef}
              title="Opis produktu"
              sandbox="allow-same-origin"
              srcDoc={descSrcDoc}
              className="w-full border-0"
              style={{ minHeight: '300px' }}
              onLoad={(e) => {
                // Auto-resize iframe to content
                const iframe = e.currentTarget;
                try {
                  const height = iframe.contentDocument?.body?.scrollHeight;
                  if (height) iframe.style.height = `${height + 32}px`;
                } catch { /* cross-origin */ }
              }}
            />
          ) : (
            <div className="px-5 py-8 text-sm text-gray-400 text-center">
              Opis nie został wygenerowany. Sprawdź klucz OPENAI_API_KEY w .env.local
            </div>
          )}
        </div>

        {/* Parameters table */}
        {Object.keys(parameters).length > 0 && (
          <div className="mt-6 border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-200 bg-gray-50">
              <h2 className="font-semibold text-gray-800" style={{ fontSize: '15px' }}>Parametry produktu</h2>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <tbody>
                {Object.entries(parameters).map(([key, val], i) => (
                  <tr key={key} style={{ background: i % 2 === 1 ? '#f5f5f5' : 'white' }}>
                    <td style={{ padding: '8px 16px', color: '#555', width: '40%', borderBottom: '1px solid #eee' }}>{key}</td>
                    <td style={{ padding: '8px 16px', color: '#222', borderBottom: '1px solid #eee' }}>
                      {Array.isArray(val) ? val.join(', ') : String(val)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Floating Editor Panel */}
      <div className="fixed bottom-6 right-6 z-40" style={{ minWidth: '180px' }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', boxShadow: '0 4px 24px rgba(0,0,0,0.12)', overflow: 'hidden' }}>
          <div style={{ padding: '8px 14px', borderBottom: '1px solid #f0f0f0', background: '#f9fafb' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Edytor</span>
          </div>
          <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <button
              onClick={() => setEditingTitle(true)}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#374151', padding: '7px 10px', borderRadius: '8px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', width: '100%' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f3f4f6')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <Edit2 style={{ width: '13px', height: '13px' }} />
              Edytuj tytuł
            </button>
            <button
              onClick={copyDescHtml}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#374151', padding: '7px 10px', borderRadius: '8px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', width: '100%' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f3f4f6')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <Copy style={{ width: '13px', height: '13px' }} />
              {copied ? 'Skopiowano!' : 'Kopiuj HTML opisu'}
            </button>
            <hr style={{ border: 'none', borderTop: '1px solid #f0f0f0', margin: '4px 0' }} />
            <a
              href="/"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#2563eb', padding: '7px 10px', borderRadius: '8px', textDecoration: 'none', background: 'transparent' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#eff6ff')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <Send style={{ width: '13px', height: '13px' }} />
              ← Wróć do aplikacji
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
