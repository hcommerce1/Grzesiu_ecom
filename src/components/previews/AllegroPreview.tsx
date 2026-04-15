"use client"

import { useState } from "react"
import { DESCRIPTION_PREVIEW_CSS } from "@/lib/description-utils"

interface Props {
  title: string
  fullHtml: string
  images: string[]
  parameters: Record<string, string | string[]>
  price?: number
}

const DAYS_PL = ["ndz", "pon", "wt", "śr", "czw", "pt", "sob"]
const MONTHS_PL = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"]

function deliveryDate(daysFromNow: number) {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  return `${DAYS_PL[d.getDay()]}. ${d.getDate()} ${MONTHS_PL[d.getMonth()]}`
}

/* ── Inline SVG icons matching Allegro's style ── */
const SearchIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
)
const UserIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
  </svg>
)
const BellIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
)
const CartIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
  </svg>
)
const ShieldIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0066cc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
)
const TruckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
  </svg>
)
const PackageIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" /><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
)
const StoreIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
  </svg>
)
const StarIcon = ({ filled }: { filled: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill={filled ? "#ff5a00" : "none"} stroke="#ff5a00" strokeWidth="2">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
)
const ChevronIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

export function AllegroPreview({ title, fullHtml, images, parameters, price }: Props) {
  const [mainImage, setMainImage] = useState(0)
  const displayPrice = price ?? 0
  const priceWhole = Math.floor(displayPrice)
  const priceFraction = String(Math.round((displayPrice - priceWhole) * 100)).padStart(2, "0")
  const paramEntries = Object.entries(parameters).slice(0, 16)
  const installment = (displayPrice / 4).toFixed(2)

  return (
    <div style={{
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif",
      color: '#333', background: '#fff', minWidth: 900, fontSize: 14, lineHeight: 1.5,
    }}>

      {/* ══════ TOP UTILITY BAR ══════ */}
      <div style={{
        background: '#333', padding: '5px 32px', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', fontSize: 11, color: '#aaa', letterSpacing: 0.2,
      }}>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
          {["Allegro Lokalnie", "Allegro Biznes", "Okazje", "Inspiracje"].map((t, i) => (
            <span key={i} style={{ cursor: 'default' }}>{t}</span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
          <span>Sprzedaj na Allegro</span>
          <span>Pomoc i kontakt</span>
        </div>
      </div>

      {/* ══════ MAIN HEADER ══════ */}
      <div style={{
        background: '#ff5a00', padding: '10px 32px', display: 'flex', alignItems: 'center', gap: 20,
      }}>
        {/* Logo */}
        <div style={{
          color: '#fff', fontWeight: 700, fontSize: 26, fontStyle: 'italic',
          letterSpacing: -0.8, flexShrink: 0, userSelect: 'none',
        }}>
          allegro
        </div>

        {/* Search */}
        <div style={{
          flex: 1, display: 'flex', borderRadius: 6, overflow: 'hidden',
          boxShadow: '0 1px 4px rgba(0,0,0,0.15)', height: 42,
        }}>
          <div style={{
            flex: 1, background: '#fff', display: 'flex', alignItems: 'center',
            padding: '0 16px', fontSize: 14, color: '#999',
          }}>
            czego szukasz?
          </div>
          <div style={{
            width: 52, background: '#e04d00', display: 'flex', alignItems: 'center',
            justifyContent: 'center', color: '#fff', flexShrink: 0,
          }}>
            <SearchIcon />
          </div>
        </div>

        {/* Right icons */}
        <div style={{ display: 'flex', gap: 24, alignItems: 'center', color: '#fff', flexShrink: 0 }}>
          {[
            { icon: <UserIcon />, label: "Moje Allegro" },
            { icon: <BellIcon />, label: "" },
            { icon: <CartIcon />, label: "" },
          ].map((item, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
              {item.icon}
              {item.label && <span style={{ fontSize: 10, opacity: 0.9 }}>{item.label}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* ══════ CATEGORY NAV ══════ */}
      <div style={{
        background: '#fff', borderBottom: '1px solid #ddd', padding: '10px 32px',
        display: 'flex', gap: 24, fontSize: 13, color: '#444', fontWeight: 400,
      }}>
        {["Elektronika", "Moda", "Dom i Ogród", "Supermarket", "Dziecko", "Uroda", "Zdrowie", "Kultura i rozrywka", "Sport", "Motoryzacja", "Kolekcje"].map((cat, i) => (
          <span key={i} style={{ whiteSpace: 'nowrap', cursor: 'default' }}>{cat}</span>
        ))}
      </div>

      {/* ══════ BREADCRUMBS ══════ */}
      <div style={{
        padding: '12px 32px', fontSize: 12, color: '#707070',
        display: 'flex', gap: 4, alignItems: 'center', background: '#fafafa',
        borderBottom: '1px solid #eee',
      }}>
        {["Allegro", "Elektronika", "Komputery", "Sieci i komunikacja", "Kable i adaptery sieciowe"].map((crumb, i, arr) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: i < arr.length - 1 ? '#0066cc' : '#666' }}>{crumb}</span>
            {i < arr.length - 1 && <ChevronIcon />}
          </span>
        ))}
      </div>

      {/* ══════ MAIN PRODUCT AREA ══════ */}
      <div style={{ padding: '24px 32px 40px', maxWidth: 1220, margin: '0 auto' }}>
        <div style={{ display: 'flex', gap: 36 }}>

          {/* ── LEFT: Images ── */}
          <div style={{ flex: '0 0 480px' }}>
            {images.length > 0 ? (
              <>
                <div style={{
                  width: '100%', aspectRatio: '1/1', overflow: 'hidden', borderRadius: 8,
                  border: '1px solid #e5e5e5', marginBottom: 14, background: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <img
                    src={images[mainImage] || images[0]}
                    alt=""
                    style={{ maxWidth: '95%', maxHeight: '95%', objectFit: 'contain' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {images.slice(0, 8).map((url, i) => (
                    <div
                      key={i}
                      onClick={() => setMainImage(i)}
                      style={{
                        width: 62, height: 62, borderRadius: 6, overflow: 'hidden',
                        border: i === mainImage ? '2px solid #ff5a00' : '1px solid #e0e0e0',
                        cursor: 'pointer', background: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'border-color 0.15s',
                      }}
                    >
                      <img src={url} alt="" style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }} />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{
                width: '100%', aspectRatio: '1/1', background: '#f8f8f8', borderRadius: 8,
                border: '1px solid #e5e5e5',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 13,
              }}>
                Brak zdjęć
              </div>
            )}
          </div>

          {/* ── RIGHT: Details ── */}
          <div style={{ flex: 1, minWidth: 0 }}>

            {/* Title */}
            <h1 style={{
              fontSize: 20, fontWeight: 400, lineHeight: 1.45, margin: '0 0 10px',
              color: '#1a1a1a', letterSpacing: -0.1,
            }}>
              {title || "Tytuł produktu"}
            </h1>

            {/* Rating + sold count */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 18, fontSize: 13 }}>
              <div style={{ display: 'flex', gap: 1 }}>
                {[1, 2, 3, 4, 5].map(n => <StarIcon key={n} filled={true} />)}
              </div>
              <span style={{ color: '#0066cc', marginLeft: 2 }}>(0 opinii)</span>
              <span style={{ color: '#ccc', margin: '0 2px' }}>|</span>
              <span style={{ color: '#707070' }}>0 osób kupiło</span>
            </div>

            {/* Price */}
            <div style={{ marginBottom: 4, display: 'flex', alignItems: 'baseline' }}>
              <span style={{ fontSize: 34, fontWeight: 700, color: '#1a1a1a', lineHeight: 1 }}>{priceWhole}</span>
              <span style={{ fontSize: 20, fontWeight: 700, color: '#1a1a1a', position: 'relative', top: -1 }}>,{priceFraction}</span>
              <span style={{ fontSize: 20, fontWeight: 400, color: '#1a1a1a', marginLeft: 4 }}>zł</span>
            </div>
            <div style={{ fontSize: 11, color: '#707070', marginBottom: 18 }}>
              najniższa cena z 30 dni przed obniżką: {displayPrice.toFixed(2)} zł
            </div>

            {/* Smart! badge */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: '#e6f4ea', borderRadius: 6, padding: '8px 14px', marginBottom: 14,
            }}>
              <span style={{
                background: '#00a046', color: '#fff', fontWeight: 700, fontSize: 12,
                padding: '3px 10px', borderRadius: 4, letterSpacing: 0.3,
              }}>
                Smart!
              </span>
              <span style={{ fontSize: 13, color: '#1a7e3c', fontWeight: 500 }}>
                Darmowa dostawa
              </span>
            </div>

            <div style={{ display: 'block', marginBottom: 14 }} />

            {/* Allegro Protect */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
              background: '#edf6ff', borderRadius: 8, marginBottom: 18, border: '1px solid #d4e8fa',
            }}>
              <ShieldIcon />
              <div style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: '#0066cc' }}>Allegro Protect</span>
                <span style={{ color: '#555', marginLeft: 6 }}>— kupujesz bezpiecznie, zwrot do 30 dni</span>
              </div>
            </div>

            {/* ── Delivery ── */}
            <div style={{
              background: '#f7f7f7', borderRadius: 10, padding: '16px 18px', marginBottom: 18,
              border: '1px solid #ebebeb',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontWeight: 600, fontSize: 15, color: '#1a1a1a' }}>Dostawa</span>
                <span style={{ fontSize: 12, color: '#0066cc', cursor: 'default' }}>zmień adres</span>
              </div>

              {/* Paczkomat InPost */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                padding: '10px 0', borderBottom: '1px solid #e5e5e5',
              }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ marginTop: 1, flexShrink: 0 }}><PackageIcon /></div>
                  <div>
                    <div style={{ fontSize: 13, color: '#1a1a1a', fontWeight: 500 }}>Paczkomat InPost</div>
                    <div style={{ fontSize: 12, color: '#00a046', marginTop: 3, fontWeight: 500 }}>
                      {deliveryDate(1)} — darmowa dostawa Smart!
                    </div>
                  </div>
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#00a046', whiteSpace: 'nowrap' }}>0,00 zł</span>
              </div>

              {/* Kurier */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                padding: '10px 0', borderBottom: '1px solid #e5e5e5',
              }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ marginTop: 1, flexShrink: 0 }}><TruckIcon /></div>
                  <div>
                    <div style={{ fontSize: 13, color: '#1a1a1a', fontWeight: 500 }}>Kurier</div>
                    <div style={{ fontSize: 12, color: '#707070', marginTop: 3 }}>{deliveryDate(2)}</div>
                  </div>
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#00a046', whiteSpace: 'nowrap' }}>0,00 zł</span>
              </div>

              {/* Odbiór w punkcie */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                padding: '10px 0',
              }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ marginTop: 1, flexShrink: 0 }}><StoreIcon /></div>
                  <div>
                    <div style={{ fontSize: 13, color: '#1a1a1a', fontWeight: 500 }}>Odbiór w punkcie</div>
                    <div style={{ fontSize: 12, color: '#707070', marginTop: 3 }}>{deliveryDate(2)}</div>
                  </div>
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', whiteSpace: 'nowrap' }}>6,99 zł</span>
              </div>
            </div>

            {/* ── Seller ── */}
            <div style={{ padding: '14px 0', marginBottom: 18, borderTop: '1px solid #ebebeb', borderBottom: '1px solid #ebebeb' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, flexWrap: 'wrap' }}>
                <span style={{ color: '#707070' }}>Sprzedawca:</span>
                <span style={{ color: '#0066cc', fontWeight: 500 }}>SuperSprzedawca_PL</span>
                <span style={{
                  background: '#e6f4ea', color: '#00a046', fontSize: 11, fontWeight: 600,
                  padding: '3px 10px', borderRadius: 4, lineHeight: 1,
                }}>
                  Super Sprzedawca
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#888', marginTop: 5 }}>
                Na Allegro od 2019 r. &middot; 99,8% pozytywnych opinii
              </div>
            </div>

            {/* ── Buy buttons ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
              <div style={{
                background: '#ff5a00', color: '#fff', textAlign: 'center',
                padding: '15px 0', borderRadius: 6, fontWeight: 700, fontSize: 16,
                letterSpacing: 0.2, boxShadow: '0 2px 6px rgba(255,90,0,0.25)',
              }}>
                Kup teraz
              </div>
              <div style={{
                border: '2px solid #ff5a00', color: '#ff5a00', textAlign: 'center',
                padding: '13px 0', borderRadius: 6, fontWeight: 600, fontSize: 15,
                background: '#fff',
              }}>
                Dodaj do koszyka
              </div>
            </div>

            {/* ── Allegro Pay ── */}
            {displayPrice > 0 && (
              <div style={{
                background: '#fff7f0', borderRadius: 8, padding: '14px 18px',
                border: '1px solid #ffe0c2',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <span style={{ fontWeight: 700, color: '#ff5a00', fontSize: 14 }}>Allegro Pay</span>
                  <span style={{ color: '#555' }}>— kup teraz, zapłać później</span>
                </div>
                <div style={{ fontSize: 12, color: '#707070', marginTop: 5 }}>
                  4 raty 0% po {installment} zł &middot; lub zapłać za 30 dni
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ══════ SPECIFICATION ══════ */}
      {paramEntries.length > 0 && (
        <div style={{ padding: '0 32px 40px', maxWidth: 1220, margin: '0 auto' }}>
          <div style={{ borderTop: '1px solid #e5e5e5', paddingTop: 28 }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 18px', color: '#1a1a1a' }}>Specyfikacja</h2>
            <table style={{
              width: '100%', borderCollapse: 'collapse', border: '1px solid #e5e5e5',
              borderRadius: 8, overflow: 'hidden', fontSize: 13,
            }}>
              <tbody>
                {paramEntries.map(([key, val], i) => (
                  <tr key={key}>
                    <td style={{
                      padding: '11px 18px', color: '#555', fontWeight: 500,
                      background: i % 2 === 0 ? '#fafafa' : '#f5f5f5',
                      borderBottom: '1px solid #eee', width: '35%',
                      verticalAlign: 'top',
                    }}>
                      {key}
                    </td>
                    <td style={{
                      padding: '11px 18px', color: '#1a1a1a',
                      background: i % 2 === 0 ? '#fff' : '#fcfcfc',
                      borderBottom: '1px solid #eee',
                    }}>
                      {Array.isArray(val) ? val.join(", ") : val}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════ DESCRIPTION ══════ */}
      {fullHtml && (
        <div style={{ padding: '0 32px 40px', maxWidth: 1220, margin: '0 auto' }}>
          <div style={{ borderTop: '1px solid #e5e5e5', paddingTop: 28 }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 24px', color: '#1a1a1a' }}>Opis</h2>
            <div
              dangerouslySetInnerHTML={{ __html: DESCRIPTION_PREVIEW_CSS + fullHtml }}
              style={{ lineHeight: 1.7, color: '#333', fontSize: 14 }}
            />
          </div>
        </div>
      )}

      {/* ══════ FOOTER ══════ */}
      <div style={{
        background: '#f5f5f5', padding: '24px 32px', marginTop: 20,
        borderTop: '1px solid #e0e0e0',
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', maxWidth: 1220, margin: '0 auto',
          fontSize: 11, color: '#888',
        }}>
          <div style={{ display: 'flex', gap: 20 }}>
            <span>Allegro</span>
            <span>Regulamin</span>
            <span>Polityka prywatności</span>
            <span>Informacje o cookies</span>
          </div>
          <span>© 2024 Allegro</span>
        </div>
      </div>
    </div>
  )
}
