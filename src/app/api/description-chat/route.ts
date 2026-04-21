import { NextResponse } from 'next/server';
import type { DescriptionSection, AllegroParameter, ImageMeta, ChatAction } from '@/lib/types';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const CLAUDE_MODEL = 'claude-opus-4-6';

interface DescriptionChatRequest {
  message: string;
  currentTitle: string;
  sections: DescriptionSection[];
  currentParameters: Record<string, string | string[]>;
  imagesMeta: ImageMeta[];
  allegroParameters?: AllegroParameter[];
  conversationHistory?: Array<{ role: string; content: string }>;
  stanTechniczny?: string;
  uwagi?: string;
  // Pełny kontekst produktu
  originalDescription?: string;
  price?: string;
  currency?: string;
  ean?: string;
  sku?: string;
  productUrl?: string;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildSystemPrompt(body: DescriptionChatRequest): string {
  const filledIds = new Set(Object.keys(body.currentParameters || {}));
  const allParams = body.allegroParameters || [];

  const paramsList = Object.entries(body.currentParameters || {})
    .map(([id, val]) => {
      const paramDef = allParams.find(p => p.id === id);
      const name = paramDef?.name || id;
      return `- [${id}] ${name}: ${Array.isArray(val) ? val.join(', ') : val}`;
    })
    .join('\n');

  // Brakujące parametry z dozwolonymi wartościami
  const unfilledParams = allParams.filter(p => !filledIds.has(p.id));
  const unfilledRequired = unfilledParams.filter(p => p.required);
  const unfilledOptional = unfilledParams.filter(p => !p.required);

  let unfilledSection = '';
  if (unfilledRequired.length > 0 || unfilledOptional.length > 0) {
    const formatParam = (p: AllegroParameter) => {
      const opts = p.options ?? p.restrictions?.allowedValues ?? [];
      let line = `- [${p.id}] ${p.name} (${p.type}${p.unit ? ', ' + p.unit : ''})`;
      if (opts.length > 0) {
        const displayOpts = opts.slice(0, 20);
        line += ` — dozwolone: ${displayOpts.map(o => `"${o.value}" (ID: ${o.id})`).join(', ')}`;
        if (opts.length > 20) line += `, ... (${opts.length - 20} więcej)`;
      }
      return line;
    };

    if (unfilledRequired.length > 0) {
      unfilledSection += `\n## BRAKUJĄCE WYMAGANE PARAMETRY\n${unfilledRequired.map(formatParam).join('\n')}`;
    }
    if (unfilledOptional.length > 0) {
      unfilledSection += `\n## BRAKUJĄCE OPCJONALNE PARAMETRY\n${unfilledOptional.map(formatParam).join('\n')}`;
    }
  }

  // Sekcje opisu z indeksami i podglądem treści
  const sectionsList = body.sections
    .map((s, i) => {
      const preview = stripHtml(s.bodyHtml || '').slice(0, 300);
      return `Indeks ${i}: [${s.id}] layout: ${s.layout}, heading: "${s.heading}", zdjęcia: [${s.imageUrls.join(', ')}]\nTreść: ${preview || '(pusta)'}`;
    })
    .join('\n\n');

  // Mapa zdjęć — które są wolne, które gdzie przypisane
  const usedUrlsMap = new Map<string, string[]>();
  for (const s of body.sections) {
    for (const url of s.imageUrls) {
      if (!usedUrlsMap.has(url)) usedUrlsMap.set(url, []);
      usedUrlsMap.get(url)!.push(s.id);
    }
  }

  const allImages = (body.imagesMeta || []).filter(i => !i.removed);
  const availableImages = allImages
    .filter(i => !usedUrlsMap.has(i.url))
    .map(i => `- [${i.url}] "${i.aiDescription || i.userDescription || 'brak opisu'}"`)
    .join('\n');

  const allImagesList = allImages
    .map(i => {
      const sections = usedUrlsMap.get(i.url);
      const usage = sections ? `użyte w: ${sections.join(', ')}` : 'wolne';
      return `- [${i.url}] "${i.aiDescription || i.userDescription || 'brak opisu'}" — ${usage}`;
    })
    .join('\n');

  const stanSection = (body.stanTechniczny || body.uwagi)
    ? `\n## STAN TECHNICZNY PRODUKTU\nStan: ${body.stanTechniczny || 'brak danych'}${body.uwagi ? `\nUwagi: ${body.uwagi}` : ''}\n`
    : '';

  const productDataSection = [
    body.price ? `Cena: ${body.price}${body.currency ? ' ' + body.currency : ''}` : '',
    body.ean ? `EAN: ${body.ean}` : '',
    body.sku ? `SKU: ${body.sku}` : '',
    body.productUrl ? `URL źródłowy: ${body.productUrl}` : '',
  ].filter(Boolean).join('\n');

  const originalDescSection = body.originalDescription?.trim()
    ? `\n## ORYGINALNY OPIS PRODUKTU (ze źródła)\n${body.originalDescription.slice(0, 3000)}\n`
    : '';

  return `WAŻNE: Twoja odpowiedź to WYŁĄCZNIE obiekt JSON. Absolutnie żadnego tekstu poza JSON. Zacznij od "{" i zakończ na "}".

Jesteś asystentem do edycji ofert e-commerce na Allegro.
Pomagasz modyfikować tytuł, opis i parametry produktu.
Interpretujesz polecenia użytkownika i tłumaczysz je na konkretne akcje.
${stanSection}${originalDescSection}
## DANE IDENTYFIKACYJNE PRODUKTU
${productDataSection || '(brak danych)'}

## AKTUALNY TYTUŁ
${body.currentTitle}

## SEKCJE OPISU (w kolejności)
${sectionsList || '(brak sekcji)'}

## DOSTĘPNE ZDJĘCIA (nie przypisane do żadnej sekcji)
${availableImages || '(brak wolnych zdjęć)'}

## WSZYSTKIE ZDJĘCIA W GALERII
${allImagesList || '(brak zdjęć)'}

## UZUPEŁNIONE PARAMETRY ALLEGRO
${paramsList || '(brak parametrów)'}
${unfilledSection}

## TWOJE MOŻLIWOŚCI
Możesz wykonywać następujące akcje (zwracasz je w tablicy "actions").
Możesz zwrócić WIELE akcji w jednej odpowiedzi.

### Tytuł
1. **update_title** - zmiana tytułu
   { "type": "update_title", "title": "NOWY TYTUŁ" }

### Parametry
2. **update_parameter** - zmiana wartości parametru. Dla parametrów dictionary MUSISZ użyć ID opcji, nie nazwy.
   { "type": "update_parameter", "parameterId": "id_parametru", "parameterValue": "id_opcji_lub_wartość" }

### Edycja sekcji opisu
3. **update_section** - modyfikacja treści i/lub nagłówka sekcji
   { "type": "update_section", "sectionId": "...", "heading": "nowy nagłówek", "bodyHtml": "nowa treść HTML" }

4. **expand_section** - rozszerzenie/wzbogacenie treści sekcji (dokłada do istniejącej)
   { "type": "expand_section", "sectionId": "...", "bodyHtml": "rozszerzona treść" }

### Zarządzanie sekcjami
5. **add_section** - dodanie nowej sekcji opisu
   { "type": "add_section", "heading": "Nagłówek", "bodyHtml": "treść HTML", "layout": "image-text", "imageUrls": ["url1"], "afterSectionId": "section-id" }
   - layout: "image-text" (tekst + zdjęcie) lub "images-only" (tylko zdjęcia)
   - afterSectionId: opcjonalne — ID sekcji po której wstawić nową. Bez tego dodaje na końcu.
   - imageUrls: opcjonalne — zdjęcia z galerii do przypisania

6. **remove_section** - usunięcie sekcji z opisu
   { "type": "remove_section", "sectionId": "..." }

7. **change_section_layout** - zmiana layoutu sekcji
   { "type": "change_section_layout", "sectionId": "...", "layout": "images-only" }

8. **reorder_sections** - zmiana kolejności sekcji (podaj PEŁNĄ listę ID w nowej kolejności)
   { "type": "reorder_sections", "sectionIds": ["section-2", "section-0", "section-1"] }

### Zdjęcia w sekcjach
9. **add_image_to_section** - dodanie zdjęcia z galerii do sekcji
   { "type": "add_image_to_section", "sectionId": "...", "imageUrl": "url_zdjęcia" }
   WAŻNE: możesz dodawać TYLKO zdjęcia które istnieją w galerii (lista powyżej)

10. **remove_image_from_section** - usunięcie zdjęcia z sekcji (zdjęcie zostaje w galerii)
    { "type": "remove_image_from_section", "sectionId": "...", "imageUrl": "url_zdjęcia" }

11. **reorder_section_images** - zmiana kolejności zdjęć w sekcji
    { "type": "reorder_section_images", "sectionId": "...", "imageUrls": ["url1", "url2"] }

### Inne
12. **regenerate_description** - pełna regeneracja opisu od nowa
    { "type": "regenerate_description" }

13. **request_scrape** - gdy użytkownik podaje URL do zescrapowania
    { "type": "request_scrape", "scrapeUrl": "https://..." }

14. **clear_targets** - wyczyść zaznaczenie sekcji w UI (używaj gdy ignorujesz zaznaczenie)
    { "type": "clear_targets" }

## ZAZNACZONE SEKCJE
Gdy wiadomość użytkownika zawiera prefix [Dotyczy: X, Y], oznacza to że użytkownik zaznaczył te sekcje w UI.

ZASADY obsługi zaznaczenia:
1. Jeśli treść wiadomości pasuje do zaznaczonych sekcji → wykonaj zmiany na zaznaczonych
2. Jeśli treść WYRAŹNIE odnosi się do innej sekcji (np. wspomina ją po nazwie) → zignoruj zaznaczenie, wykonaj na właściwej sekcji, w "message" napisz: "Zignorowałem zaznaczenie [X] — Twoja wiadomość dotyczyła sekcji [Y]." i dodaj akcję { "type": "clear_targets" }
3. Jeśli treść jest ogólna (np. "popraw styl") i są zaznaczone sekcje → zastosuj TYLKO do zaznaczonych
4. Jeśli treść jest ogólna i NIE MA zaznaczonych sekcji → zastosuj do WSZYSTKICH sekcji

## CZEGO NIE MOŻESZ ZROBIĆ
Jeśli użytkownik poprosi o coś z poniższej listy, grzecznie poinformuj go i zasugeruj co MOŻESZ zrobić:
- Dodawanie/usuwanie zdjęć z głównej galerii (możesz tylko przenosić zdjęcia między sekcjami opisu)
- Zmiana ceny lub stanów magazynowych
- Zmiana kategorii Allegro
- Tworzenie/edycja produktów w BaseLinker
- Generowanie nowych zdjęć

Przykład: "Nie mogę dodać nowego zdjęcia do galerii, ale mogę przenieść istniejące zdjęcie z galerii do wybranej sekcji opisu. Chcesz?"

## ZASADY
- Pisz wyłącznie po polsku
- Tytuły WIELKIMI LITERAMI, max 75 znaków
- Nie używaj emoji
- Gdy zmieniasz parametr, zmień też odpowiednie fragmenty w opisie
- Odpowiadaj krótko w polu "message"
- Gdy użytkownik podaje wartość brakującego parametru, dopasuj ją do dozwolonej opcji i użyj update_parameter z prawidłowym ID
- Gdy użytkownik pisze "pomiń", "nie chcę" itp. — po prostu poinformuj, że pomijasz ten parametr
- Gdy użytkownik wkleja URL (https://...) — użyj request_scrape żeby pobrać dane ze strony
- Możesz zwracać WIELE akcji naraz — np. zamiana sekcji + dodanie zdjęcia w jednym kroku
- Gdy nie rozumiesz co użytkownik chce — zapytaj, nie zgaduj

## WYBÓR AKCJI: update_section vs expand_section
- Użytkownik mówi "dopisz", "dodaj", "uzupełnij", "wstaw", "dodaj zdanie", "wstaw informację" → ZAWSZE użyj expand_section (dokłada do istniejącej treści, NIE nadpisuje)
- Użytkownik mówi "zmień", "przepisz", "zastąp", "popraw całość", "przepisz sekcję" → użyj update_section
- NIGDY nie używaj update_section gdy użytkownik chce tylko coś dopisać — straciłbyś istniejącą treść

Zwróć JSON:
{
  "message": "krótki opis co zrobiłeś",
  "actions": [ ... ]
}`;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as DescriptionChatRequest;

    if (!body.message?.trim()) {
      return NextResponse.json({ error: 'Brak wiadomości' }, { status: 400 });
    }

    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY nie jest ustawiony' }, { status: 500 });
    }

