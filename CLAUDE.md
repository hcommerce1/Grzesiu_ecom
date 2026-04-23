# Grzesiu_ecom — kontekst projektu dla Claude

## Co to jest

E-commerce scraper + listing tool. Scrapuje produkty z różnych źródeł, tłumaczy je, generuje opisy/tytuły AI, wystawia na BaseLinker / Allegro, zarządza obrazami w R2/Cloudinary, integruje się z Google Sheets.

Single-user app (`APP_USER=hubert` ma pełen dostęp; `grzesiek` ograniczony — patrz [src/lib/user.ts](src/lib/user.ts)).

## Stack

- **Framework**: Next.js 16.1.6 (App Router), React 19.2.3, TypeScript 5
- **DB**: better-sqlite3 12 (lokalna baza w `/tmp/sheets.db`, schemat w [src/lib/db.ts](src/lib/db.ts))
- **Scraping**: Playwright 1.58 + `playwright-extra` + stealth plugin; alternatywnie Decodo / ScrapingBee
- **AI**: `@anthropic-ai/sdk` 0.89 — wyłącznie Claude (OpenAI = legacy, do usunięcia)
- **State**: TanStack React Query (server cache) + Zustand (client store w [src/lib/stores/](src/lib/stores/))
- **UI**: Tailwind CSS v4 + Radix UI (dialog/select/checkbox) + Framer Motion + Sonner (toasty) + lucide-react (ikony)
- **Storage**: Cloudflare R2 (primary, kompatybilne z S3) + Cloudinary (fallback) — patrz [src/lib/cloud-storage.ts](src/lib/cloud-storage.ts)
- **External APIs**: Anthropic, Decodo, BaseLinker, Allegro (OAuth device flow), FAL.ai, Apify, Google Sheets

## Komendy

```bash
npm run dev      # port 3000, --max-old-space-size=4096 (OOM fix Windows), RAYON_NUM_THREADS=2
npm run build
npm run lint     # ESLint 9 + eslint-config-next
npm start
```

Brak Prettier. Brak testów (zero unit/E2E) — feature correctness sprawdzana ręcznie w przeglądarce.

## Architektura folderów

```
src/
├── app/
│   ├── api/                          # Next.js route handlers (47+ endpointów)
│   │   ├── agent/workflow/route.ts   # ★ KRYTYCZNE — Claude Agent SDK z tool use
│   │   ├── ai-autofill/              # auto-uzupełnianie pól
│   │   ├── ai-detect-diff-attrs/     # AI extract różnic wariantów
│   │   ├── ai-extract-variants/      # AI ekstrakcja wariantów
│   │   ├── allegro/                  # integracja Allegro (OAuth, suggest-categories, list)
│   │   ├── baselinker/               # mass listing + edycja BL
│   │   ├── batch-jobs/               # job queue
│   │   ├── bl-bootstrap/, bl-products/, bl-submit/
│   │   ├── description-chat/, description-preflight/
│   │   ├── generate-description/, generate-title/
│   │   ├── images/                   # upload, analyze, classify-prompt
│   │   ├── product-session/, scrape/, seller-scrape/
│   │   ├── sheets/                   # Google Sheets sync
│   │   └── token-usage/
│   └── (UI pages)
├── components/                       # React components
│   ├── BaselinkerWorkflowPanel.tsx   # ⚠ 1322 LOC — kandydat do dekompozycji
│   ├── GoogleSheetsTab.tsx           # ⚠ 1258 LOC
│   ├── EditProductsTab.tsx           # ⚠ 1215 LOC
│   ├── FieldsAndParametersStep.tsx   # ⚠ 1165 LOC
│   ├── AgentPanel.tsx                # UI dla Agent SDK workflow
│   └── ...
└── lib/                              # domain modules
    ├── db.ts                         # ⚠ 954 LOC — SQLite init, migrations
    ├── scraper.ts, scrapers/         # scraping engine
    ├── baselinker.ts                 # BL API
    ├── allegro.ts, allegro-params.ts # Allegro API
    ├── translator.ts                 # PL ↔ tłumaczenia
    ├── image-analyzer.ts, image-gen-utils.ts
    ├── description-generator.ts, description-prompt.ts, description-styles.ts
    ├── title-generator.ts
    ├── ai-autofill.ts, ai-field-filter.ts
    ├── parameter-matcher.ts, category-suggester.ts
    ├── product-session.ts, batch-session.ts
    ├── token-cost.ts, token-logger.ts   # tracking kosztów AI
    ├── rate-limiter.ts
    ├── cloud-storage.ts (R2 + Cloudinary)
    ├── google-sheets.ts
    ├── stores/                       # Zustand stores
    └── hooks/                        # custom React hooks
```

