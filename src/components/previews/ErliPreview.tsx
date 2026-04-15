"use client"

import { useState } from "react"
import { DESCRIPTION_PREVIEW_CSS } from "@/lib/description-utils"

interface Props {
  title: string
  fullHtml: string
  images: string[]
  price?: number
}

export function ErliPreview({ title, fullHtml, images, price }: Props) {
  const [mainImage, setMainImage] = useState(0)
  const displayPrice = price ?? 0

  return (
    <div style={{ fontFamily: "'Segoe UI', Tahoma, sans-serif", color: '#222', background: '#fff', minWidth: 900 }}>
      {/* Erli top bar */}
      <div style={{ background: '#0ea5e9', padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ color: '#fff', fontWeight: 800, fontSize: 20, letterSpacing: 1 }}>erli</div>
        <div style={{ flex: 1, background: '#fff', borderRadius: 20, padding: '8px 16px', fontSize: 13, color: '#999' }}>
          Szukaj produktów...
        </div>
      </div>

      {/* Main content */}
      <div style={{ display: 'flex', padding: '24px', gap: 28, maxWidth: 1100, margin: '0 auto' }}>
        {/* Left: images */}
        <div style={{ flex: '0 0 440px' }}>
          {images.length > 0 && (
            <>
              <div style={{ width: '100%', aspectRatio: '1/1', overflow: 'hidden', borderRadius: 8, border: '1px solid #e5e7eb', marginBottom: 12, background: '#fafafa' }}>
                <img
                  src={images[mainImage] || images[0]}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {images.slice(0, 6).map((url, i) => (
                  <div
                    key={i}
                    onClick={() => setMainImage(i)}
                    style={{
                      width: 54, height: 54, borderRadius: 6, overflow: 'hidden',
                      border: i === mainImage ? '2px solid #0ea5e9' : '1px solid #e5e7eb',
                      cursor: 'pointer',
                    }}
                  >
                    <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Right: details */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.35, margin: '0 0 12px' }}>
            {title || 'Tytuł produktu'}
          </h1>

          {/* Rating */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 12, color: '#666' }}>
            <span style={{ color: '#0ea5e9' }}>★★★★★</span>
            <span>Brak opinii</span>
          </div>

          {/* Price */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 30, fontWeight: 800, color: '#0ea5e9' }}>
              {displayPrice.toFixed(2)} zł
            </div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
              Cena zawiera VAT
            </div>
          </div>

          {/* Delivery */}
          <div style={{ background: '#f0f9ff', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 13, border: '1px solid #e0f2fe' }}>
            <div style={{ fontWeight: 600, marginBottom: 4, color: '#0369a1' }}>Dostawa</div>
            <div style={{ color: '#555' }}>Kurier — od 11,99 zł</div>
            <div style={{ color: '#555' }}>Paczkomat InPost — od 8,99 zł</div>
          </div>

          {/* Buy buttons */}
          <div style={{
            background: '#0ea5e9', color: '#fff', textAlign: 'center',
            padding: '14px 0', borderRadius: 8, fontWeight: 700, fontSize: 15,
            marginBottom: 10,
          }}>
            Kup teraz
          </div>
          <div style={{
            border: '2px solid #0ea5e9', color: '#0ea5e9', textAlign: 'center',
            padding: '12px 0', borderRadius: 8, fontWeight: 600, fontSize: 14,
          }}>
            Dodaj do koszyka
          </div>
        </div>
      </div>

      {/* Description */}
      {fullHtml && (
        <div style={{ padding: '24px', borderTop: '1px solid #e5e7eb', maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Opis</div>
          <div dangerouslySetInnerHTML={{ __html: DESCRIPTION_PREVIEW_CSS + fullHtml }} />
        </div>
      )}
    </div>
  )
}
