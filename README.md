# E-Commerce Scraper

Aplikacja webowa (Next.js 16 + React 19) do pobierania danych produktowych ze sklepów internetowych i automatycznego tłumaczenia ich na język polski przy pomocy modelu językowego (LLM). Wklejasz listę adresów URL produktów, a aplikacja zwraca tytuł, opis, atrybuty, cenę oraz zdjęcia — już przetłumaczone i gotowe do wykorzystania np. przy wystawianiu ofert.

## Co potrafi aplikacja

- **Zbiorcze scrapowanie** — wklej wiele adresów URL (po jednym w linii), aplikacja przetwarza je kolejno i pokazuje postęp na żywo.
- **Dedykowane parsery** dla popularnych sklepów (zobacz [src/lib/scrapers/](src/lib/scrapers/)):
  - Amazon (`amazon.pl`, `amazon.de`, `amazon.com` itd.)
  - Shopify (dowolny sklep oparty o Shopify, np. Tribesigns)
  - Songmics / Woltu
  - DWD Company
  - Aosom, Costway
  - **Generic** — fallback dla wszystkich pozostałych sklepów
- **Tłumaczenie na PL** — wszystkie pola (tytuł, opis, atrybuty) są tłumaczone przez LLM (domyślnie OpenAI) z zachowaniem nazw marek, numerów modeli i formatowania. Prompt systemowy można edytować bezpośrednio w UI (ikona obok nagłówka).
- **Pobieranie zdjęć** — endpoint [src/app/api/download-images/](src/app/api/download-images/) pakuje zdjęcia produktu do archiwum ZIP.
- **Dwa tryby scrapowania**:
  - `playwright` — lokalnie, z użyciem Playwright + stealth plugin (domyślny, darmowy).
  - `unblocker` — przez zewnętrzne API typu ScrapingBee, przydatne gdy strona agresywnie blokuje boty.
- **Wykrywanie blokad** — aplikacja rozpoznaje strony typu „Access Denied” / CAPTCHA i zwraca czytelny błąd zamiast śmieciowych danych.

## Jak to działa (skrót techniczny)

1. Frontend ([src/app/page.tsx](src/app/page.tsx)) wysyła każdy URL do endpointu `POST /api/scrape` ([src/app/api/scrape/](src/app/api/scrape/)).
2. [src/lib/scraper.ts](src/lib/scraper.ts) uruchamia Playwrighta (lub wywołuje Unblocker API), czeka na wyrenderowanie treści, przewija stronę w celu załadowania „lazy” sekcji i pobiera HTML.
3. [src/lib/scrapers/index.ts](src/lib/scrapers/index.ts) dopasowuje odpowiedni ekstraktor na podstawie domeny URL-a.
4. Wyodrębnione dane trafiają do [src/lib/translator.ts](src/lib/translator.ts), który wysyła je do modelu LLM wraz z promptem systemowym i zwraca wersję polską.
5. Frontend wyświetla produkty w formie rozwijanych kart z porównaniem oryginału i tłumaczenia.

## Wymagania

- Node.js 20+ (zalecany 22)
- npm / pnpm / yarn / bun
- Konto OpenAI (lub kompatybilny endpoint) i klucz API
- (Opcjonalnie) klucz do ScrapingBee lub innego unblockera

## Instalacja

```bash
npm install
# Playwright pobierze przeglądarkę automatycznie; jeśli nie — uruchom:
npx playwright install chromium
```

## Konfiguracja pliku `.env.local`

W katalogu głównym projektu utwórz plik `.env.local` o następującej zawartości:

```env
# ─── Scraper Configuration ───
# Tryb scrapera: "playwright" (lokalnie, domyślny) lub "unblocker" (przez API)
SCRAPER_MODE=playwright

# Klucz i endpoint zewnętrznego unblockera (wymagane tylko gdy SCRAPER_MODE=unblocker)
UNBLOCKER_API_KEY=
UNBLOCKER_API_URL=https://api.scrapingbee.com/api/v1/

# ─── Tłumaczenie (LLM API) ───
# Klucz OpenAI (lub kompatybilny). WYMAGANE do tłumaczenia.
OPENAI_API_KEY=sk-...
# Model używany do tłumaczenia 
LLM_MODEL=gpt-5-mini
```

### Opis zmiennych

