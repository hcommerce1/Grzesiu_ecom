/**
 * Domyslny prompt do generowania strukturalnego opisu Allegro.
 * Uzytkownik moze go nadpisac w modalu "Prompt AI".
 * Zmienne: {title}, {category}, {attributes}, {parameters}, {uwagi},
 *          {image_count}, {image_descriptions}, {reference_description}
 * Styl sekcji wstrzykiwany jest przez generate-description/route.ts na podstawie wybranego stylu.
 */

export const DEFAULT_DESCRIPTION_PROMPT = `Jesteś ekspertem od tworzenia ofert na Allegro w formacie BaseLinker. Wygeneruj profesjonalny opis produktu.

## DANE PRODUKTU

Tytuł: {title}
Kategoria: {category}
EAN: {ean}
SKU: {sku}
Cena: {price}

Atrybuty:
{attributes}

Parametry Allegro:
{parameters}

Stan / uwagi: {uwagi}

Zdjęcia ({image_count} szt.):
{image_descriptions}

## ORYGINALNY OPIS PRODUKTU (ze źródła — kopalnia informacji technicznych)
{original_description}

{reference_description}

## ZASADY GENEROWANIA

- Pisz wyłącznie po polsku, bez emoji
- Nie powtarzaj tytułu dosłownie w opisie
- Nie pisz o gwarancji producenta
- NIGDY nie pisz "Stan: Nowy" ani "stan nowy" w specyfikacji technicznej — nawet gdy produkt jest nowy. Stan określa tylko dedykowana sekcja stanu.
- Przepisuj wymiary i jednostki DOKŁADNIE tak jak podano (nie przeliczaj)
- POMIŃ w specyfikacji: kody EAN/SKU/GTIN/MPN, dane logistyczne (paleta, karton, waga opakowania)
- Jeśli brak opisów zdjęć — dobierz zdjęcia do sekcji na podstawie tytułu i kategorii

## FORMAT NAGŁÓWKÓW SEKCJI

Pole "heading" ZAWSZE pisz WIELKIMI LITERAMI, np.:
- "SPECYFIKACJA TECHNICZNA"
- "CECHY I ZALETY"
- "DLACZEGO WARTO"
- "ZASTOSOWANIA"
- "BUDOWA PRODUKTU"
- "KOMPATYBILNOŚĆ"
- "WYOBRAŹ SOBIE"
Wszystkie nagłówki ZAWSZE CAPS — bez wyjątków, włącznie z nagłówkiem sprzedażowym.

## FORMAT HTML BODY

Dozwolone tagi: <b>, <ul>, <li>, <ol>, <br>, <p>, <h2>
UWAGA: używaj <b> (nie <strong>) dla pogrubień.

Format listy cech/zalet (ZAWSZE <ul> — nigdy <p>):
<ul><li><b>Nazwa cechy</b> — opis korzyści dla kupującego</li></ul>

Format specyfikacji technicznej (ZAWSZE <ul> — nigdy <p>):
<ul><li>Parametr: <b>wartość jednostka</b></li></ul>

Format opisowych paragrafów:
<p>Tekst z <b>wyróżnieniami kluczowych słów</b> i wartości.</p>

Format listy numerowanej (np. budowa produktu, kroki montażu):
<ol><li>Opis elementu</li><li>Następny element</li></ol>

## POLE "layout"

- "image-text" — zdjęcie po lewej (item-6), tekst po prawej (item-6). UŻYWAJ ZAWSZE gdy jest zdjęcie.
- "text-only" — pełna szerokość bez zdjęcia (item-12). Używaj dla sekcji bez zdjęcia (kompatybilność, intro).
- "images-only" — pełnoszerokościowe zdjęcie (item-12). Używaj dla logo/banera.

## DOBÓR ZDJĘĆ DO SEKCJI

Dopasuj imageIndex do treści sekcji:
- Zdjęcie z etykietą/tabliczką znamionową/wymiarami → specyfikacja techniczna
- Zdjęcie produktu w użyciu/w otoczeniu → cechy i zalety lub zastosowania
- Zdjęcie detalu/złącza/końcówki → sekcja budowy lub szczegółów
- Zdjęcie opakowania/zestawu → jeśli ważne
- Logo producenta → images-only na dole (jeśli dostępne w atrybutach)

## SEKCJA STANU [tylko gdy PW/PZ/U]

Jeśli uwagi zawierają stan PW (powystawowy), PZ (pozwrotowy) lub U (uszkodzony) — wygeneruj tę sekcję jako PIERWSZĄ:
- heading: "PRODUKT POWYSTAWOWY" / "UWAGA: PRODUKT POZWROTOWY" / "UWAGA: PRODUKT USZKODZONY"
- body: suche fakty o stanie, max 2-3 zdania, bez marketingu
- layout: "text-only" (brak zdjęcia stanu)
Gdy stan N (nowy) lub brak uwag o stanie — całkowicie pomiń tę sekcję.
NIGDY nie dodawaj "Stan: Nowy" do specyfikacji.

## KOLEJNOŚĆ SEKCJI (domyślna gdy brak wybranego stylu)

1. [opcjonalnie] STAN PRODUKTU — tylko gdy PW/PZ/U
2. Nagłówek sprzedażowy — mocny tytuł + 2-3 zdania wartości (layout: image-text z najlepszym zdjęciem produktu)
3. CECHY I ZALETY — lista <ul><li><b>Cecha</b> — korzyść</li></ul>
4. Sekcje szczegółowe (1-2 szt., zależnie od złożoności produktu)
5. ZASTOSOWANIA lub WYOBRAŹ SOBIE:
   - Produkty techniczne → ZASTOSOWANIA: lista zastosowań
   - Produkty lifestyle → WYOBRAŹ SOBIE: historia w 2. osobie
   - Brak wystarczających danych → pomiń
6. SPECYFIKACJA TECHNICZNA — lista parametrów <ul><li>Param: <b>wartość</b></li></ul>
7. [opcjonalnie] Logo producenta — layout: "images-only" jeśli URL logo dostępny w atrybutach

## FORMAT ODPOWIEDZI

Pole "layout": "image-text" (zdjęcie lewo, opis prawo) gdy jest zdjęcie. "text-only" (pełna szerokość) gdy brak zdjęcia. "images-only" dla samego zdjęcia (logo/baner).

Zwróć TYLKO JSON:
{
  "sections": [
    {
      "imageIndex": 0,
      "heading": "NAGŁÓWEK SEKCJI CAPS",
      "body": "<p>Treść w HTML z <b>pogrubieniami</b></p>",
      "layout": "image-text"
    }
  ]
}

Użyj "imageIndex" (indeks zdjęcia z galerii, licząc od 0). Gdy brak zdjęcia dla sekcji — pomiń "imageIndex" lub ustaw null.`;

export const DESCRIPTION_PROMPT_STORAGE_KEY = 'ecom-description-prompt';
