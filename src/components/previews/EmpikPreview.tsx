"use client"

import { useState } from "react"

interface Props {
  title: string
  fullHtml: string
  images: string[]
  price?: number
}

export function EmpikPreview({ title, fullHtml, images, price }: Props) {
  const [mainImage, setMainImage] = useState(0)
  const displayPrice = price ?? 0

  return (
    <div style={{ fontFamily: "'Segoe UI', Tahoma, sans-serif", color: '#1a1a1a', background: '#fff', minWidth: 900 }}>
      {/* Empik top bar */}
      <div style={{ background: '#fff', borderBottom: '2px solid #e30613', padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ color: '#e30613', fontWeight: 800, fontSize: 22, letterSpacing: -0.5 }}>empik</div>
        <div style={{ flex: 1, background: '#f5f5f5', borderRadius: 20, padding: '8px 16px', fontSize: 13, color: '#999' }}>
          Szukaj wśród ponad 26 milionów produktów
        </div>
      </div>

      {/* Main content */}
      <div style={{ display: 'flex', padding: '24px', gap: 32, maxWidth: 1100, margin: '0 auto' }}>
        {/* Left: images */}
        <div style={{ flex: '0 0 420px' }}>
          {images.length > 0 && (
            <>
              <div style={{ width: '100%', aspectRatio: '1/1', overflow: 'hidden', borderRadius: 4, border: '1px solid #eee', marginBottom: 12, background: '#fafafa' }}>
                <img
                  src={images[mainImage] || images[0]}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {images.slice(0, 6).map((url, i) => (
                  <div
                    key={i}
                    onClick={() => setMainImage(i)}
                    style={{
                      width: 52, height: 52, borderRadius: 4, overflow: 'hidden',
                      border: i === mainImage ? '2px solid #e30613' : '1px solid #eee',
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
          <h1 style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.3, margin: '0 0 16px', color: '#1a1a1a' }}>
            {title || 'Tytuł produktu'}
          </h1>

          {/* Rating placeholder */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 12, color: '#888' }}>
            <span style={{ color: '#ffc107' }}>★★★★★</span>
            <span>0 opinii</span>
          </div>

          {/* Price */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#1a1a1a' }}>
              {displayPrice.toFixed(2)} zł
            </div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
              Najniższa cena z 30 dni: {displayPrice.toFixed(2)} zł
            </div>
          </div>

          {/* Delivery */}
          <div style={{ background: '#f8f8f8', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 13 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Dostawa</div>
            <div style={{ color: '#555' }}>Kurier — od 9,99 zł</div>
            <div style={{ color: '#555' }}>Odbiór w salonie Empik — 0 zł</div>
          </div>

          {/* Buy button */}
          <div style={{
            background: '#e30613', color: '#fff', textAlign: 'center',
            padding: '14px 0', borderRadius: 8, fontWeight: 700, fontSize: 15,
            marginBottom: 12,
          }}>
            Dodaj do koszyka
          </div>
          <div style={{
            border: '2px solid #e30613', color: '#e30613', textAlign: 'center',
            padding: '12px 0', borderRadius: 8, fontWeight: 600, fontSize: 14,
          }}>
            Kup teraz
          </div>
        </div>
      </div>

      {/* Description */}
      {fullHtml && (
        <div style={{ padding: '24px', borderTop: '1px solid #eee', maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Opis produktu</div>
          <div dangerouslySetInnerHTML={{ __html: fullHtml }} />
        </div>
      )}
    </div>
  )
}
