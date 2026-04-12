"use client"

import { useState } from "react"

interface Props {
  title: string
  fullHtml: string
  images: string[]
  parameters: Record<string, string | string[]>
  price?: number
}

export function AllegroPreview({ title, fullHtml, images, parameters, price }: Props) {
  const [mainImage, setMainImage] = useState(0)
  const displayPrice = price ?? 0
  const priceWhole = Math.floor(displayPrice)
  const priceFraction = String(Math.round((displayPrice - priceWhole) * 100)).padStart(2, "0")

  const paramEntries = Object.entries(parameters).slice(0, 12)

  return (
    <div style={{ fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", color: '#333', background: '#fff', minWidth: 900 }}>
      {/* Allegro top bar */}
      <div style={{ background: '#ff5a00', padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ color: '#fff', fontWeight: 700, fontSize: 20 }}>allegro</div>
        <div style={{ flex: 1, background: '#fff', borderRadius: 4, padding: '6px 12px', fontSize: 13, color: '#999' }}>
          Czego szukasz?
        </div>
      </div>

      {/* Breadcrumbs */}
      <div style={{ padding: '8px 24px', fontSize: 11, color: '#888' }}>
        Allegro &gt; Kategoria &gt; Podkategoria
      </div>

      {/* Main content */}
      <div style={{ display: 'flex', padding: '0 24px 24px', gap: 24 }}>
        {/* Left: images */}
        <div style={{ flex: '0 0 480px' }}>
          {images.length > 0 && (
            <>
              <div style={{ width: '100%', aspectRatio: '1/1', overflow: 'hidden', borderRadius: 8, border: '1px solid #e5e5e5', marginBottom: 12 }}>
                <img
                  src={images[mainImage] || images[0]}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {images.slice(0, 8).map((url, i) => (
                  <div
                    key={i}
                    onClick={() => setMainImage(i)}
                    style={{
                      width: 56, height: 56, borderRadius: 4, overflow: 'hidden',
                      border: i === mainImage ? '2px solid #ff5a00' : '1px solid #e5e5e5',
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
          <h1 style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.35, margin: '0 0 12px' }}>
            {title || 'Tytuł produktu'}
          </h1>

          {/* Price */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, margin: '0 0 16px' }}>
            <span style={{ fontSize: 32, fontWeight: 700 }}>{priceWhole}</span>
            <span style={{ fontSize: 18, fontWeight: 700 }}>,{priceFraction} zł</span>
          </div>

          {/* Delivery */}
          <div style={{ background: '#f5f5f5', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Dostawa kurierem</span>
              <span style={{ fontWeight: 600 }}>od 9,99 zł</span>
            </div>
          </div>

          {/* Buy buttons */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            <div style={{
              flex: 1, background: '#ff5a00', color: '#fff', textAlign: 'center',
              padding: '12px 0', borderRadius: 8, fontWeight: 600, fontSize: 15,
            }}>
              Kup teraz
            </div>
            <div style={{
              flex: 1, border: '2px solid #ff5a00', color: '#ff5a00', textAlign: 'center',
              padding: '12px 0', borderRadius: 8, fontWeight: 600, fontSize: 15,
            }}>
              Dodaj do koszyka
            </div>
          </div>

          {/* Parameters */}
          {paramEntries.length > 0 && (
            <div style={{ borderTop: '1px solid #e5e5e5', paddingTop: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Specyfikacja</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 13 }}>
                {paramEntries.map(([key, val]) => (
                  <div key={key} style={{ display: 'flex', gap: 8, padding: '4px 0', borderBottom: '1px solid #f5f5f5' }}>
                    <span style={{ color: '#888', minWidth: 100 }}>{key}</span>
                    <span style={{ fontWeight: 500 }}>{Array.isArray(val) ? val.join(', ') : val}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Description section */}
      {fullHtml && (
        <div style={{ padding: '24px', borderTop: '1px solid #e5e5e5' }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Opis</div>
          <div dangerouslySetInnerHTML={{ __html: fullHtml }} />
        </div>
      )}
    </div>
  )
}
