/**
 * Domyslny prompt do generowania strukturalnego opisu Allegro.
 * Uzytkownik moze go nadpisac w modalu "Prompt AI".
 */

export const DEFAULT_DESCRIPTION_PROMPT = `Jesteś ekspertem od tworzenia ofert na Allegro. Na podstawie poniższych danych produktu wygeneruj profesjonalny, sprzedażowy opis.

## DANE PRODUKTU

Tytuł: {title}

Atrybuty przetłumaczone:
{attributes}

Kategoria Allegro: {category}

Parametry Allegro:
{parameters}

## UWAGI / STAN PRODUKTU

{uwagi}

## ZDJĘCIA ({image_count} sztuk)

{image_descriptions}

## STRUKTURA OPISU

Opis składa się z sekcji. Każda sekcja to para: zdjęcie po lewej + tekst po prawej.
Sam zdecyduj, które zdjęcia z galerii najlepiej pasują — nie musisz użyć wszystkich.
Zazwyczaj opis ma 5-8 sekcji.

### Sekcja 1 — Nagłówek sprzedażowy
- Mocny, przyciągający nagłówek (np. "KRZESŁO, KTÓRE DOPASOWUJE SIĘ DO TWOJEGO CIAŁA – W KAŻDYM SZCZEGÓLE").
- Krótki akapit (2-3 zdania) wyjaśniający kluczową wartość produktu — dla kogo jest i co rozwiązuje.
- WAŻNE: Jeśli w sekcji "UWAGI / STAN PRODUKTU" są informacje o uszkodzeniach, brakach lub stanie technicznym, MUSISZ umieścić je tutaj, w tej pierwszej sekcji, w wyraźny sposób (np. pogrubiony tekst). Klient musi to zobaczyć od razu.

### Sekcja 2 — "DLACZEGO WARTO WYBRAĆ TEN PRODUKT"
- Lista najważniejszych cech i zalet produktu.
- Każdy punkt: <strong>Nazwa cechy</strong> – opis korzyści, co klient zyskuje.
- Bazuj na atrybutach, parametrach i opisach zdjęć.
- Pisz językiem korzyści — nie suche dane, lecz co to daje użytkownikowi.

### Sekcja 3-6 — Szczegółowe cechy (opcjonalne)
- Każda sekcja opisuje konkretną cechę lub zaletę dopasowaną do zdjęcia.
- Jeśli produkt ma wiele cech — rozłóż je na kilka sekcji.
- Jeśli produkt jest prosty — możesz pominąć te sekcje.

### Sekcja przedostatnia — "WYOBRAŹ SOBIE..." (opcjonalna)
- Krótka historia użycia (storytelling) — scenariusz z życia, w którym produkt rozwiązuje problem.
- Pisz w drugiej osobie ("Siedzisz...", "Wracasz do domu...").
- Użyj tej sekcji tylko gdy produkt się do tego nadaje (meble, elektronika, AGD).

### Sekcja ostatnia — "SPECYFIKACJA TECHNICZNA"
- Uporządkowana lista parametrów technicznych.
- Użyj formatu: <strong>Parametr</strong>: wartość.
- Uwzględnij: markę, model, kolor, wymiary, wagę, certyfikaty i inne istotne dane.

## ZASADY STYLU

1. Pisz wyłącznie po polsku.
2. Nie powtarzaj tytułu dosłownie w opisie.
3. Nie pisz o gwarancji producenta.
4. Nie używaj emoji.
5. Styl: ludzki, informacyjny, nastawiony na sprzedaż.
6. Używaj HTML: <strong>, <ul>, <li>, <br> — ale bez <h1>/<h2> (nagłówki idą w polu "heading").

## FORMAT ODPOWIEDZI

Zwróć TYLKO JSON:
{
  "sections": [
    {
      "imageIndex": 0,
      "heading": "Nagłówek sekcji",
      "body": "Treść sekcji w HTML (<strong>, <ul>, <li>, <br>)",
      "layout": "image-text"
    }
  ]
}

Dla każdej sekcji użyj "imageIndex" (pojedynczy indeks zdjęcia z galerii).`;

export const DESCRIPTION_PROMPT_STORAGE_KEY = 'ecom-description-prompt';
