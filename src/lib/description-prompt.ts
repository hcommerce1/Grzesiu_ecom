/**
 * Domyslny prompt do generowania strukturalnego opisu Allegro.
 * Uzytkownik moze go nadpisac w modalu "Prompt AI".
 */

export const DEFAULT_DESCRIPTION_PROMPT = `Jestes ekspertem od tworzenia ofert na Allegro. Na podstawie ponizszych danych produktu wygeneruj strukturalny opis skladajacy sie z sekcji.

## DANE PRODUKTU

Tytul: {title}

Atrybuty przetlumaczone:
{attributes}

Kategoria Allegro: {category}

Parametry Allegro:
{parameters}

## ZDJECIA ({image_count} sztuk)

{image_descriptions}

## INSTRUKCJE

1. Stwórz opis złożony z sekcji. Każda sekcja to para: zdjęcie + tekst opisowy.
2. Zdjęcie ZAWSZE po lewej stronie, tekst po prawej.
3. Sam zdecyduj, które zdjęcia z galerii najlepiej pasują do opisu - nie musisz użyć wszystkich.
4. Zazwyczaj opis ma 4-8 sekcji typu "image-text" (zdjęcie + tekst).
5. Na końcu możesz dodać 1-2 sekcje "images-only" - dwa zdjęcia obok siebie bez tekstu. Użyj ich dla zdjęć, które nie wymagają opisu tekstowego, ale dobrze prezentują produkt.
6. Pisz językiem korzyści - pokaż co klient ZYSKUJE.
7. Każda sekcja powinna opisywać konkretną cechę lub zaletę produktu, dopasowaną do tego co widać na zdjęciu.
8. Pierwsza sekcja powinna być głównym nagłówkiem sprzedażowym.
9. Ostatnia sekcja "image-text" powinna zawierać specyfikację techniczną.
10. Pisz wyłącznie po polsku.
11. Nie powtarzaj tytułu dosłownie w opisie.
12. Nie pisz o gwarancji producenta.
13. Nie używaj emoji.
14. Styl: ludzki, informacyjny, nastawiony na sprzedaż.

## FORMAT ODPOWIEDZI

Zwróć TYLKO JSON:
{
  "sections": [
    {
      "imageIndex": 0,
      "heading": "Nagłówek sekcji",
      "body": "Treść sekcji (możesz użyć <ul><li>, <strong>, <br>)",
      "layout": "image-text"
    },
    {
      "imageIndices": [5, 6],
      "heading": "",
      "body": "",
      "layout": "images-only"
    }
  ]
}

Dla sekcji "image-text" użyj "imageIndex" (pojedynczy indeks).
Dla sekcji "images-only" użyj "imageIndices" (tablica 2 indeksów).`;

export const DESCRIPTION_PROMPT_STORAGE_KEY = 'ecom-description-prompt';
