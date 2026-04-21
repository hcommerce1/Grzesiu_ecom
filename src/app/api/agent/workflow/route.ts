import Anthropic from '@anthropic-ai/sdk';
import { NextRequest } from 'next/server';
import type { ProductSession, AllegroParameter, ImageMeta, DescriptionSection, ChatAction } from '@/lib/types';
import { analyzeImages } from '@/lib/image-analyzer';
import { suggestCategory } from '@/lib/category-suggester';
import { fetchCategoryParameters } from '@/lib/allegro-params';
import { buildAutoFillPrompt, validateAutoFillResponse } from '@/lib/ai-autofill';
import { generateDescription } from '@/lib/description-generator';
import { generateTitle } from '@/lib/title-generator';
import { logTokenUsage } from '@/lib/token-logger';
import { calcCost, sumUsage } from '@/lib/token-cost';
import type { AnthropicUsage } from '@/lib/token-cost';
import { randomUUID } from 'crypto';

const AGENT_MODEL = 'claude-opus-4-6';
const AUTOFILL_MODEL = process.env.AUTOFILL_MODEL || 'claude-opus-4-6';
const MAX_ITERATIONS = 20;

interface AgentRequest {
  message: string;
  mode: 'start' | 'chat';
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  session: ProductSession;
  imagesMeta: ImageMeta[];
  productId: string;
  sessionKey?: string;
}

interface AgentState {
  session: ProductSession;
  imagesMeta: ImageMeta[];
  allegroParams: AllegroParameter[];
  filledParameters: Record<string, string | string[]>;
  generatedSections: DescriptionSection[];
  generatedTitle: string;
  totalUsage: AnthropicUsage;
}

