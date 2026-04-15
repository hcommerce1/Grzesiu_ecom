import { NextRequest, NextResponse } from 'next/server';
import { getSellerSession } from '@/lib/db';

const LLM_MODEL = process.env.LLM_MODEL ?? 'gpt-4o-mini';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';

function getSystemPrompt(step: string): string {
  switch (step) {
    case 'selection':
    case 'grid':
      return `Jesteś asystentem pomagającym przefiltrować i zaznaczyć produkty ze sklepu sprzedawcy na Allegro.
Masz listę produktów (id, title, price). User wydaje polecenia po polsku.
Zwróć WYŁĄCZNIE JSON w formacie: {"reply": "...", "actions": [...]}
Dostępne typy akcji:
- {"type": "select", "ids": ["id1","id2",...]} — zaznacz produkty
- {"type": "deselect", "ids": [...]} — odznacz produkty
- {"type": "message", "text": "..."} — zwykła odpowiedź bez akcji
Analizuj tytuły i ceny żeby wykryć co user ma na myśli. Bądź dosłowny w liczeniu wyników.`;

    case 'grouping':
      return `Jesteś asystentem pomagającym pogrupować produkty w kategorie.
Masz listę produktów z ich aktualnymi grupami. User wydaje polecenia po polsku.
Zwróć WYŁĄCZNIE JSON: {"reply": "...", "actions": [...]}
Dostępne typy akcji:
- {"type": "move_to_group", "ids": [...], "groupName": "Nowa Grupa"} — przenieś do grupy
- {"type": "create_group", "groupName": "Nowa Grupa"} — utwórz nową grupę
- {"type": "message", "text": "..."} — zwykła odpowiedź
Przy sugerowaniu grup analizuj tytuły produktów — szukaj wspólnych kategorii, marek, typów.`;

    case 'ean-assign':
      return `Jesteś asystentem pomagającym przypisać kody EAN do produktów.
User wkleja listę EAN-ów lub wydaje polecenia przypisania. Zwróć WYŁĄCZNIE JSON: {"reply": "...", "actions": [...]}
Dostępne typy akcji:
- {"type": "assign_eans", "assignments": [{"listingId": "...", "ean": "..."}]} — przypisz EAN-y
- {"type": "message", "text": "..."} — zwykła odpowiedź
Dopasowuj EAN-y do produktów na podstawie tytułów, SKU lub kolejności.`;

    case 'diff-fields':
    case 'template':
      return `Jesteś asystentem pomagającym skonfigurować template masowego wystawiania.
Pomóż userowi zrozumieć diff fields (pola różniące się między wariantami) i skonfigurować template.
Zwróć WYŁĄCZNIE JSON: {"reply": "...", "actions": [...]}
Dostępne typy akcji:
- {"type": "set_diff_field", "field": "attr:Kolor", "enabled": true} — włącz/wyłącz diff field
- {"type": "message", "text": "..."} — zwykła odpowiedź`;

    default:
      return `Jesteś asystentem pomagającym ze scrapowaniem listingów sprzedawców i masowym wystawianiem produktów.
Zwróć WYŁĄCZNIE JSON: {"reply": "...", "actions": []}`;
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  try {
    const session = getSellerSession(sessionId);
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    const { messages, context } = await req.json();
    if (!Array.isArray(messages)) {
      return NextResponse.json({ error: 'messages array required' }, { status: 400 });
    }

    const step = context?.step ?? 'selection';
    const systemPrompt = getSystemPrompt(step);

    // Build context message with listings/groups
    let contextContent = '';
    if (context?.listings && Array.isArray(context.listings) && context.listings.length > 0) {
      const listingSummary = context.listings.slice(0, 100).map((l: { id: string; title: string; price?: string; selected?: boolean; groupName?: string }) =>
        `ID: ${l.id} | Tytuł: ${l.title} | Cena: ${l.price ?? '?'} | Zaznaczony: ${l.selected ? 'TAK' : 'NIE'}${l.groupName ? ` | Grupa: ${l.groupName}` : ''}`
      ).join('\n');
      contextContent = `\n\nLista produktów (${context.listings.length} łącznie, pokazuję max 100):\n${listingSummary}`;
    }
    if (context?.groups && typeof context.groups === 'object') {
      const groupSummary = Object.entries(context.groups).map(([name, ids]) =>
        `Grupa "${name}": ${(ids as string[]).length} produktów`
      ).join('\n');
      contextContent += `\n\nAktualne grupy:\n${groupSummary}`;
    }

    // Build messages array for API
    const apiMessages = [
      { role: 'system', content: systemPrompt + contextContent },
      ...messages.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: apiMessages,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return NextResponse.json({ error: `OpenAI error: ${err}` }, { status: 500 });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? '{}';

    let parsed: { reply?: string; actions?: unknown[] };
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = { reply: content, actions: [] };
    }

    return NextResponse.json({
      reply: parsed.reply ?? '',
      actions: parsed.actions ?? [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
