import Anthropic from '@anthropic-ai/sdk';
import { NextRequest } from 'next/server';
import type { ProductSession, AllegroParameter, ImageMeta, DescriptionSection, ChatAction } from '@/lib/types';
import { analyzeImages, type ProductContext } from '@/lib/image-analyzer';
import { suggestCategory } from '@/lib/category-suggester';
import { fetchCategoryParameters } from '@/lib/allegro-params';
import { buildAutoFillPrompt, validateAutoFillResponse } from '@/lib/ai-autofill';
import { generateDescription } from '@/lib/description-generator';
import { generateTitle } from '@/lib/title-generator';
import { logTokenUsage } from '@/lib/token-logger';
import { calcCost, sumUsage } from '@/lib/token-cost';
import type { AnthropicUsage } from '@/lib/token-cost';
import { getUsdToPln } from '@/lib/fx-rate';
import { parseClaudeJson } from '@/lib/parse-claude-json';
import { randomUUID } from 'crypto';

const AGENT_MODEL = process.env.AGENT_MODEL || 'claude-haiku-4-5-20251001';
const AUTOFILL_MODEL = process.env.AUTOFILL_MODEL || 'claude-haiku-4-5-20251001';
const DESCRIPTION_MODEL = process.env.DESCRIPTION_MODEL || 'claude-sonnet-4-6';
const TITLE_MODEL = process.env.TITLE_MODEL || 'claude-haiku-4-5-20251001';
const VISION_MODEL = process.env.AGENT_VISION_MODEL || 'claude-sonnet-4-6';
const CATEGORY_MODEL = 'claude-haiku-4-5-20251001';
const MAX_ITERATIONS = 20;

type Step = 'inventory' | 'category' | 'images' | 'fields-params' | 'preview' | 'approval';

interface AgentRequest {
  message: string;
  mode: 'start' | 'chat';
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  session: ProductSession;
  imagesMeta: ImageMeta[];
  productId: string;
  sessionKey?: string;
  currentStep?: Step;
}

interface AgentState {
  session: ProductSession;
  imagesMeta: ImageMeta[];
  allegroParams: AllegroParameter[];
  filledParameters: Record<string, string | string[]>;
  generatedSections: DescriptionSection[];
  generatedTitle: string;
  usageByModel: Record<string, AnthropicUsage>;
}

function addUsage(state: AgentState, model: string, usage: AnthropicUsage): void {
  const existing = state.usageByModel[model] ?? {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  state.usageByModel[model] = sumUsage([existing, usage]);
}

const KEY_ATTRIBUTE_NAMES = ['Marka', 'Materiał', 'Kolor', 'Typ', 'Model', 'Rodzaj'];

const STEP_LABELS: Record<Step, string> = {
  inventory: 'Magazyn',
  category: 'Kategoria',
  images: 'Zdjęcia',
  'fields-params': 'Parametry',
  preview: 'Podgląd',
  approval: 'Wyślij',
};

const TAB_ALLOWED_TOOLS: Record<Step, Set<string>> = {
  inventory: new Set([]),
  category: new Set(['suggest_category']),
  images: new Set(['analyze_images']),
  'fields-params': new Set(['fetch_category_parameters', 'fill_parameters', 'validate_parameters', 'update_parameter']),
  preview: new Set([
    'generate_title', 'update_title', 'generate_description',
    'update_section', 'add_section', 'remove_section', 'expand_section',
    'reorder_sections', 'change_section_layout', 'reorder_section_images',
    'add_image_to_section', 'remove_image_from_section',
    'regenerate_description', 'regenerate_title', 'change_description_style',
  ]),
  approval: new Set([]),
};

function imageGuard(imagesMeta: ImageMeta[]): string | null {
  const totalActive = imagesMeta.filter(img => !img.removed).length;
  if (totalActive === 0) return null;
  // Po analizie obrazu, aiConfidence jest >0 tylko dla obrazów które przeszły fetch + analizę Claude.
  // Placeholder błędu (404/timeout/itd.) ustawia confidence=0.
  const valid = imagesMeta.filter(img => !img.removed && (img.aiConfidence ?? 0) > 0).length;
  if (valid === 0) {
    return JSON.stringify({
      error: 'Wszystkie zdjęcia mają błąd pobrania — nie mogę generować na pustych analizach. Powiedz userowi żeby najpierw naprawił zdjęcia (zakładka Zdjęcia, np. re-scrape produktu).',
      awaiting_user_action: true,
    });
  }
  if (totalActive >= 3 && valid / totalActive < 0.5) {
    return JSON.stringify({
      error: `Tylko ${valid}/${totalActive} zdjęć ma poprawną analizę — wynik byłby niskiej jakości. Powiedz userowi żeby ponowił analizę zdjęć (lub re-scrape produktu jeśli URL-e są martwe).`,
      awaiting_user_action: true,
    });
  }
  return null;
}

function pickKeyAttributes(attrs: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!attrs) return undefined;
  const picked: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (!v || !String(v).trim()) continue;
    if (KEY_ATTRIBUTE_NAMES.some(name => k.toLowerCase().includes(name.toLowerCase()))) {
      picked[k] = String(v);
    }
  }
  return Object.keys(picked).length ? picked : undefined;
}