    const systemPrompt = buildSystemPrompt(body);

    // Build conversation messages with history (Claude format)
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    if (body.conversationHistory?.length) {
      const recentHistory = body.conversationHistory.slice(-10);
      for (const msg of recentHistory) {
        messages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
      }
    }

    messages.push({ role: 'user', content: body.message });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 3000,
        system: systemPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Claude API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    const rawContent = data.content?.[0]?.text ?? '{}';
    const cleaned = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    let parsed: { message?: string; actions?: ChatAction[] };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Try extracting JSON object from response
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          parsed = { message: cleaned, actions: [] };
        }
      } else {
        parsed = { message: cleaned, actions: [] };
      }
    }

    const rawActions: ChatAction[] = Array.isArray(parsed.actions) ? parsed.actions : [];

    // Validate action IDs against provided context to prevent hallucinated IDs
    const sectionIds = new Set((body.sections ?? []).map((s: DescriptionSection) => s.id));
    const paramIds = new Set((body.allegroParameters ?? []).map((p: AllegroParameter) => p.id));
    const actions = rawActions.filter(a => {
      if ('sectionId' in a && a.sectionId && !sectionIds.has(a.sectionId)) {
        console.warn('[description-chat] Dropping action with unknown sectionId:', a.sectionId);
        return false;
      }
      if ('parameterId' in a && a.parameterId && !paramIds.has(a.parameterId)) {
        console.warn('[description-chat] Dropping action with unknown parameterId:', a.parameterId);
        return false;
      }
      return true;
    });

    return NextResponse.json({
      message: parsed.message || 'Wykonano.',
      actions,
    });
  } catch (err) {
    console.error('Description chat failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Błąd czatu' },
      { status: 500 },
    );
  }
}
