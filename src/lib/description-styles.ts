export type DescriptionStyleId = 'technical' | 'lifestyle' | 'simple';

export interface DescriptionStyle {
  id: DescriptionStyleId;
  name: string;
  description: string;
  /** Instructions injected into generate-description prompt for section ordering */
  sectionInstructions: string;
}

export const DESCRIPTION_STYLES: Record<DescriptionStyleId, DescriptionStyle> = {
  technical: {
    id: 'technical',
    name: 'Techniczny',
    description: 'Specyfikacja na górze, cechy, zastosowania. Brak storytellingu. Dla kabli, rur, narzędzi, materiałów budowlanych.',
    sectionInstructions: `Kolejność sekcji (styl TECHNICZNY):
1. [opcjonalnie] STAN PRODUKTU — tylko gdy PW/PZ/U (layout: text-only)
2. Nagłówek — krótki, informacyjny (nie marketingowy hype)
3. SPECYFIKACJA TECHNICZNA — ZAWSZE jako druga lub trzecia sekcja. Format: <ul><li>Param: <b>wartość</b></li></ul>
4. CECHY I ZALETY — lista <ul><li><b>Cecha</b> — korzyść</li></ul>
5. [opcjonalnie] ZASTOSOWANIA — lista zastosowań produktu
NIE używaj sekcji "WYOBRAŹ SOBIE" ani storytellingu.
Nagłówki sekcji: ZAWSZE CAPS (SPECYFIKACJA TECHNICZNA, CECHY I ZALETY, ZASTOSOWANIA).
Layout: "image-text" dla każdej sekcji ze zdjęciem. "text-only" gdy brak zdjęcia.
NIE pisz "Stan: Nowy" w specyfikacji.`,
  },
  lifestyle: {
    id: 'lifestyle',
    name: 'Lifestyle',
    description: 'Nagłówek + historia użycia na górze, cechy w środku, spec na dole. Dla mebli, AGD, toreb, elektroniki.',
    sectionInstructions: `Kolejność sekcji (styl LIFESTYLE):
1. [opcjonalnie] STAN PRODUKTU — tylko gdy PW/PZ/U (layout: text-only)
2. Nagłówek sprzedażowy — mocny, emocjonalny (jedyny bez CAPS)
3. DLACZEGO WARTO — lista korzyści <ul><li><b>Cecha</b> — korzyść</li></ul>
4. Sekcje szczegółowe (1-3) — konkretne cechy z opisem, nazwy sekcji CAPS
5. WYOBRAŹ SOBIE — krótka historia w 2. osobie (3-4 zdania), MUSI być obecna jako przedostatnia sekcja
6. SPECYFIKACJA TECHNICZNA — na końcu. Format: <ul><li>Param: <b>wartość</b></li></ul>
7. [opcjonalnie] Logo producenta — images-only na samym dole
Nagłówki sekcji: ZAWSZE CAPS (oprócz nagłówka sprzedażowego w pkt 2).
Layout: "image-text" dla każdej sekcji ze zdjęciem. "text-only" gdy brak zdjęcia.
NIE pisz "Stan: Nowy" w specyfikacji.`,
  },
  simple: {
    id: 'simple',
    name: 'Prosty',
    description: 'Minimalny opis gdy brakuje danych. 3-4 sekcje. Dla prostych produktów bez bogatych danych.',
    sectionInstructions: `Kolejność sekcji (styl PROSTY — max 4 sekcje):
1. [opcjonalnie] STAN PRODUKTU — tylko gdy PW/PZ/U (layout: text-only)
2. Nagłówek + krótki opis produktu (2-3 zdania)
3. KLUCZOWE CECHY — lista 4-6 punktów <ul><li><b>Cecha</b> — wartość</li></ul>
4. SPECYFIKACJA TECHNICZNA — <ul><li>Param: <b>wartość</b></li></ul>
NIE twórz sekcji jeśli nie masz treści. Lepiej mniej sekcji niż puste.
Nagłówki sekcji: ZAWSZE CAPS (KLUCZOWE CECHY, SPECYFIKACJA TECHNICZNA).
Layout: "image-text" dla każdej sekcji ze zdjęciem. "text-only" gdy brak zdjęcia.
NIE pisz "Stan: Nowy" w specyfikacji.`,
  },
};

export const DESCRIPTION_STYLE_LIST = Object.values(DESCRIPTION_STYLES);
