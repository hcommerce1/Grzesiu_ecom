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

Pakiet `better-sqlite3` kompiluje się przy instalacji. Jeśli `npm install` wypluje błąd `node-gyp` / `MSBuild`, zainstaluj:

```powershell
npm install --global --production windows-build-tools
```

lub ręcznie: **Visual Studio Build Tools** z workloadem „Desktop development with C++” + **Python 3.x**.

W praktyce na nowoczesnym Windows 11 z Node 22 prebuilt binary zwykle załatwia sprawę i kompilacja nie jest potrzebna.

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

- `OPENAI_API_KEY` — klucz OpenAI
- `APP_USER=hubert` (lub `grzesiek`)

Reszta (BaseLinker, Allegro, Decodo, FAL, Apify, Google Sheets, R2, Cloudinary) jest opcjonalna — tylko jeśli używasz danej funkcji.

---

## 6. (Opcjonalnie) Google Sheets

Jeśli chcesz korzystać z integracji Google Sheets, umieść plik service account w katalogu głównym jako:

```
google-credentials.json
```

Ścieżkę można nadpisać zmienną `GOOGLE_SHEETS_CREDENTIALS_PATH`. Plik jest w `.gitignore` — nigdy nie commituj.

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
- [ ] `.env.local` istnieje i ma `OPENAI_API_KEY`
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
| Brak tłumaczeń | sprawdź `OPENAI_API_KEY` i `LLM_MODEL` w `.env.local` |
| „Access denied” / CAPTCHA | przełącz `SCRAPER_MODE=unblocker` lub `decodo` i uzupełnij odpowiednie klucze |