// ─── Tool definitions ───

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'analyze_images',
    description: 'Use when user is on Zdjęcia tab and wants AI photo analysis. Downloads each URL server-side (base64), sends to Claude vision, returns description + labelText + features + variantHint per image. Input: imageUrls array (use state.session.data.images jeśli user nie podał).',
    input_schema: {
      type: 'object',
      properties: {
        imageUrls: { type: 'array', items: { type: 'string' }, description: 'URL-e zdjęć do analizy (publiczne)' },
      },
      required: ['imageUrls'],
    },
  },
  {
    name: 'suggest_category',
    description: 'Use when user is on Kategoria tab and category is not selected yet. Returns top-N kandydatów kategorii Allegro z prowizją na podstawie tytułu i atrybutów. Po wywołaniu zatrzymuje workflow do potwierdzenia użytkownika w UI.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        attributes: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['title'],
    },
  },
  {
    name: 'fetch_category_parameters',
    description: 'Use when user is on Parametry tab and category parameters are not loaded yet (state.allegroParams empty). Pobiera schema parametrów kategorii Allegro (required/optional, słowniki). Wywołaj raz po wybraniu kategorii.',
    input_schema: {
      type: 'object',
      properties: {
        categoryId: { type: 'string', description: 'ID kategorii Allegro' },
      },
      required: ['categoryId'],
    },
  },
  {
    name: 'fill_parameters',
    description: 'Use when user is on Parametry tab and category parameters already fetched (state.allegroParams not empty). Auto-uzupełnia parametry AI-em na bazie atrybutów produktu i analizy zdjęć. Następny krok po fetch_category_parameters.',
    input_schema: {
      type: 'object',
      properties: {
        focusParameterIds: { type: 'array', items: { type: 'string' }, description: 'Opcjonalne — focusuj tylko na tych parametrach' },
      },
    },
  },
  {
    name: 'validate_parameters',
    description: 'Use after fill_parameters on Parametry tab — sprawdza które wymagane parametry są nadal puste. Zwraca listę brakujących (z nazwami) + flagę allFilled.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'update_parameter',
    description: 'Use on Parametry tab when user provides value for specific parameter (po pytaniu o brakujące). Dla typu dictionary podaj option_id ze słownika, NIE nazwę.',
    input_schema: {
      type: 'object',
      properties: {
        parameterId: { type: 'string', description: 'ID parametru z listy allegroParameters' },
        value: {
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: 'Dla dictionary: option_id. Dla innych typów: wartość.',
        },
      },
      required: ['parameterId', 'value'],
    },
  },
  {
    name: 'generate_title',
    description: 'Use on Podgląd tab to generate auction title (max 75 znaków, WIELKIE LITERY) na bazie atrybutów + parametrów + analizy zdjęć. Zwraca tytuł główny + 3 alternatywy.',
    input_schema: {
      type: 'object',
      properties: {
        additionalContext: { type: 'string', description: 'Dodatkowe informacje od użytkownika wpływające na tytuł' },
      },
    },
  },
  {
    name: 'update_title',
    description: 'Use on Podgląd tab when user picks tytuł z kandydatów albo podaje własny — ustawia konkretny string jako tytuł aukcji.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Tytuł max 75 znaków, WIELKIE LITERY' },
      },
      required: ['title'],
    },
  },
  {
    name: 'generate_description',
    description: 'Use on Podgląd tab po generate_title — generuje strukturyzowany opis HTML z sekcjami (heading + bodyHtml + layout). Style: technical (AGD/elektronika), lifestyle (meble/dekoracje), simple (reszta).',
    input_schema: {
      type: 'object',
      properties: {
        style: {
          type: 'string',
          enum: ['technical', 'lifestyle', 'simple'],
          description: 'technical: elektronika/AGD/narzędzia. lifestyle: meble/dekoracje. simple: wszystko inne.',
        },
        additionalContext: { type: 'string', description: 'Dodatkowy kontekst od użytkownika (stan, uwagi, zastosowanie)' },
      },
    },
  },
  {
    name: 'update_section',
    description: 'Use on Podgląd tab when user mówi "zmień treść sekcji X" / "popraw nagłówek". Nadpisuje bodyHtml lub heading konkretnej sekcji.',
    input_schema: {
      type: 'object',
      properties: {
        sectionId: { type: 'string' },
        heading: { type: 'string', description: 'Nowy nagłówek CAPS (opcjonalne)' },
        bodyHtml: { type: 'string', description: 'Nowa treść HTML (opcjonalne)' },
        layout: { type: 'string', enum: ['image-text', 'text-only', 'images-only'] },
      },
      required: ['sectionId'],
    },
  },
  {
    name: 'add_section',
    description: 'Use on Podgląd tab when user mówi "dodaj sekcję X". Wstawia nową sekcję (heading + bodyHtml + layout) do opisu.',
    input_schema: {
      type: 'object',
      properties: {
        heading: { type: 'string', description: 'Nagłówek CAPS' },
        bodyHtml: { type: 'string' },
        layout: { type: 'string', enum: ['image-text', 'text-only', 'images-only'] },
        afterSectionId: { type: 'string', description: 'Wstaw po tej sekcji (opcjonalne — domyślnie na końcu)' },
      },
      required: ['heading', 'bodyHtml', 'layout'],
    },
  },
  {
    name: 'remove_section',
    description: 'Use on Podgląd tab when user mówi "usuń sekcję X" / "wywal sekcję".',
    input_schema: {
      type: 'object',
      properties: { sectionId: { type: 'string' } },
      required: ['sectionId'],
    },
  },
  // ─── Section edition extensions ───
  {
    name: 'expand_section',
    description: 'Use on Podgląd tab when user mówi "rozbuduj sekcję X" / "dodaj informację do sekcji". Generuje pełną nową bodyHtml (rozbudowaną o dodatkowe info) zastępującą starą.',
    input_schema: {
      type: 'object',
      properties: {
        sectionId: { type: 'string' },
        bodyHtml: { type: 'string', description: 'Nowa treść HTML zastępująca starą (rozbudowana o dodatkowe info)' },
        heading: { type: 'string' },
      },
      required: ['sectionId', 'bodyHtml'],
    },
  },
  {
    name: 'reorder_sections',
    description: 'Zmienia kolejność sekcji opisu. Przekaż pełną listę sectionIds w nowej kolejności.',
    input_schema: {
      type: 'object',
      properties: {
        sectionIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['sectionIds'],
    },
  },
  {
    name: 'change_section_layout',
    description: 'Zmienia tylko layout sekcji (image-text / text-only / images-only) — bez ruszania treści.',
    input_schema: {
      type: 'object',
      properties: {
        sectionId: { type: 'string' },
        layout: { type: 'string', enum: ['image-text', 'text-only', 'images-only'] },
      },
      required: ['sectionId', 'layout'],
    },
  },
  {
    name: 'reorder_section_images',
    description: 'Zmienia kolejność zdjęć wewnątrz konkretnej sekcji opisu.',
    input_schema: {
      type: 'object',
      properties: {
        sectionId: { type: 'string' },
        imageUrls: { type: 'array', items: { type: 'string' }, description: 'Pełna lista URL-i zdjęć w nowej kolejności' },
      },
      required: ['sectionId', 'imageUrls'],
    },
  },
  {
    name: 'add_image_to_section',
    description: 'Dodaje zdjęcie (URL) do sekcji opisu.',
    input_schema: {
      type: 'object',
      properties: {
        sectionId: { type: 'string' },
        imageUrl: { type: 'string' },
      },
      required: ['sectionId', 'imageUrl'],
    },
  },
  {
    name: 'remove_image_from_section',
    description: 'Usuwa zdjęcie (URL) z sekcji opisu.',
    input_schema: {
      type: 'object',
      properties: {
        sectionId: { type: 'string' },
        imageUrl: { type: 'string' },
      },
      required: ['sectionId', 'imageUrl'],
    },
  },
  // ─── Regeneracje i zmiana stylu ───
  {
    name: 'regenerate_description',
    description: 'Generuje opis od nowa z obecnymi danymi (ew. innym stylem / dodatkowym kontekstem). Użyj gdy user prosi "wygeneruj od nowa", "napisz inaczej".',
    input_schema: {
      type: 'object',
      properties: {
        style: { type: 'string', enum: ['technical', 'lifestyle', 'simple'] },
        additionalContext: { type: 'string' },
      },
    },
  },
  {
    name: 'regenerate_title',
    description: 'Generuje tytuł od nowa (3-5 kandydatów). Użyj gdy user prosi "inny tytuł", "wygeneruj tytuł".',
    input_schema: {
      type: 'object',
      properties: {
        additionalContext: { type: 'string' },
      },
    },
  },
  {
    name: 'change_description_style',
    description: 'Zmienia globalny styl opisu (technical/lifestyle/simple) i natychmiast regeneruje.',
    input_schema: {
      type: 'object',
      properties: {
        style: { type: 'string', enum: ['technical', 'lifestyle', 'simple'] },
      },
      required: ['style'],
    },
  },
  // ─── Scrape z URL konkurenta ───
  {
    name: 'scrape_and_fill_from_url',
    description: 'Prosi frontend o pobranie danych z podanego URL (konkurencyjna oferta) i auto-fill parametrów. Użyj gdy user wkleja link.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Pełny URL do strony produktu' },
      },
      required: ['url'],
    },
  },
  // ─── Pytanie do usera ───
  {
    name: 'ask_user',
    description: 'Zadaje konkretne pytanie do usera (zamiast zgadywać) i kończy turę — czeka na odpowiedź w chacie. Użyj przed generate_description jeśli brakuje kluczowych informacji (styl, przeznaczenie, stan).',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Treść pytania po polsku' },
        options: { type: 'array', items: { type: 'string' }, description: 'Opcjonalne gotowe odpowiedzi do wyboru' },
      },
      required: ['question'],
    },
  },
  // ─── Pola produktu ───
  {
    name: 'update_price',
    description: 'Ustawia cenę produktu.',
    input_schema: {
      type: 'object',
      properties: {
        price: { type: 'string', description: 'Kwota (np. "129.99")' },
        currency: { type: 'string', description: 'Waluta (np. "PLN"), opcjonalne' },
      },
      required: ['price'],
    },
  },
  {
    name: 'update_tax_rate',
    description: 'Ustawia stawkę VAT produktu (%).',
    input_schema: {
      type: 'object',
      properties: {
        taxRate: { oneOf: [{ type: 'number' }, { type: 'string' }] },
      },
      required: ['taxRate'],
    },
  },
  {
    name: 'update_sku',
    description: 'Ustawia SKU produktu.',
    input_schema: {
      type: 'object',
      properties: { sku: { type: 'string' } },
      required: ['sku'],
    },
  },
  {
    name: 'update_ean',
    description: 'Ustawia EAN produktu.',
    input_schema: {
      type: 'object',
      properties: { ean: { type: 'string' } },
      required: ['ean'],
    },
  },
  {
    name: 'update_inventory',
    description: 'Ustawia katalog BaseLinker (inventory_id) i/lub magazyn (warehouseId).',
    input_schema: {
      type: 'object',
      properties: {
        inventoryId: { type: 'number' },
        warehouseId: { type: 'string' },
      },
    },
  },
  // ─── Zdjęcia główne produktu ───
  {
    name: 'reorder_product_images',
    description: 'Zmienia kolejność zdjęć głównych produktu (cała galeria).',
    input_schema: {
      type: 'object',
      properties: {
        imageUrls: { type: 'array', items: { type: 'string' }, description: 'Pełna lista URL-i w nowej kolejności' },
      },
      required: ['imageUrls'],
    },
  },
  {
    name: 'add_product_image',
    description: 'Dodaje zdjęcie (URL) do galerii głównej produktu.',
    input_schema: {
      type: 'object',
      properties: { imageUrl: { type: 'string' } },
      required: ['imageUrl'],
    },
  },
  {
    name: 'remove_product_image',
    description: 'Usuwa zdjęcie (URL) z galerii głównej produktu.',
    input_schema: {
      type: 'object',
      properties: { imageUrl: { type: 'string' } },
      required: ['imageUrl'],
    },
  },
];