| Zmienna | Wymagana | Opis |
|---|---|---|
| `SCRAPER_MODE` | nie | `playwright` (domyślnie) lub `unblocker`. W trybie `unblocker` aplikacja omija Playwrighta i korzysta z zewnętrznego API. |
| `UNBLOCKER_API_KEY` | tylko dla `unblocker` | Klucz API np. do ScrapingBee. |
| `UNBLOCKER_API_URL` | nie | Endpoint unblockera. Domyślnie ScrapingBee. |
| `OPENAI_API_KEY` | **tak** | Klucz API do OpenAI, używany przez translator. |
| `LLM_MODEL` | nie | Nazwa modelu, np. `gpt-5-mini`, `gpt-4o-mini`. |

> ⚠️ Nie commituj `.env.local` do repozytorium — plik jest już w `.gitignore`.

## Uruchomienie

Tryb developerski (hot reload):

```bash
npm run dev
```

Aplikacja wystartuje pod adresem [http://localhost:3000](http://localhost:3000).

Build produkcyjny:

```bash
npm run build
npm start
```

## Jak używać

1. Otwórz [http://localhost:3000](http://localhost:3000).
2. Wklej listę adresów URL produktów — po jednym w linii.
3. (Opcjonalnie) kliknij ikonę edycji promptu przy nagłówku, aby dostosować instrukcje tłumaczenia.
4. Kliknij przycisk startu — aplikacja będzie przetwarzać URL-e po kolei (z opóźnieniem ~1,5 s między żądaniami, aby nie przeciążać serwerów docelowych).
5. Rozwiń kartę produktu, aby zobaczyć szczegóły, oryginał vs. tłumaczenie oraz pobrać zdjęcia jako ZIP.

### Przykładowe linki do przetestowania

Możesz wkleić poniższe URL-e w pole wyszukiwania, aby sprawdzić różne parsery (Amazon, Shopify, generic):

```
https://www.amazon.pl/Feandrea-Wielopoziomowy-drapakami-Jasnoszary-PCT261W01/dp/B0BSFF63QY?th=1
https://tribesigns.de/collections/konsolentische/products/moderner-konsolentisch-40-zoll-sofatisch-aus-holz-mit-geometrischem-sockel
https://www.songmics.de/?srsltid=AfmBOor0cUDKlK89OnqZrAr_nSDzuWzVziyQvEZdy0OHqBJmBXhfrivq
https://shop.dwd-company.de/tillvex-Eiswuerfelmaschine-Edelstahl-12-kg-24-h-Eiswuerfelbereiter-mit-Timer-und-22-Liter-Wassertank-Ice-Maker-LCD-Display-Selbstreinigungsfunktion-3-Eiswuerfel-Groessen
```

## Struktura projektu

```
src/
├── app/
│   ├── api/
│   │   ├── scrape/            # POST /api/scrape — główny endpoint
│   │   └── download-images/   # POST /api/download-images — ZIP ze zdjęciami
│   ├── page.tsx               # Główny UI
│   └── layout.tsx
├── components/                # SearchBar, CollapsibleProductItem, PromptEditor
└── lib/
    ├── scraper.ts             # Orkiestrator: Playwright / Unblocker
    ├── translator.ts          # Integracja z LLM
    ├── types.ts
    └── scrapers/              # Parsery dla konkretnych sklepów
        ├── amazon.ts
        ├── shopify.ts
        ├── dwd.ts
        ├── woltu.ts
        ├── aosom.ts
        ├── costway.ts
        ├── generic.ts
        └── index.ts
```

## Rozwiązywanie problemów

- **„Access denied” / CAPTCHA** — strona wykryła automat. Spróbuj włączyć `SCRAPER_MODE=unblocker` i uzupełnić `UNBLOCKER_API_KEY`.
- **Timeout** — strona ładuje się zbyt wolno. Spróbuj ponownie lub zwiększ `NAVIGATION_TIMEOUT` w [src/lib/scraper.ts](src/lib/scraper.ts).
- **Brak tłumaczenia / błąd LLM** — sprawdź `OPENAI_API_KEY` i `LLM_MODEL` w `.env.local`.
- **Playwright nie działa** — uruchom `npx playwright install chromium`.
- **Port 3000 zajęty** — `next dev` zgłosi konflikt; zakończ inny proces lub uruchom na innym porcie: `PORT=3001 npm run dev`.
