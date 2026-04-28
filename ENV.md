# ENV — zmienne środowiskowe

Wszystkie zmienne ładowane z `.env.local` (plik w `.gitignore`). Szablon: [.env.example](.env.example).

**Minimum do działania podstawowej funkcjonalności (scrape + tłumaczenie + generowanie opisów/tytułów):**
`ANTHROPIC_API_KEY` + `APP_USER` + (`DECODO_API_USERNAME` + `DECODO_API_PASSWORD` **lub** zmienione `SCRAPER_MODE=playwright`)

---

## Użytkownik aplikacji

| Zmienna | Wymagana | Opis |
|---|---|---|
| `APP_USER` | tak | `hubert` (pełny dostęp: seller scraper, masowa edycja BL) lub `grzesiek` (podstawowy). Sprawdzane w [src/lib/user.ts](src/lib/user.ts) |

---

## Anthropic / Claude (LLM — główny silnik AI)

| Zmienna | Wymagana | Domyślna | Opis |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | **tak** | — | Klucz Anthropic. Używany przez: translator, generate-description, generate-title, ai-autofill, agent/workflow, description-chat, description-preflight, ai-extract-variants, ai-detect-diff-attrs, images/analyze, images/classify-prompt, allegro/suggest-categories, seller-scrape AI chat |
| `TITLE_MODEL` | nie | `claude-haiku-4-5-20251001` | Model do generowania tytułów |
| `DESCRIPTION_MODEL` | nie | `claude-sonnet-4-6` | Model do generowania opisów (w Agent workflow) |
| `AUTOFILL_MODEL` | nie | `claude-haiku-4-5-20251001` | Model do auto-wypełniania pól |
| `AGENT_MODEL` | nie | `claude-haiku-4-5-20251001` | Główny model dla Agent SDK workflow |
| `AGENT_VISION_MODEL` | nie | `claude-sonnet-4-6` | Model vision dla Agent workflow |

> OpenAI nie jest już używane w kodzie — stare zmienne `OPENAI_API_KEY`, `LLM_MODEL`, `VISION_MODEL` są legacy i można je usunąć z `.env.local`.

---

## Scraper

| Zmienna | Wymagana | Domyślna | Opis |
|---|---|---|---|
| `SCRAPER_MODE` | nie | `decodo` | `decodo` \| `unblocker` (ScrapingBee) \| `playwright` (lokalnie) |
| `SCRAPINGBEE_API_KEY` | tylko dla `unblocker` | — | Klucz ScrapingBee |
| `DECODO_API_USERNAME` | tylko dla `decodo` | — | Login Decodo Web Scraping API |
| `DECODO_API_PASSWORD` | tylko dla `decodo` | — | Hasło Decodo |

---

## BaseLinker

| Zmienna | Wymagana | Opis |
|---|---|---|
| `BASELINKER_TOKEN` | tylko jeśli używasz BL | Token API BaseLinker (mass listing, edycja aukcji) |

---

## Allegro (OAuth device flow — tokeny zarządzane automatycznie)

| Zmienna | Wymagana | Opis |
|---|---|---|
| `ALLEGRO_CLIENT_ID` | tylko jeśli używasz Allegro | Client ID aplikacji Allegro |
| `ALLEGRO_CLIENT_SECRET` | tylko jeśli używasz Allegro | Client Secret aplikacji Allegro |

---

## Generowanie obrazów AI

| Zmienna | Wymagana | Opis |
|---|---|---|
| `FAL_KEY` | tylko jeśli generujesz obrazy | Klucz FAL.ai (NanoBanana Pro, Flux) |
| `REMOVEBG_API_KEY` | tylko jeśli usuwasz tło | remove.bg API |
| `REPLICATE_API_TOKEN` | tylko jeśli używasz Replicate | Replicate.com |
| `PHOTOROOM_API_KEY` | tylko jeśli używasz PhotoRoom | photoroom.com/api — usuń tło, zamień tło AI, relight, cień, upscale, expand, flat lay, ghost mannequin |
| `FAL_MODEL_NANOBANANAPRO` | nie | Nadpisanie domyślnego modelu — np. `fal-ai/nanobananapro` |
| `FAL_MODEL_FLUXCONTEXTPRO` | nie | Nadpisanie — np. `fal-ai/flux-pro/v1.1-ultra` |
| `REPLICATE_MODEL_VERSION` | nie | Wersja modelu Replicate |

---

## Apify (ASIN → EAN)

| Zmienna | Wymagana | Opis |
|---|---|---|
| `APIFY_TOKEN` | tylko jeśli używasz ASIN→EAN | Token Apify |

---

## Google Sheets

| Zmienna | Wymagana | Opis |
|---|---|---|
| `GOOGLE_SHEETS_CREDENTIALS_PATH` | nie | Ścieżka do JSON-a service account, domyślnie `./google-credentials.json` |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | tylko jeśli używasz GSheets | ID arkusza (z URL-a) |
| `GOOGLE_SHEETS_SHEET_GID` | tylko jeśli używasz GSheets | GID konkretnej zakładki |

> Plik `google-credentials.json` jest w `.gitignore`. Na nowym PC trzeba go wgrać ręcznie.

---

## Cloudflare R2 (opcjonalne — cloud storage obrazów)

| Zmienna | Wymagana | Opis |
|---|---|---|
| `R2_ACCOUNT_ID` | nie | Account ID Cloudflare |
| `R2_ACCESS_KEY_ID` | nie | Access key R2 |
| `R2_SECRET_ACCESS_KEY` | nie | Secret key R2 |
| `R2_BUCKET_NAME` | nie | Nazwa bucketa |
| `R2_PUBLIC_URL` | nie | Publiczny URL bucketa |

> Wszystkie pięć musi być ustawione żeby R2 się aktywował (sprawdzane w [src/lib/cloud-storage.ts](src/lib/cloud-storage.ts)).

---

## Cloudinary (opcjonalne — alternatywny storage, fallback po R2)

| Zmienna | Wymagana | Opis |
|---|---|---|
| `CLOUDINARY_CLOUD_NAME` | nie | Nazwa cloudu |
| `CLOUDINARY_API_KEY` | nie | Klucz Cloudinary |
| `CLOUDINARY_API_SECRET` | nie | Sekret Cloudinary |

---

## Przykładowy minimalny `.env.local`

```env
APP_USER=hubert
ANTHROPIC_API_KEY=sk-ant-...
SCRAPER_MODE=decodo
DECODO_API_USERNAME=...
DECODO_API_PASSWORD=...
```

Tyle wystarczy, żeby odpalić dev server i zescrapować + przetłumaczyć + wygenerować opis/tytuł.

Alternatywnie, bez Decodo:
```env
APP_USER=hubert
ANTHROPIC_API_KEY=sk-ant-...
SCRAPER_MODE=playwright
```