const TOOL_LABELS: Record<string, string> = {
  analyze_images: 'Analizuję zdjęcia...',
  suggest_category: 'Sugeruję kategorię...',
  fetch_category_parameters: 'Pobieram parametry kategorii...',
  fill_parameters: 'Auto-uzupełniam parametry...',
  validate_parameters: 'Sprawdzam kompletność...',
  update_parameter: 'Aktualizuję parametr...',
  generate_title: 'Generuję tytuł...',
  update_title: 'Ustawiam tytuł...',
  generate_description: 'Generuję opis...',
  update_section: 'Aktualizuję sekcję...',
  add_section: 'Dodaję sekcję...',
  remove_section: 'Usuwam sekcję...',
  expand_section: 'Rozszerzam sekcję...',
  reorder_sections: 'Zmieniam kolejność sekcji...',
  change_section_layout: 'Zmieniam layout sekcji...',
  reorder_section_images: 'Zmieniam kolejność zdjęć...',
  add_image_to_section: 'Dodaję zdjęcie do sekcji...',
  remove_image_from_section: 'Usuwam zdjęcie z sekcji...',
  regenerate_description: 'Regeneruję opis...',
  regenerate_title: 'Regeneruję tytuł...',
  change_description_style: 'Zmieniam styl opisu...',
  scrape_and_fill_from_url: 'Pobieram dane z URL...',
  ask_user: 'Pytam użytkownika...',
  update_price: 'Ustawiam cenę...',
  update_tax_rate: 'Ustawiam VAT...',
  update_sku: 'Ustawiam SKU...',
  update_ean: 'Ustawiam EAN...',
  update_inventory: 'Ustawiam katalog...',
  reorder_product_images: 'Zmieniam kolejność zdjęć produktu...',
  add_product_image: 'Dodaję zdjęcie produktu...',
  remove_product_image: 'Usuwam zdjęcie produktu...',
};

// ─── System prompt ───

// ─── Static system prompt — cacheable (nie zależy od state) ───
const ALL_TABS_LINE = (Object.keys(STEP_LABELS) as Step[]).map(k => STEP_LABELS[k]).join(' → ');

const STATIC_SYSTEM_PROMPT = `<role>
Asystent wystawiania produktów na Allegro. Pomagasz Grzesiowi krok po kroku — od zescrapowanych danych do gotowej oferty.
</role>

<rules>
- Pisz po polsku z poprawnymi diakrytykami (ą, ć, ę, ł, ń, ó, ś, ź, ż).
- Gdy masz dostępne narzędzia — WYWOŁUJ JE od razu. NIE pisz "teraz zrobię X" — user widzi progress w UI.
- Pisz tekstem TYLKO gdy: trzeba zapytać usera o brakującą informację / błąd nie do obejścia / krótkie podsumowanie po skończeniu.
- Bez "świetnie!", "teraz zrobię…", "mam to!", "oto co widzę". Bez monologów krok-po-kroku.
</rules>

<tabs>
NIGDY nie wymyślaj nazw zakładek. Istniejące zakładki workflow:
${ALL_TABS_LINE}
Inne nazwy (np. "Szczegóły produktu", "Podstawowe informacje") NIE ISTNIEJĄ.
</tabs>

<system_messages>
Wiadomości zaczynające się od "[SYSTEM]" pochodzą z UI (zmiana zakładki / kategorii) — traktuj je jako konkretny rozkaz, nie odpowiadaj wywodem.
</system_messages>

<param_rules>
- Dictionary → zwracaj WYŁĄCZNIE option_id (np. "225088"), NIGDY nazwę.
- Nie wymyślaj wartości których nie ma w danych produktu.
- Wymiary przepisuj DOKŁADNIE jak na etykiecie, przelicz jednostki gdy trzeba.
</param_rules>

<description_rules>
- Nagłówki sekcji ZAWSZE CAPS: "CECHY I ZALETY", "ZASTOSOWANIA", "SPECYFIKACJA TECHNICZNA".
- HTML: <b>, <ul>, <li>, <p> — NIE <strong>, <em>.
- Nie pisz o gwarancji, nie pisz "Stan: Nowy", nie powtarzaj tytułu dosłownie.
- Layout: "image-text" zdjęcie+tekst, "text-only" bez zdjęcia, "images-only" dla banner/logo.
</description_rules>`;