## Modele Claude w użyciu

Konfigurowane przez `.env.local`, defaulty w [ENV.md](ENV.md):

| Zmienna | Default | Użycie |
|---|---|---|
| `AGENT_MODEL` | `claude-haiku-4-5-20251001` | główny silnik Agent SDK workflow |
| `AGENT_VISION_MODEL` | `claude-sonnet-4-6` | analiza obrazów w Agent workflow |
| `DESCRIPTION_MODEL` | `claude-sonnet-4-6` | generowanie opisów produktów |
| `TITLE_MODEL` | `claude-haiku-4-5-20251001` | generowanie tytułów |
| `AUTOFILL_MODEL` | `claude-haiku-4-5-20251001` | auto-wypełnianie pól |

Tracking kosztów: [src/lib/token-cost.ts](src/lib/token-cost.ts), [src/lib/token-logger.ts](src/lib/token-logger.ts), endpoint `/api/token-usage`.

## Konwencje

- TypeScript strict
- ESLint 9 + `eslint-config-next` + `core-web-vitals`
- **Brak Prettier** — formatowanie ręczne lub przez `eslint --fix`
- **Brak testów** — przy zmianach UI/logiki testować ręcznie w przeglądarce na `localhost:3000` przed uznaniem za zrobione
- Walidacja wejścia w route'ach API: nieujednolicona — w wielu miejscach jej brak. Kandydat na zod (jeszcze nie wprowadzone)
- Komentarze w kodzie: minimum, kod ma się tłumaczyć sam
- Pliki tekstowe (dokumenty/PR descriptions): po polsku
- Modele Claude'a wybierać świadomie: Haiku do prostych operacji (autofill, tytuł), Sonnet do opisów/vision

## Tech debt — uwaga przy rozwoju

- **220+ wystąpień `any`/`unknown`** — przy edycji modułu zastąpić właściwymi typami
- **Mega-komponenty 1000+ LOC** (BaselinkerWorkflowPanel, GoogleSheetsTab, EditProductsTab, FieldsAndParametersStep) — nie rozbudowywać, tylko refaktorować przez ekstrakcję sub-komponentów
- **Brak zod / walidacji wejścia** w wielu route handlerach
- **Brak error boundaries** w niektórych miejscach UI
- **OpenAI legacy** — zmienne `OPENAI_API_KEY`, `LLM_MODEL`, `VISION_MODEL` można usunąć (kod ich nie używa)

## Sekrety i bezpieczeństwo

- `.env.local` — **NIGDY nie commituj**. Szablon: `.env.example`
- `google-credentials.json` — w `.gitignore`, ręczny upload na każdy nowy komp
- `package-lock.json` w repo (zamrożone wersje)
- Tokeny BaseLinker / Allegro / Decodo / FAL przechowywane wyłącznie w `.env.local`
- Allegro OAuth: tokeny refresh-owane automatycznie, przechowywane lokalnie

## Workflow rozwoju

1. **Rozumiem zmianę** zanim zacznę — szczególnie w `db.ts`, `route.ts agent/workflow`, mega-komponentach
2. **Edytuję chirurgicznie** — żadnych "porządków przy okazji" bez prośby
3. **Po edycji**: sprawdzam czy nie zostawiłem starego/zduplikowanego kodu (egzekwowane też hookiem PostEdit z [.claude/settings.json](.claude/settings.json))
4. **Przed commitem**: `npm run lint` + ręczny test w przeglądarce
5. **Brak testów** — feature correctness sprawdzana wizualnie

## Pliki dokumentacji

- [SETUP.md](SETUP.md) — instalacja na nowym PC
- [ENV.md](ENV.md) — pełna lista zmiennych środowiskowych
- [DEPENDENCIES.md](DEPENDENCIES.md) — lista pakietów npm

## User context

User pisze po polsku. Preferuje minimalizm narzędzi (jedno proste rozwiązanie zamiast frameworka z 100 funkcji). Ceni szczerość — mówić wprost gdy coś jest noise / nie ma sensu, zamiast sprzedawać narzędzia. Wartościuje oszczędność tokenów i czysty kod.