// ─── Tool definitions ───

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'analyze_images',
    description: 'Analizuje zdjęcia produktu: tekst z etykiet, wymiary, kolor, model, typ zdjęcia. ZAWSZE wywołaj jako pierwszy krok.',
    input_schema: {
      type: 'object',
      properties: {
        imageUrls: { type: 'array', items: { type: 'string' }, description: 'URL-e zdjęć do analizy' },
      },
      required: ['imageUrls'],
    },
  },
  {
    name: 'suggest_category',
    description: 'Sugeruje kategorię Allegro na podstawie tytułu i atrybutów produktu. Wywołaj jeśli kategoria nie jest jeszcze wybrana.',
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
    description: 'Pobiera listę parametrów dla wybranej kategorii Allegro. Wywołaj po wyborze/sugestii kategorii.',
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
    description: 'Auto-uzupełnia parametry Allegro używając AI na podstawie danych produktu i analizy zdjęć. Wywołaj po analyze_images i fetch_category_parameters.',
    input_schema: {
      type: 'object',
      properties: {
        focusParameterIds: { type: 'array', items: { type: 'string' }, description: 'Opcjonalne — focusuj tylko na tych parametrach' },
      },
    },
  },
  {
    name: 'validate_parameters',
    description: 'Sprawdza które wymagane parametry są puste. Zwraca listę brakujących z nazwami.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'update_parameter',
    description: 'Ustawia wartość konkretnego parametru Allegro (po odpowiedzi użytkownika). Dla dictionary zwróć option_id, nie nazwę.',
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
    description: 'Generuje tytuł aukcji Allegro (max 75 znaków, WIELKIE LITERY). Wywołaj po uzupełnieniu parametrów.',
    input_schema: {
      type: 'object',
      properties: {
        additionalContext: { type: 'string', description: 'Dodatkowe informacje od użytkownika wpływające na tytuł' },
      },
    },
  },
  {
    name: 'update_title',
    description: 'Ustawia konkretny tytuł (gdy użytkownik wybrał z kandydatów lub podał własny).',
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
    description: 'Generuje pełny opis produktu z sekcjami HTML. Wywołaj po generate_title.',
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
    description: 'Aktualizuje treść lub układ konkretnej sekcji w opisie.',
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
    description: 'Dodaje nową sekcję do opisu produktu.',
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
    description: 'Usuwa sekcję z opisu.',
    input_schema: {
      type: 'object',
      properties: { sectionId: { type: 'string' } },
      required: ['sectionId'],
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
};

// ─── System prompt ───

function buildSystemPrompt(state: AgentState): string {
  const { session, allegroParams } = state;
  const requiredParams = allegroParams.filter(p => p.required);
  const optionalParams = allegroParams.filter(p => !p.required);

  const paramsText = allegroParams.length > 0
    ? [
      ...requiredParams.map(p => `[WYMAGANY] ${p.name} (${p.type})${p.unit ? ` [${p.unit}]` : ''} ID=${p.id}`),
      ...optionalParams.slice(0, 20).map(p => `${p.name} (${p.type}) ID=${p.id}`),
    ].join('\n')
    : '(pobierz kategorię najpierw)';

  const attrText = Object.entries(session.data?.attributes ?? {})
    .slice(0, 30)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n') || '(brak)';

  const filledText = Object.keys(state.filledParameters).length > 0
    ? Object.entries(state.filledParameters).slice(0, 10).map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`).join('\n')
    : '(brak wypełnionych)';

  return `Jesteś Asystentem Wystawiania na Allegro. Pomagasz Grzesiowi wystawić produkt krok po kroku, od zescrapowanych danych do gotowej oferty.

## TWÓJ WORKFLOW (przy mode=start, wykonaj w tej kolejności):
1. analyze_images — ZAWSZE pierwszy krok, nawet jeśli zdjęcia były już analizowane
2. suggest_category — jeśli kategoria nie ustawiona w sesji
3. fetch_category_parameters — po wyborze/sugestii kategorii
4. fill_parameters — auto-uzupełnij parametry AI-em
5. validate_parameters — sprawdź co brakuje
6. [jeśli brakuje wymaganych] — zapytaj użytkownika, max 3 pytania naraz, bullet lista
7. generate_title — po uzupełnieniu parametrów
8. generate_description — po tytule
9. Podsumuj i czekaj na korekty

## ZASADY KOMUNIKACJI:
- Pisz PO POLSKU, zwięźle i konkretnie
- Przed każdym narzędziem: 1 zdanie co robisz
- Po każdym narzędziu: konkretny wynik (liczby, dane, co znalazłeś)
- Przy pytaniach do użytkownika: bullet lista, TYLKO wymagane parametry, konkretne pytania
- Nie pytaj o rzeczy które możesz wywnioskować ze zdjęć lub atrybutów produktu

## TRYB EDYCJI (mode=chat po wygenerowaniu opisu):
- "zmień X" → update_parameter, a jeśli X wpływa na opis → też update_section
- "skróć/rozbuduj Y" → update_section z nową treścią
- "dodaj sekcję Z" → add_section
- "usuń sekcję" → remove_section
- Zawsze potwierdzaj co zmieniłeś

## ZASADY PARAMETRÓW:
- Dictionary → zwracaj WYŁĄCZNIE option_id (np. "225088"), NIGDY nazwę opcji
- Nie wymyślaj wartości których nie ma w danych produktu
- Wymiary przepisuj DOKŁADNIE jak na etykiecie, przelicz jednostki gdy potrzeba
- Stan produktu → dopasuj do właściwego option_id ze słownika

## DANE PRODUKTU:
Tytuł: ${session.data?.title ?? '(brak)'}
EAN: ${session.data?.ean ?? '(brak)'} | SKU: ${session.data?.sku ?? '(brak)'}
Cena: ${session.data?.price ?? '(brak)'} ${session.data?.currency ?? ''}
Zdjęcia: ${(session.data?.images ?? []).length} szt.
Kategoria: ${session.allegroCategory?.path ?? session.allegroCategory?.name ?? '(nie wybrana)'}

Atrybuty ze scrape:
${attrText}

Wypełnione parametry (aktualne):
${filledText}

## PARAMETRY KATEGORII:
${paramsText}

## ZASADY OPISU:
- Nagłówki sekcji ZAWSZE CAPS: "CECHY I ZALETY", "ZASTOSOWANIA", "SPECYFIKACJA TECHNICZNA"
- layout "image-text" gdy jest zdjęcie, "text-only" bez zdjęcia, "images-only" dla banner/logo
- HTML: używaj <b>, <ul>, <li>, <p> — NIE używaj <strong>, <em>
- Nie pisz o gwarancji, nie pisz "Stan: Nowy", nie powtarzaj tytułu dosłownie
- Zachowaj wymiary DOKŁADNIE jak w danych (np. "120×60×75 cm")`;
}

// ─── Tool executor ───

async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  state: AgentState,
  sseWrite: (data: object) => void,
  productId: string,
  sessionKey: string,
  apiKey: string,
): Promise<string> {
  switch (toolName) {
    case 'analyze_images': {
      const urls = (input.imageUrls as string[]) ?? state.session.data?.images ?? [];
      if (!urls.length) return JSON.stringify({ error: 'Brak URL-i zdjęć' });

      const { results, usage } = await analyzeImages(urls, apiKey);

      state.imagesMeta = results.map((r, i) => ({
        url: r.url,
        order: i,
        removed: false,
        aiDescription: r.aiDescription,
        aiConfidence: r.aiConfidence,
        isFeatureImage: r.isFeatureImage,
        features: r.features,
        userDescription: '',
        uploadedVia: undefined,
      }));

      logTokenUsage({ productId, sessionKey, toolName, model: AGENT_MODEL, usage });
      state.totalUsage = sumUsage([state.totalUsage, usage]);
      sseWrite({ type: 'images_analyzed', imagesMeta: state.imagesMeta });
      sseWrite({ type: 'token_usage', toolName, ...usage, ...calcCost(usage, AGENT_MODEL) });

      const labelTexts = results.filter(r => r.labelText).map(r => r.labelText).slice(0, 3);
      return JSON.stringify({
        analyzed: results.length,
        labelTexts: labelTexts.length ? labelTexts : null,
        features: results.flatMap(r => r.features).slice(0, 8),
        types: [...new Set(results.map(r => r.imageType))],
      });
    }

    case 'suggest_category': {
      const title = (input.title as string) || state.session.data?.title || '';
      const attributes = (input.attributes as Record<string, string>) || state.session.data?.attributes || {};
      const { suggestions, usage } = await suggestCategory(title, attributes, apiKey);

      logTokenUsage({ productId, sessionKey, toolName, model: 'claude-haiku-4-5-20251001', usage });
      state.totalUsage = sumUsage([state.totalUsage, usage]);
      sseWrite({ type: 'token_usage', toolName, ...usage, ...calcCost(usage, 'claude-haiku-4-5-20251001') });

      if (suggestions.length > 0) {
        const top = suggestions[0];
        state.session = { ...state.session, allegroCategory: { id: top.id, name: top.name, path: top.path, leaf: true } };
        sseWrite({ type: 'session_patch', patch: { allegroCategory: state.session.allegroCategory } });
      }

      return JSON.stringify({ suggestions: suggestions.slice(0, 5).map(s => ({ id: s.id, name: s.name, path: s.path })) });
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

      const { systemPrompt, parameterIds } = buildAutoFillPrompt(
        state.session.data!,
        state.allegroParams,
        state.filledParameters,
        state.imagesMeta,
      );

      if (!systemPrompt || !parameterIds.length) {
        return JSON.stringify({ filled: 0, unfilled: 0, message: 'Wszystkie parametry już wypełnione' });
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
      state.totalUsage = sumUsage([state.totalUsage, usage]);
      sseWrite({ type: 'token_usage', toolName, ...usage, ...calcCost(usage, AUTOFILL_MODEL) });

      const rawText = data.content?.[0]?.text || '{}';
      let rawEntries: unknown[] = [];
      try {
        const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
        const jsonStr = jsonMatch ? jsonMatch[1].trim() : rawText;
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed)) rawEntries = parsed;
        else for (const val of Object.values(parsed as object)) {
          if (Array.isArray(val) && val.length > 0) { rawEntries = val; break; }
        }
      } catch { /* continue with empty */ }

      const result = validateAutoFillResponse(rawEntries, state.allegroParams, state.session.data!);
      state.filledParameters = { ...state.filledParameters, ...result.filled };
      state.session = { ...state.session, filledParameters: state.filledParameters };
      sseWrite({ type: 'session_patch', patch: { filledParameters: state.filledParameters } });

      return JSON.stringify({
        filled: Object.keys(result.filled).length,
        unfilled: result.unfilled.length,
        unfilledNames: result.unfilled.slice(0, 5).map(id => state.allegroParams.find(p => p.id === id)?.name ?? id),
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
      const { title, candidates, usage } = await generateTitle(
        { ...state.session, filledParameters: state.filledParameters },
        state.imagesMeta,
        input.additionalContext as string | undefined,
        apiKey,
      );
      logTokenUsage({ productId, sessionKey, toolName, model: AGENT_MODEL, usage });
      state.totalUsage = sumUsage([state.totalUsage, usage]);
      state.generatedTitle = title;
      state.session = { ...state.session, generatedTitle: title, titleCandidates: candidates };
      sseWrite({ type: 'title_generated', title, candidates });
      sseWrite({ type: 'session_patch', patch: { generatedTitle: title, titleCandidates: candidates } });
      sseWrite({ type: 'token_usage', toolName, ...usage, ...calcCost(usage, AGENT_MODEL) });
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
      const { sections, fullHtml, inputHash, usage } = await generateDescription({
        session: { ...state.session, filledParameters: state.filledParameters, generatedTitle: state.generatedTitle || state.session.generatedTitle },
        imagesMeta: state.imagesMeta,
        style: input.style as 'technical' | 'lifestyle' | 'simple' | undefined,
        additionalContext: input.additionalContext as string | undefined,
      }, apiKey);

      logTokenUsage({ productId, sessionKey, toolName, model: AGENT_MODEL, usage });
      state.totalUsage = sumUsage([state.totalUsage, usage]);
      state.generatedSections = sections;
      sseWrite({ type: 'description_generated', sections, fullHtml, inputHash });
      sseWrite({ type: 'token_usage', toolName, ...usage, ...calcCost(usage, AGENT_MODEL) });
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
  const { message, mode, conversationHistory, session, imagesMeta, productId } = body;
  const sessionKey = body.sessionKey ?? randomUUID();

  const anthropic = new Anthropic({ apiKey });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function sseWrite(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        const state: AgentState = {
          session: { ...session },
          imagesMeta: imagesMeta ?? [],
          allegroParams: session.allegroParameters ?? [],
          filledParameters: session.filledParameters ?? {},
          generatedSections: [],
          generatedTitle: session.generatedTitle ?? '',
          totalUsage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        };

        // Build initial messages
        const messages: Anthropic.MessageParam[] = [
          ...conversationHistory.slice(-20).map(m => ({ role: m.role, content: m.content })),
          {
            role: 'user' as const,
            content: mode === 'start'
              ? 'Zacznij workflow — przeanalizuj produkt od początku i przeprowadź mnie przez cały proces wystawiania.'
              : message,
          },
        ];

        let iterations = 0;

        while (iterations < MAX_ITERATIONS) {
          iterations++;

          // Rebuild system prompt with current state (params may have been fetched)
          const systemPrompt = buildSystemPrompt(state);

          const agentStream = anthropic.messages.stream(
            {
              model: AGENT_MODEL,
              max_tokens: 4096,
              system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }] as Anthropic.TextBlockParam[],
              tools: TOOLS,
              messages,
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
          state.totalUsage = sumUsage([state.totalUsage, iterUsage]);

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

              try {
                resultContent = await executeTool(
                  tool.name,
                  tool.input as Record<string, unknown>,
                  state,
                  sseWrite,
                  productId,
                  sessionKey,
                  apiKey,
                );
              } catch (err) {
                resultContent = JSON.stringify({ error: String(err) });
                success = false;
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

        // Send final cost summary
        const totalCost = calcCost(state.totalUsage, AGENT_MODEL);
        sseWrite({
          type: 'total_cost',
          input_tokens: state.totalUsage.input_tokens,
          output_tokens: state.totalUsage.output_tokens,
          usd: totalCost.usd,
          pln: totalCost.pln,
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
