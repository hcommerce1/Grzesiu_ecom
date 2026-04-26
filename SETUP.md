# SETUP — instalacja na nowym PC

Kompletna lista wymagań i kroków, żeby uruchomić aplikację od zera na świeżym komputerze (Windows / macOS / Linux).

Dla szczegółów dotyczących samych pakietów npm zobacz [DEPENDENCIES.md](DEPENDENCIES.md).
Dla listy zmiennych środowiskowych zobacz [ENV.md](ENV.md).

---

## 1. Wymagania systemowe

| Komponent | Wersja | Uwagi |
|---|---|---|
| **Node.js** | **20+** (zalecane 22 LTS; przetestowane też 24.x) | [nodejs.org](https://nodejs.org) — instalator dla Windows |
| **npm** | 10+ (dostarczane z Node) | — |
| **Git** | dowolna świeża | do sklonowania repo |
| **System** | Windows 10/11, macOS, Linux | projekt rozwijany na Windows 10 Pro |

### Windows — dodatkowo (dla natywnego modułu `better-sqlite3`)

Zwykle `npm install` na Win11 + Node 22 zadziała bez kompilacji (prebuilt binary). Ale jeśli wypluje błąd `node-gyp` / `MSBuild`, zainstaluj ręcznie:

1. **Visual Studio Build Tools 2022** — [download](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022)
   - Po instalacji wybierz workload **„Desktop development with C++”**
2. **Python 3.11+** — [python.org](https://www.python.org/downloads/) — zaznacz **„Add to PATH”**
3. Restart terminala i ponowne `npm install`

> Stara metoda `npm install -g windows-build-tools` jest **deprecated** — paczka usunięta z npm w 2021. Nie używaj.

---

## 2. Pobranie kodu

```bash
git clone <URL_REPO> Grzesiu_ecom
cd Grzesiu_ecom
```

---

## 3. Instalacja zależności npm

```bash
npm install
```

To zainstaluje wszystko z [package.json](package.json) (patrz [DEPENDENCIES.md](DEPENDENCIES.md)).
`package-lock.json` jest w repo — wersje są zamrożone, więc dostaniesz identyczne co u mnie.

---

## 4. Instalacja przeglądarki dla Playwright

Playwright nie pobiera automatycznie Chromium — trzeba osobno:

```bash
npx playwright install chromium
```

Jeśli planujesz scrapować coś wymagającego innych silników:

```bash
npx playwright install            # wszystkie: chromium + firefox + webkit
```

---

## 5. Konfiguracja `.env.local`

Skopiuj szablon i wypełnij klucze:

```bash
cp .env.example .env.local        # macOS/Linux
copy .env.example .env.local      # Windows CMD
Copy-Item .env.example .env.local # Windows PowerShell
```

Pełna lista i opis zmiennych: [ENV.md](ENV.md).

**Minimalne wymagane do działania podstawowego scrape'u + tłumaczenia**:

- `ANTHROPIC_API_KEY` — klucz Anthropic (Claude)
- `APP_USER=hubert` (lub `grzesiek`)

Reszta (BaseLinker, Allegro, Decodo, FAL, Apify, Google Sheets, R2, Cloudinary) jest opcjonalna — tylko jeśli używasz danej funkcji.

---

## 6. (Opcjonalnie) Google Sheets

Jeśli chcesz korzystać z integracji Google Sheets, umieść plik service account w katalogu głównym jako:

```
google-credentials.json
```

Ścieżkę można nadpisać zmienną `GOOGLE_SHEETS_CREDENTIALS_PATH`. Plik jest w `.gitignore` — nigdy nie commituj.

### Jak zdobyć `google-credentials.json` (od zera)

1. Wejdź na [Google Cloud Console](https://console.cloud.google.com)
2. Utwórz nowy projekt (ikonka u góry → **New Project**) lub wybierz istniejący
3. **APIs & Services → Library** → wyszukaj "Google Sheets API" → **Enable**
4. **IAM & Admin → Service Accounts → Create Service Account**:
   - Name: dowolna (np. `grzesiu-ecom-reader`)
   - Role: nie wymagana (Sheets API + udostępniony arkusz wystarczą)
5. Po utworzeniu: kliknij na konto → **Keys → Add Key → Create New Key → JSON** → pobierz plik
6. Przemianuj pobrany plik na `google-credentials.json` i umieść w katalogu głównym projektu
7. **Udostępnij arkusz Google Sheets** kontu service:
   - Otwórz arkusz w przeglądarce → **Share**
   - Wklej email z pola `client_email` z pliku JSON
   - Uprawnienia: **Viewer** (read-only)
   - **Send** (bez powiadomienia OK)

ID arkusza i GID zakładki ustaw w `.env.local`:

```env
GOOGLE_SHEETS_SPREADSHEET_ID=1AbCdEf...   # z URL: docs.google.com/spreadsheets/d/{ID}/edit
GOOGLE_SHEETS_SHEET_GID=0                 # z URL #gid={GID}
```

---

## 7. Uruchomienie dev

```bash
npm run dev
```

Aplikacja: http://localhost:3000

Skrypt ustawia:
- `NODE_OPTIONS=--max-old-space-size=4096` — więcej RAM dla Next.js (Windows OOM fix, patrz commit `b6ef1fa`)
- `RAYON_NUM_THREADS=2` — ograniczenie wątków dla natywnych modułów

---

## 8. Build produkcyjny

```bash
npm run build
npm start
```

---

## 9. Skrypty dostępne w `package.json`

| Skrypt | Co robi |
|---|---|
| `npm run dev` | dev server z hot reload (port 3000) |
| `npm run build` | build produkcyjny Next.js |
| `npm start` | uruchomienie zbudowanej appki |
| `npm run lint` | ESLint |

---

## 10. Checklist — „zainstalowałem na nowym PC, czy działa?”

- [ ] `node --version` → ≥ 20
- [ ] `npm --version` → ≥ 10
- [ ] `npm install` przeszło bez błędów
- [ ] `npx playwright install chromium` przeszło
- [ ] `.env.local` istnieje i ma `ANTHROPIC_API_KEY`
- [ ] `npm run dev` startuje bez błędów
- [ ] http://localhost:3000 otwiera się w przeglądarce
- [ ] Wklejenie testowego URL-a z sekcji README zwraca wynik

---

## 11. Częste problemy

| Problem | Rozwiązanie |
|---|---|
| `'next' is not recognized` | Zapomniałeś `npm install` |
| `better-sqlite3` błąd kompilacji | Zainstaluj Visual Studio Build Tools + Python 3 (Windows) |
| Playwright: „Executable doesn't exist” | `npx playwright install chromium` |
| Port 3000 zajęty | `set PORT=3001 && npm run dev` (Windows) lub `PORT=3001 npm run dev` |
| OOM / dev server crash na Windows | skrypt `dev` już ustawia `--max-old-space-size=4096`; jeśli mało — zwiększ do `8192` |
| Brak tłumaczeń / generowania AI | sprawdź `ANTHROPIC_API_KEY` w `.env.local` |
| „Access denied” / CAPTCHA | przełącz `SCRAPER_MODE=unblocker` lub `decodo` i uzupełnij odpowiednie klucze |
