import { NextResponse } from 'next/server';
import type { DescriptionSection, AllegroParameter, ImageMeta, ChatAction } from '@/lib/types';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

interface DescriptionChatRequest {
  message: string;
  currentTitle: string;
  sections: DescriptionSection[];
  currentParameters: Record<string, string | string[]>;
  imagesMeta: ImageMeta[];
  allegroParameters?: AllegroParameter[];
  conversationHistory?: Array<{ role: string; content: string }>;
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

  const sectionsList = body.sections
    .map(s => `- [${s.id}] ${s.layout}: "${s.heading}" (zdjęcia: ${s.imageUrls.length})`)
    .join('\n');

  return `Jesteś asystentem do edycji ofert e-commerce na Allegro.
Pomagasz modyfikować tytuł, opis i parametry produktu.

## AKTUALNY TYTUŁ
${body.currentTitle}

## SEKCJE OPISU
${sectionsList || '(brak sekcji)'}

## UZUPEŁNIONE PARAMETRY ALLEGRO
${paramsList || '(brak parametrów)'}
${unfilledSection}

## TWOJE MOŻLIWOŚCI
Możesz wykonywać następujące akcje (zwracasz je w tablicy "actions"):

1. **update_title** - zmiana tytułu
   { "type": "update_title", "title": "NOWY TYTUŁ" }

2. **update_parameter** - zmiana wartości parametru. Dla parametrów dictionary MUSISZ użyć ID opcji, nie nazwy.
   { "type": "update_parameter", "parameterId": "id_parametru", "parameterValue": "id_opcji_lub_wartość" }

3. **update_section** - modyfikacja konkretnej sekcji opisu
   { "type": "update_section", "sectionId": "section-0", "heading": "nowy nagłówek", "bodyHtml": "nowa treść" }

4. **expand_section** - rozszerzenie/wzbogacenie treści sekcji
   { "type": "expand_section", "sectionId": "section-2", "bodyHtml": "rozszerzona treść" }

5. **regenerate_description** - gdy potrzebna pełna regeneracja opisu
   { "type": "regenerate_description" }

6. **request_scrape** - gdy użytkownik podaje URL do zescrapowania w celu pobrania danych
   { "type": "request_scrape", "scrapeUrl": "https://..." }

## ZASADY
- Pisz wyłącznie po polsku
- Tytuły WIELKIMI LITERAMI, max 75 znaków
- Nie używaj emoji
- Gdy zmieniasz parametr, zmień też odpowiednie fragmenty w opisie
- Odpowiadaj krótko w polu "message"
- Gdy użytkownik podaje wartość brakującego parametru, dopasuj ją do dozwolonej opcji i użyj update_parameter z prawidłowym ID
- Gdy użytkownik pisze "pomiń", "nie chcę" itp. — po prostu poinformuj, że pomijasz ten parametr
- Gdy użytkownik wkleja URL (https://...) — użyj request_scrape żeby pobrać dane ze strony

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

    if (!OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OPENAI_API_KEY nie jest ustawiony' }, { status: 500 });
    }

    const systemPrompt = buildSystemPrompt(body);

    // Build conversation messages with history
    const conversationMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    if (body.conversationHistory?.length) {
      // Include recent history (last 10 messages to avoid token overflow)
      const recentHistory = body.conversationHistory.slice(-10);
      for (const msg of recentHistory) {
        conversationMessages.push({ role: msg.role, content: msg.content });
      }
    }

    conversationMessages.push({ role: 'user', content: body.message });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: conversationMessages,
        response_format: { type: 'json_object' },
        max_tokens: 3000,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`LLM API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);

    const actions: ChatAction[] = Array.isArray(parsed.actions) ? parsed.actions : [];

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
