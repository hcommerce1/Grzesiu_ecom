# DEPENDENCIES — co siedzi w `package.json`

Pełna lista pakietów npm z krótkim opisem, do czego każdy służy w tym projekcie. Wersje zamrożone w `package-lock.json`.

Node.js: **20+** (zalecane 22 LTS). Manager: **npm** (ale działa też pnpm/yarn/bun).

---

## Runtime (`dependencies`)

### Framework i UI

| Pakiet | Wersja | Do czego |
|---|---|---|
| `next` | ^16.1.6 | Framework — App Router, SSR, API routes |
| `react` | 19.2.3 | UI |
| `react-dom` | 19.2.3 | UI (DOM renderer) |
| `@radix-ui/react-checkbox` | ^1.3.3 | Prymitywy UI — checkbox |
| `@radix-ui/react-dialog` | ^1.1.15 | Prymitywy UI — modale |
| `@radix-ui/react-select` | ^2.2.6 | Prymitywy UI — select |
| `@radix-ui/react-separator` | ^1.1.8 | Prymitywy UI — separator |
| `lucide-react` | ^0.577.0 | Ikony |
| `framer-motion` | ^12.38.0 | Animacje |
| `sonner` | ^2.0.7 | Toasty / notifications |
| `class-variance-authority` | ^0.7.1 | Warianty klas Tailwind |
| `clsx` | ^2.1.1 | Łączenie klas CSS |
| `tailwind-merge` | ^3.5.0 | Dedup klas Tailwind |

### State / data fetching

| Pakiet | Wersja | Do czego |
|---|---|---|
| `@tanstack/react-query` | ^5.97.0 | Cache + stan zapytań po stronie klienta |
| `zustand` | ^5.0.12 | Globalny store klienta |

### Scraping i parsowanie

| Pakiet | Wersja | Do czego |
|---|---|---|
| `playwright` | ^1.58.2 | Sterowanie Chromium (scraper tryb `playwright`) |
| `playwright-extra` | ^4.3.6 | Wrapper nad Playwright dla pluginów |
| `puppeteer-extra-plugin-stealth` | ^2.11.2 | Plugin ukrywający automatyzację przed sklepami |
| `jsdom` | ^27.0.1 | Parsowanie HTML po stronie serwera |
| `@types/jsdom` | ^28.0.0 | Typy (dlaczego w `dependencies` — są importowane w kodzie) |

### AI / LLM

| Pakiet | Wersja | Do czego |
|---|---|---|
| `@anthropic-ai/sdk` | ^0.89.0 | Claude API / Agent SDK (panel agenta, generacja opisów, vision) |

> Uwaga: kod używa wyłącznie Anthropic SDK. OpenAI to legacy z wcześniejszej wersji aplikacji — można zignorować ewentualne wzmianki w starych komentarzach.

### Storage / pliki / cloud

| Pakiet | Wersja | Do czego |
|---|---|---|
| `better-sqlite3` | ^12.8.0 | Lokalna baza SQLite (natywna) — jobs, cache |
| `@types/better-sqlite3` | `devDependency` | — |
| `@aws-sdk/client-s3` | ^3.1029.0 | Cloudflare R2 (kompatybilne z S3) |
| `cloudinary` | ^2.9.0 | Alternatywny storage obrazów |
| `archiver` | ^7.0.1 | Pakowanie zdjęć do ZIP |
| `@types/archiver` | ^7.0.0 | Typy (w `dependencies` — importowane) |
| `googleapis` | ^171.4.0 | Integracja z Google Sheets |

---

## Dev (`devDependencies`)

| Pakiet | Wersja | Do czego |
|---|---|---|
| `typescript` | ^5 | Kompilator TS |
| `@types/node` | ^20 | Typy Node |
| `@types/react` | ^19 | Typy React |
| `@types/react-dom` | ^19 | Typy React DOM |
| `tailwindcss` | ^4.2.2 | Tailwind CSS v4 |
| `@tailwindcss/postcss` | ^4 | Plugin PostCSS dla Tailwind v4 |
| `eslint` | ^9 | Linter |
| `eslint-config-next` | 16.1.6 | Reguły ESLint dla Next.js |

---

## Zależności poza npm

Te muszą być zainstalowane osobno (zobacz [SETUP.md](SETUP.md)):

| Co | Komenda | Kiedy potrzebne |
|---|---|---|
| **Chromium dla Playwright** | `npx playwright install chromium` | Zawsze, gdy `SCRAPER_MODE=playwright` |
| **Visual Studio Build Tools + Python** | instalator MS | Tylko na Windows, jeśli `better-sqlite3` nie ma prebuilt binary |

---

## Pełna instalacja jedną komendą

```bash
npm install && npx playwright install chromium
```