// ─── Dynamic state block — idzie jako preludium user message (NIE cacheable) ───
function buildStateBlock(state: AgentState, currentStep?: Step): string {
  const { session, allegroParams } = state;
  const requiredParams = allegroParams.filter(p => p.required);
  const cat = session.allegroCategory?.path ?? session.allegroCategory?.name ?? '(nie wybrana)';
  const filledCount = Object.keys(state.filledParameters).length;

  const allowed = currentStep ? [...TAB_ALLOWED_TOOLS[currentStep]] : [];
  const allowedLine = currentStep
    ? (allowed.length === 0
        ? '(żadne — odpowiedz krótko po polsku że na tej zakładce nic do zrobienia, zakończ turę)'
        : allowed.join(', '))
    : '(brak filtrowania)';

  const attrText = Object.entries(session.data?.attributes ?? {})
    .slice(0, 12)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n') || '  (brak)';

  const paramsListing = allegroParams.length > 0
    ? [
        ...requiredParams.map(p => `  [WYMAGANY] ${p.name} (${p.type})${p.unit ? ` [${p.unit}]` : ''} ID=${p.id}`),
        ...allegroParams.filter(p => !p.required).slice(0, 15).map(p => `  ${p.name} (${p.type}) ID=${p.id}`),
      ].join('\n')
    : '  (pobierz kategorię najpierw — fetch_category_parameters)';

  const filledListing = filledCount > 0
    ? Object.entries(state.filledParameters).slice(0, 10).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`).join('\n')
    : '  (brak)';

  return `<state>
Aktywna zakładka: ${currentStep ? STEP_LABELS[currentStep] : '(brak)'}
Dostępne na tej zakładce narzędzia: ${allowedLine}

Tytuł produktu: ${session.data?.title ?? '(brak)'}
EAN: ${session.data?.ean ?? '(brak)'} | SKU: ${session.data?.sku ?? '(brak)'}
Cena: ${session.data?.price ?? '(brak)'} ${session.data?.currency ?? ''}
Zdjęć w sesji: ${(session.data?.images ?? []).length}
Kategoria Allegro: ${cat}
Tytuł aukcji wygenerowany: ${state.generatedTitle ? 'tak' : 'nie'}
Parametry kategorii: ${allegroParams.length} (wymaganych ${requiredParams.length}, wypełnionych ${filledCount})

Atrybuty produktu (skrót):
${attrText}

Parametry kategorii (skrót):
${paramsListing}

Wypełnione parametry:
${filledListing}
</state>`;
}


// ─── Tool executor ───

const GATE_BLOCKED_TOOLS = new Set([
  'analyze_images', 'fetch_category_parameters', 'fill_parameters',
  'validate_parameters', 'generate_title', 'generate_description',
  'update_section', 'add_section', 'remove_section',
  // Opis/tytuł — blokujemy do czasu wybrania kategorii
  'expand_section', 'reorder_sections', 'change_section_layout',
  'reorder_section_images', 'add_image_to_section', 'remove_image_from_section',
  'regenerate_description', 'regenerate_title', 'change_description_style',
]);

async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  state: AgentState,
  sseWrite: (data: object) => void,
  productId: string,
  sessionKey: string,
  apiKey: string,
  currentStep?: Step,
): Promise<string> {
  if (currentStep && !TAB_ALLOWED_TOOLS[currentStep].has(toolName)) {
    return JSON.stringify({
      error: `TAB_GATE: user jest na zakładce "${STEP_LABELS[currentStep]}", to narzędzie nie należy do tej zakładki. Powiedz userowi krótko co może zrobić w tej zakładce, albo na którą zakładkę musi przejść — NIE wywołuj innych narzędzi.`,
      awaiting_user_action: true,
      current_step: currentStep,
    });
  }
  if (GATE_BLOCKED_TOOLS.has(toolName) && !state.session.allegroCategory?.id) {
    return JSON.stringify({
      error: 'GATE: kategoria nie jest wybrana. Wywołaj suggest_category i zakończ turę — czekaj na potwierdzenie usera w UI.',
      awaiting_user_selection: true,
    });
  }

  switch (toolName) {
    case 'analyze_images': {
      const urls = (input.imageUrls as string[]) ?? state.session.data?.images ?? [];
      if (!urls.length) return JSON.stringify({ error: 'Brak URL-i zdjęć' });

      // Dedupe — pomijaj URL-e które już mają udaną analizę (aiConfidence > 0).
      // Bez tego agent może wywołać analyze_images dwa razy w jednej turze i policzyć tokeny vision podwójnie.
      const analyzedUrls = new Set(
        state.imagesMeta.filter(m => (m.aiConfidence ?? 0) > 0).map(m => m.url)
      );
      const newUrls = urls.filter(u => !analyzedUrls.has(u));

      if (newUrls.length === 0) {
        return JSON.stringify({
          already_analyzed: urls.length,
          stop: true,
          instruction: 'Wszystkie zdjęcia już przeanalizowane — NIE wywołuj analyze_images ponownie. Zakończ turę.',
        });
      }

      const context: ProductContext = {
        title: state.session.data?.title,
        categoryPath: state.session.allegroCategory?.path,
        keyAttributes: pickKeyAttributes(state.session.data?.attributes),
      };
      const { results, usage } = await analyzeImages(newUrls, apiKey, context);

      // Merge: zachowujemy stare przeanalizowane + dokładamy nowe wyniki.
      const existingByUrl = new Map(state.imagesMeta.map(m => [m.url, m]));
      const newByUrl = new Map(results.map(r => [r.url, r]));
      state.imagesMeta = urls.map((url, i) => {
        const r = newByUrl.get(url);
        if (r) {
          return {
            url,
            order: i,
            removed: false,
            aiDescription: r.aiDescription,
            aiConfidence: r.aiConfidence,
            isFeatureImage: r.isFeatureImage,
            features: r.features,
            userDescription: '',
            uploadedVia: undefined,
          };
        }
        const old = existingByUrl.get(url);
        return old ? { ...old, order: i } : {
          url, order: i, removed: false,
          aiDescription: '', aiConfidence: 0, isFeatureImage: false, features: [],
          userDescription: '', uploadedVia: undefined,
        };
      });

      logTokenUsage({ productId, sessionKey, toolName, model: VISION_MODEL, usage });
      addUsage(state, VISION_MODEL, usage);
      sseWrite({ type: 'images_analyzed', imagesMeta: state.imagesMeta });
      // L: persist do session żeby UI/DB wiedział o analizie
      sseWrite({ type: 'session_patch', patch: { imagesMeta: state.imagesMeta } });
      sseWrite({ type: 'token_usage', toolName, ...usage, ...calcCost(usage, VISION_MODEL) });

      const labelTexts = results.filter(r => r.labelText).map(r => r.labelText).slice(0, 3);
      return JSON.stringify({
        analyzed_now: results.length,
        analyzed_total: urls.length,
        labelTexts: labelTexts.length ? labelTexts : null,
        features: results.flatMap(r => r.features).slice(0, 8),
        types: [...new Set(results.map(r => r.imageType))],
      });
    }

    case 'suggest_category': {
      if (state.session.allegroCategory?.id) {
        const existing = state.session.allegroCategory;
        return JSON.stringify({
          already_selected: { id: existing.id, name: existing.name, path: existing.path },
          stop: true,
          instruction: 'Kategoria już wybrana. NATYCHMIAST zakończ turę (end_turn). NIE wywołuj suggest_category ani żadnego innego toola. Czekaj na zmianę zakładki przez usera.',
        });
      }

      const title = (input.title as string) || state.session.data?.title || '';
      const attributes = (input.attributes as Record<string, string>) || state.session.data?.attributes || {};
      const { suggestions, usage } = await suggestCategory(title, attributes, apiKey, (msg) => {
        sseWrite({ type: 'tool_progress', name: 'suggest_category', message: msg });
      });

      logTokenUsage({ productId, sessionKey, toolName, model: CATEGORY_MODEL, usage });
      addUsage(state, CATEGORY_MODEL, usage);
      sseWrite({ type: 'token_usage', toolName, ...usage, ...calcCost(usage, CATEGORY_MODEL) });

      const top5 = suggestions.slice(0, 5).map(s => ({
        id: s.id,
        name: s.name,
        path: s.path,
        commission: s.commission,
      }));

      sseWrite({ type: 'category_suggestions_ready', suggestions: top5, awaiting: true });

      return JSON.stringify({
        suggestions: top5,
        awaiting_user_selection: true,
        instruction: 'STOP. Wait for user to pick category via UI. Do NOT call any other tool until session.allegroCategory.id is set.',
      });
    }

    case 'fetch_category_parameters': {
      const categoryId = input.categoryId as string;
      const { parameters, commissionInfo } = await fetchCategoryParameters(categoryId);

      state.allegroParams = parameters;
      state.session = { ...state.session, allegroCategory: { ...state.session.allegroCategory!, id: categoryId }, allegroParameters: parameters };
      sseWrite({ type: 'session_patch', patch: { allegroParameters: parameters, commissionInfo } });

      return JSON.stringify({
        total: parameters.length,
        required: parameters.filter(p => p.required).length,
        names: parameters.slice(0, 8).map(p => p.name),
      });
    }

    case 'fill_parameters': {
      if (!state.allegroParams.length) {
        return JSON.stringify({ error: 'Brak parametrów — najpierw pobierz kategorię (fetch_category_parameters)' });
      }

      // Guard: jeśli wszystkie wymagane parametry już są wypełnione, nie wołaj AI ponownie
      const missingRequiredCount = state.allegroParams
        .filter(p => p.required && !state.filledParameters[p.id]).length;
      if (missingRequiredCount === 0 && Object.keys(state.filledParameters).length > 0) {
        return JSON.stringify({
          filled: 0,
          totalFilled: Object.keys(state.filledParameters).length,
          allRequiredFilled: true,
          stop: true,
          instruction: 'Wszystkie wymagane parametry są już wypełnione. NIE wywołuj fill_parameters ponownie. Wywołaj validate_parameters żeby potwierdzić — albo zakończ turę.',
        });
      }

      const { systemPrompt, parameterIds } = buildAutoFillPrompt(
        state.session.data!,
        state.allegroParams,
        state.filledParameters,
        state.imagesMeta,
      );

      if (!systemPrompt || !parameterIds.length) {
        return JSON.stringify({
          filled: 0,
          unfilled: 0,
          message: 'Wszystkie parametry już wypełnione',
          stop: true,
          instruction: 'Nie ma więcej parametrów do uzupełnienia. NIE wywołuj fill_parameters ponownie. Zakończ turę.',
        });
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: AUTOFILL_MODEL,
          max_tokens: 4000,
          system: systemPrompt,
          messages: [{ role: 'user', content: 'Przeanalizuj dane produktu i dopasuj wartości do parametrów Allegro. Zwróć JSON z tablicą results.' }],
        }),
      });

      if (!response.ok) throw new Error(`Autofill API error: ${await response.text()}`);

      const data = await response.json();
      const usage: AnthropicUsage = data.usage ?? {};
      logTokenUsage({ productId, sessionKey, toolName, model: AUTOFILL_MODEL, usage });
      addUsage(state, AUTOFILL_MODEL, usage);
      sseWrite({ type: 'token_usage', toolName, ...usage, ...calcCost(usage, AUTOFILL_MODEL) });

      const rawText = data.content?.[0]?.text || '{}';
      let rawEntries: unknown[] = [];
      try {
        const parsed = parseClaudeJson(rawText);
        if (Array.isArray(parsed)) rawEntries = parsed;
        else for (const val of Object.values(parsed as object)) {
          if (Array.isArray(val) && val.length > 0) { rawEntries = val; break; }
        }
      } catch { /* continue with empty */ }

      const result = validateAutoFillResponse(rawEntries, state.allegroParams, state.session.data!);
      state.filledParameters = { ...state.filledParameters, ...result.filled };
      state.session = { ...state.session, filledParameters: state.filledParameters };
      sseWrite({ type: 'session_patch', patch: { filledParameters: state.filledParameters } });

      const totalFilled = Object.keys(state.filledParameters).length;
      const stillMissingRequired = state.allegroParams
        .filter(p => p.required && !state.filledParameters[p.id]);
      return JSON.stringify({
        newlyFilled: Object.keys(result.filled).length,
        totalFilled,
        totalParams: state.allegroParams.length,
        missingRequired: stillMissingRequired.length,
        missingRequiredNames: stillMissingRequired.slice(0, 5).map(p => p.name),
      });
    }

    case 'validate_parameters': {
      const missing = state.allegroParams
        .filter(p => p.required && !state.filledParameters[p.id])
        .map(p => ({ id: p.id, name: p.name, type: p.type }));
      return JSON.stringify({ missing, allFilled: missing.length === 0 });
    }

    case 'update_parameter': {
      const { parameterId, value } = input as { parameterId: string; value: string | string[] };
      state.filledParameters = { ...state.filledParameters, [parameterId]: value };
      state.session = { ...state.session, filledParameters: state.filledParameters };
      sseWrite({ type: 'action', action: { type: 'update_parameter', parameterId, parameterValue: value } as ChatAction });
      sseWrite({ type: 'session_patch', patch: { filledParameters: state.filledParameters } });
      const param = state.allegroParams.find(p => p.id === parameterId);
      return JSON.stringify({ updated: true, parameterName: param?.name ?? parameterId });
    }

    case 'generate_title': {
      const guard = imageGuard(state.imagesMeta);
      if (guard) return guard;
      const { title, candidates, usage } = await generateTitle(
        { ...state.session, filledParameters: state.filledParameters },
        state.imagesMeta,
        input.additionalContext as string | undefined,
        apiKey,
      );
      logTokenUsage({ productId, sessionKey, toolName, model: TITLE_MODEL, usage });
      addUsage(state, TITLE_MODEL, usage);
      state.generatedTitle = title;
      state.session = { ...state.session, generatedTitle: title, titleCandidates: candidates };
      sseWrite({ type: 'title_generated', title, candidates });
      sseWrite({ type: 'session_patch', patch: { generatedTitle: title, titleCandidates: candidates } });
      sseWrite({ type: 'token_usage', toolName, ...usage, ...calcCost(usage, TITLE_MODEL) });
      return JSON.stringify({ title, candidates, length: title.length });
    }

    case 'update_title': {
      const { title } = input as { title: string };
      state.generatedTitle = title;
      state.session = { ...state.session, generatedTitle: title };
      sseWrite({ type: 'action', action: { type: 'update_title', title } as ChatAction });
      sseWrite({ type: 'session_patch', patch: { generatedTitle: title } });
      return JSON.stringify({ updated: true, title });
    }

    case 'generate_description': {
      const guard = imageGuard(state.imagesMeta);
      if (guard) return guard;
      const { sections, fullHtml, inputHash, inputSnapshot, usage } = await generateDescription({
        session: { ...state.session, filledParameters: state.filledParameters, generatedTitle: state.generatedTitle || state.session.generatedTitle },
        imagesMeta: state.imagesMeta,
        style: input.style as 'technical' | 'lifestyle' | 'simple' | undefined,
        additionalContext: input.additionalContext as string | undefined,
      }, apiKey);

      logTokenUsage({ productId, sessionKey, toolName, model: DESCRIPTION_MODEL, usage });
      addUsage(state, DESCRIPTION_MODEL, usage);
      state.generatedSections = sections;
      sseWrite({ type: 'description_generated', sections, fullHtml, inputHash, inputSnapshot });
      sseWrite({ type: 'token_usage', toolName, ...usage, ...calcCost(usage, DESCRIPTION_MODEL) });
      return JSON.stringify({ sections: sections.length, inputHash });
    }

    case 'update_section': {
      const { sectionId, heading, bodyHtml, layout } = input as Record<string, string>;
      sseWrite({ type: 'action', action: { type: 'update_section', sectionId, heading, bodyHtml, layout } as ChatAction });
      return JSON.stringify({ updated: true, sectionId });
    }

    case 'add_section': {
      const { heading, bodyHtml, layout, afterSectionId } = input as Record<string, string>;
      const newId = `section-${randomUUID().slice(0, 8)}`;
      sseWrite({ type: 'action', action: { type: 'add_section', sectionId: newId, heading, bodyHtml, layout, afterSectionId } as ChatAction });
      return JSON.stringify({ added: true, sectionId: newId });
    }

    case 'remove_section': {
      const { sectionId } = input as { sectionId: string };
      sseWrite({ type: 'action', action: { type: 'remove_section', sectionId } as ChatAction });
      return JSON.stringify({ removed: true, sectionId });
    }

    case 'expand_section': {
      const { sectionId, heading, bodyHtml } = input as { sectionId: string; heading?: string; bodyHtml: string };
      sseWrite({ type: 'action', action: { type: 'expand_section', sectionId, heading, bodyHtml } as ChatAction });
      return JSON.stringify({ expanded: true, sectionId });
    }

    case 'reorder_sections': {
      const { sectionIds } = input as { sectionIds: string[] };
      if (!Array.isArray(sectionIds) || sectionIds.length === 0) {
        return JSON.stringify({ error: 'sectionIds jest wymagane i nie może być puste' });
      }
      sseWrite({ type: 'action', action: { type: 'reorder_sections', sectionIds } as ChatAction });
      return JSON.stringify({ reordered: true, count: sectionIds.length });
    }

    case 'change_section_layout': {
      const { sectionId, layout } = input as { sectionId: string; layout: 'image-text' | 'text-only' | 'images-only' };
      sseWrite({ type: 'action', action: { type: 'change_section_layout', sectionId, layout } as ChatAction });
      return JSON.stringify({ updated: true, sectionId, layout });
    }

    case 'reorder_section_images': {
      const { sectionId, imageUrls } = input as { sectionId: string; imageUrls: string[] };
      sseWrite({ type: 'action', action: { type: 'reorder_section_images', sectionId, imageUrls } as ChatAction });
      return JSON.stringify({ reordered: true, sectionId, count: imageUrls.length });
    }

    case 'add_image_to_section': {
      const { sectionId, imageUrl } = input as { sectionId: string; imageUrl: string };
      sseWrite({ type: 'action', action: { type: 'add_image_to_section', sectionId, imageUrl } as ChatAction });
      return JSON.stringify({ added: true, sectionId });
    }

    case 'remove_image_from_section': {
      const { sectionId, imageUrl } = input as { sectionId: string; imageUrl: string };
      sseWrite({ type: 'action', action: { type: 'remove_image_from_section', sectionId, imageUrl } as ChatAction });
      return JSON.stringify({ removed: true, sectionId });
    }

    case 'regenerate_description':
    case 'change_description_style': {
      const guard = imageGuard(state.imagesMeta);
      if (guard) return guard;
      const style = (input.style as 'technical' | 'lifestyle' | 'simple' | undefined);
      const additionalContext = input.additionalContext as string | undefined;
      const { sections, fullHtml, inputHash, inputSnapshot, usage } = await generateDescription({
        session: { ...state.session, filledParameters: state.filledParameters, generatedTitle: state.generatedTitle || state.session.generatedTitle },
        imagesMeta: state.imagesMeta,
        style,
        additionalContext,
      }, apiKey);

      logTokenUsage({ productId, sessionKey, toolName, model: DESCRIPTION_MODEL, usage });
      addUsage(state, DESCRIPTION_MODEL, usage);
      state.generatedSections = sections;
      sseWrite({ type: 'description_generated', sections, fullHtml, inputHash, inputSnapshot });
      sseWrite({ type: 'token_usage', toolName, ...usage, ...calcCost(usage, DESCRIPTION_MODEL) });
      if (toolName === 'change_description_style' && style) {
        sseWrite({ type: 'action', action: { type: 'change_description_style', styleValue: style } as ChatAction });
      }
      return JSON.stringify({ regenerated: true, sections: sections.length, style: style ?? 'default' });
    }

    case 'regenerate_title': {
      const { title, candidates, usage } = await generateTitle(
        { ...state.session, filledParameters: state.filledParameters },
        state.imagesMeta,
        input.additionalContext as string | undefined,
        apiKey,
      );
      logTokenUsage({ productId, sessionKey, toolName, model: TITLE_MODEL, usage });
      addUsage(state, TITLE_MODEL, usage);
      state.generatedTitle = title;
      state.session = { ...state.session, generatedTitle: title, titleCandidates: candidates };
      sseWrite({ type: 'title_generated', title, candidates });
      sseWrite({ type: 'session_patch', patch: { generatedTitle: title, titleCandidates: candidates } });
      sseWrite({ type: 'token_usage', toolName, ...usage, ...calcCost(usage, TITLE_MODEL) });
      return JSON.stringify({ regenerated: true, title, candidates: candidates.length });
    }

    case 'scrape_and_fill_from_url': {
      const url = input.url as string;
      if (!url) return JSON.stringify({ error: 'Brak URL' });
      sseWrite({ type: 'action', action: { type: 'request_scrape', scrapeUrl: url } as ChatAction });
      return JSON.stringify({ requested: true, url, note: 'Frontend pobierze stronę i auto-uzupełni parametry. Poczekaj na potwierdzenie w kolejnej wiadomości usera.' });
    }

    case 'ask_user': {
      const question = input.question as string;
      const options = (input.options as string[] | undefined) ?? [];
      sseWrite({ type: 'action', action: { type: 'ask_user', question, options } as ChatAction });
      // Agent should end turn after asking — return marker
      return JSON.stringify({ asked: true, question, awaiting_user_response: true, instruction: 'STOP. Zakończ turę i czekaj na odpowiedź usera.' });
    }

    case 'update_price': {
      const { price, currency } = input as { price: string; currency?: string };
      state.session = {
        ...state.session,
        data: { ...state.session.data, price, currency: currency ?? state.session.data?.currency },
      };
      sseWrite({ type: 'action', action: { type: 'update_price', priceValue: price, currencyValue: currency } as ChatAction });
      sseWrite({ type: 'session_patch', patch: { data: state.session.data } });
      return JSON.stringify({ updated: true, price, currency: currency ?? null });
    }

    case 'update_tax_rate': {
      const { taxRate } = input as { taxRate: number | string };
      state.session = { ...state.session, tax_rate: taxRate };
      sseWrite({ type: 'action', action: { type: 'update_tax_rate', taxRateValue: taxRate } as ChatAction });
      sseWrite({ type: 'session_patch', patch: { tax_rate: taxRate } });
      return JSON.stringify({ updated: true, taxRate });
    }

    case 'update_sku': {
      const { sku } = input as { sku: string };
      state.session = {
        ...state.session,
        data: { ...state.session.data, sku },
      };
      sseWrite({ type: 'action', action: { type: 'update_sku', skuValue: sku } as ChatAction });
      sseWrite({ type: 'session_patch', patch: { data: state.session.data } });
      return JSON.stringify({ updated: true, sku });
    }

    case 'update_ean': {
      const { ean } = input as { ean: string };
      state.session = {
        ...state.session,
        data: { ...state.session.data, ean },
      };
      sseWrite({ type: 'action', action: { type: 'update_ean', eanValue: ean } as ChatAction });
      sseWrite({ type: 'session_patch', patch: { data: state.session.data } });
      return JSON.stringify({ updated: true, ean });
    }

    case 'update_inventory': {
      const { inventoryId, warehouseId } = input as { inventoryId?: number; warehouseId?: string };
      const patch: Partial<ProductSession> = {};
      if (inventoryId !== undefined) {
        state.session = { ...state.session, inventoryId };
        patch.inventoryId = inventoryId;
      }
      if (warehouseId !== undefined) {
        state.session = { ...state.session, defaultWarehouse: warehouseId };
        patch.defaultWarehouse = warehouseId;
      }
      sseWrite({ type: 'action', action: { type: 'update_inventory', inventoryId, warehouseId } as ChatAction });
      if (Object.keys(patch).length) sseWrite({ type: 'session_patch', patch });
      return JSON.stringify({ updated: true, inventoryId, warehouseId });
    }

    case 'reorder_product_images': {
      const { imageUrls } = input as { imageUrls: string[] };
      if (!Array.isArray(imageUrls) || !imageUrls.length) {
        return JSON.stringify({ error: 'imageUrls wymagane' });
      }
      sseWrite({ type: 'action', action: { type: 'reorder_product_images', imageUrls } as ChatAction });
      return JSON.stringify({ reordered: true, count: imageUrls.length });
    }

    case 'add_product_image': {
      const { imageUrl } = input as { imageUrl: string };
      sseWrite({ type: 'action', action: { type: 'add_product_image', imageUrl } as ChatAction });
      return JSON.stringify({ added: true, imageUrl });
    }

    case 'remove_product_image': {
      const { imageUrl } = input as { imageUrl: string };
      sseWrite({ type: 'action', action: { type: 'remove_product_image', imageUrl } as ChatAction });
      return JSON.stringify({ removed: true, imageUrl });
    }

    default:
      return JSON.stringify({ error: `Nieznane narzędzie: ${toolName}` });
  }
}

// ─── Main handler ───

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) {
    return new Response('ANTHROPIC_API_KEY not set', { status: 500 });
  }

  const body: AgentRequest = await req.json();
  const { message, mode, conversationHistory, session, imagesMeta, productId, currentStep } = body;
  const sessionKey = body.sessionKey ?? randomUUID();

  const anthropic = new Anthropic({ apiKey });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function sseWrite(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        // Rozgrzej cache kursu USD/PLN — calcCost() jest synchroniczny i czyta cache
        await getUsdToPln();

        const state: AgentState = {
          session: { ...session },
          imagesMeta: imagesMeta ?? [],
          allegroParams: session.allegroParameters ?? [],
          filledParameters: session.filledParameters ?? {},
          generatedSections: [],
          generatedTitle: session.generatedTitle ?? '',
          usageByModel: {},
        };

        // Build initial user message — context-aware start zamiast generic "od początku"
        const categoryAlreadyPicked = !!session.allegroCategory?.id;
        const paramsAlreadyFilled = Object.keys(session.filledParameters ?? {}).length > 0;
        const titleAlreadyDone = !!session.generatedTitle;
        const descriptionAlreadyDone = !!session.generatedDescription;

        const startMessage = ((): string => {
          if (!currentStep || currentStep === 'inventory') {
            return 'User otworzył produkt na zakładce Magazyn. Powiedz krótkim zdaniem żeby przeszedł na zakładkę Kategoria. Zakończ turę.';
          }
          if (currentStep === 'category' && categoryAlreadyPicked) {
            return `Kategoria Allegro już wybrana: "${session.allegroCategory?.path ?? session.allegroCategory?.name}". NIE wywołuj suggest_category. Powiedz krótkim zdaniem że kategoria jest, można przejść na zakładkę Zdjęcia. Zakończ turę.`;
          }
          if (currentStep === 'fields-params' && paramsAlreadyFilled) {
            return `Parametry już są częściowo wypełnione (${Object.keys(session.filledParameters ?? {}).length} pól). Wywołaj validate_parameters żeby sprawdzić czy wszystko ok; jeśli brakuje wymaganych — zadaj pytanie. Inaczej zakończ turę.`;
          }
          if (currentStep === 'preview' && titleAlreadyDone && descriptionAlreadyDone) {
            return 'Tytuł i opis już wygenerowane. Czekaj na komendy edycji od usera, nie wywołuj nic samodzielnie. Zakończ turę.';
          }
          return `User otworzył produkt — aktywna zakładka: ${STEP_LABELS[currentStep]}. Wykonaj odpowiednie akcje używając dostępnych narzędzi.`;
        })();

        const messages: Anthropic.MessageParam[] = [
          ...conversationHistory.slice(-20).map(m => ({ role: m.role, content: m.content })),
          {
            role: 'user' as const,
            content: mode === 'start' ? startMessage : message,
          },
        ];

        let iterations = 0;
        // F: dedupe per-turę — Set widzianych "toolName:JSON.stringify(input)".
        // Powtórne identyczne wywołanie zwracamy z error+stop, żeby ubić pętle.
        const seenToolCalls = new Set<string>();
        // I+J: counter błędów GATE — agent po 2× powinien zakończyć turę.
        let gateErrorCount = 0;

        while (iterations < MAX_ITERATIONS) {
          iterations++;

          // Client-side tool filtering — wysyłamy tylko narzędzia dozwolone na aktualnej zakładce.
          // Mniej toolów = lepsza decyzja modelu, brak halucynacji o narzędziach z innych zakładek.
          const allowedNames = currentStep ? TAB_ALLOWED_TOOLS[currentStep] : null;
          const filteredTools = allowedNames
            ? TOOLS.filter(t => allowedNames.has(t.name))
            : TOOLS;

          // tool_choice enforcement — gdy zakładka ma 1 tool wymuś go,
          // gdy ma >1 i to jest start workflow wymuś dowolny z dostępnych.
          // ALE: NIE wymuszaj gdy stan wskazuje że nic do zrobienia (already_done)
          // — inaczej wpadamy w pętlę "tool zwraca already_selected → tool_choice znowu wymusza".
          const skipToolChoice =
            (currentStep === 'category' && categoryAlreadyPicked) ||
            (currentStep === 'preview' && titleAlreadyDone && descriptionAlreadyDone);

          let toolChoice: { type: 'any' } | { type: 'tool'; name: string } | undefined;
          if (!skipToolChoice) {
            if (filteredTools.length === 1) {
              toolChoice = { type: 'tool', name: filteredTools[0].name };
            } else if (filteredTools.length > 1 && mode === 'start') {
              toolChoice = { type: 'any' };
            }
          }

          // Dynamic state block — zmienia się każdą iterację, NIE wysyłamy go w cache'owanym systemie.
          // Idzie jako ostatnia user message (świeży snapshot stanu).
          const stateBlock = buildStateBlock(state, currentStep);
          const messagesWithState: Anthropic.MessageParam[] = [
            ...messages,
            { role: 'user' as const, content: stateBlock },
          ];

          const agentStream = anthropic.messages.stream(
            {
              model: AGENT_MODEL,
              max_tokens: 4096,
              system: [{ type: 'text', text: STATIC_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }] as Anthropic.TextBlockParam[],
              tools: filteredTools,
              ...(toolChoice ? { tool_choice: toolChoice } : {}),
              messages: messagesWithState,
            } as Parameters<typeof anthropic.messages.stream>[0],
            {
              headers: { 'anthropic-beta': 'prompt-caching-2024-07-31' },
            },
          );

          // Stream text deltas
          agentStream.on('text', (text) => {
            sseWrite({ type: 'message_delta', text });
          });

          const finalMsg = await agentStream.finalMessage();
          const iterUsage: AnthropicUsage = {
            input_tokens: finalMsg.usage.input_tokens,
            output_tokens: finalMsg.usage.output_tokens,
            cache_creation_input_tokens: (finalMsg.usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens,
            cache_read_input_tokens: (finalMsg.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens,
          };
          addUsage(state, AGENT_MODEL, iterUsage);

          if (finalMsg.stop_reason === 'end_turn') {
            break;
          }

          if (finalMsg.stop_reason === 'tool_use') {
            const toolUses = finalMsg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
            const toolResults: Anthropic.ToolResultBlockParam[] = [];

            for (const tool of toolUses) {
              sseWrite({ type: 'tool_start', name: tool.name, label: TOOL_LABELS[tool.name] ?? tool.name });

              let resultContent: string;
              let success = true;

              // F: dedupe — gdy agent próbuje powtórzyć identyczne wywołanie, blokujemy.
              const callKey = `${tool.name}:${JSON.stringify(tool.input ?? {})}`;
              if (seenToolCalls.has(callKey)) {
                resultContent = JSON.stringify({
                  error: `DUPLICATE_CALL: ${tool.name} z identycznymi parametrami było już wywołane w tej turze. NIE wywołuj go ponownie. Zakończ turę (end_turn).`,
                  stop: true,
                });
                success = false;
              } else {
                seenToolCalls.add(callKey);
                try {
                  resultContent = await executeTool(
                    tool.name,
                    tool.input as Record<string, unknown>,
                    state,
                    sseWrite,
                    productId,
                    sessionKey,
                    apiKey,
                    currentStep,
                  );
                } catch (err) {
                  resultContent = JSON.stringify({ error: String(err) });
                  success = false;
                }
              }

              // I+J: jeśli wynik zawiera GATE/TAB_GATE error, licznik. Po 2× wymuszamy end_turn.
              if (resultContent.includes('TAB_GATE') || resultContent.includes('"GATE:') || resultContent.startsWith('{"error":"GATE')) {
                gateErrorCount++;
                if (gateErrorCount >= 2) {
                  resultContent = JSON.stringify({
                    error: 'GATE_LOOP: Próbujesz wywołać zakazane narzędzie po raz drugi. ZAKOŃCZ TURĘ. Powiedz userowi krótkim zdaniem co powinien zrobić.',
                    stop: true,
                  });
                }
              }

              let parsedResult: Record<string, unknown> = {};
              try { parsedResult = JSON.parse(resultContent); } catch { /* ignore */ }

              sseWrite({
                type: 'tool_result',
                name: tool.name,
                success,
                summary: parsedResult.error
                  ? String(parsedResult.error)
                  : resultContent.length > 120 ? resultContent.slice(0, 120) + '…' : resultContent,
              });

              toolResults.push({
                type: 'tool_result',
                tool_use_id: tool.id,
                content: resultContent,
              });
            }

            messages.push({ role: 'assistant', content: finalMsg.content });
            messages.push({ role: 'user', content: toolResults });
          }
        }

        // Send final cost summary — cost per model, then summed
        const totalCost = Object.entries(state.usageByModel).reduce(
          (acc, [model, usage]) => {
            const c = calcCost(usage, model);
            return { usd: acc.usd + c.usd, pln: acc.pln + c.pln };
          },
          { usd: 0, pln: 0 },
        );
        const totalUsage = sumUsage(Object.values(state.usageByModel));
        sseWrite({
          type: 'total_cost',
          input_tokens: totalUsage.input_tokens,
          output_tokens: totalUsage.output_tokens,
          usd: totalCost.usd,
          pln: totalCost.pln,
          byModel: Object.fromEntries(
            Object.entries(state.usageByModel).map(([m, u]) => [m, { ...u, ...calcCost(u, m) }]),
          ),
        });
        sseWrite({ type: 'done' });

      } catch (err) {
        console.error('[agent/workflow] error:', err);
        sseWrite({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
