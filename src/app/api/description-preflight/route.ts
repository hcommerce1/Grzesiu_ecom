import { NextResponse } from 'next/server';
import type { ImageMeta } from '@/lib/types';
import { filterAttributesForAI } from '@/lib/ai-field-filter';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const CLAUDE_MODEL = 'claude-sonnet-4-6';

interface PreflightMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface DescriptionPreflightRequest {
  title: string;
  attributes: Record<string, string>;
  category: string;
  imagesMeta: ImageMeta[];
  filledParameters: Record<string, string | string[]>;
  bundleContext?: string;
  referenceDescription?: string;
  uwagi?: string;
  conversationHistory?: PreflightMessage[];
  // Pełny kontekst produktu
  originalDescription?: string;
  price?: string;
  currency?: string;
  ean?: string;
  sku?: string;
}

function buildSystemPrompt(body: DescriptionPreflightRequest): string {
  const filteredAttributes = filterAttributesForAI(body.attributes || {});
  const attributesList = Object.entries(filteredAttributes)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n') || '(brak atrybutów)';

  const parametersList = Object.entries(body.filledParameters || {})
    .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    .join('\n') || '(brak parametrów)';

  const activeImages = (body.imagesMeta || []).filter(i => !i.removed);
  const imagesWithDesc = activeImages.filter(i => i.aiDescription || i.userDescription);
  const imagesList = activeImages.length > 0
    ? activeImages.map((img, idx) => {
        const desc = img.userDescription || img.aiDescription || '(brak opisu)';
        return `Zdjęcie ${idx}: ${desc}`;
      }).join('\n')
    : '(brak zdjęć)';

  const bundleSection = body.bundleContext
    ? `\n\nKONTEKST ZESTAWU (składniki):\n${body.bundleContext}`
    : '';

  const referenceSection = body.referenceDescription
    ? `\n\nDOSTĘPNY OPIS REFERENCYJNY (wzorzec stylu):\n${body.referenceDescription.slice(0, 800)}${body.referenceDescription.length > 800 ? '...' : ''}`
    : '';

  const originalDescSection = body.originalDescription?.trim()
    ? `\n\nORYGINALNY OPIS PRODUKTU (ze strony źródłowej — kopalnia informacji, ale NIE pytaj o rzeczy które tu są):\n${body.originalDescription.slice(0, 3000)}`
    : '';

  const productIds = [
    body.price ? `Cena: ${body.price}${body.currency ? ' ' + body.currency : ''}` : '',
    body.ean ? `EAN: ${body.ean}` : '',
    body.sku ? `SKU: ${body.sku}` : '',
  ].filter(Boolean).join(' | ');

  return `Jesteś asystentem przygotowującym dane do wygenerowania opisu produktu na Allegro. Rozmawiasz z użytkownikiem po polsku.

TWOJE ZADANIE:
1. Przeanalizuj dostępne dane produktu (w tym oryginalny opis jeśli dostępny)
2. W pierwszej wiadomości: wypisz krótko co masz (1-2 zdania), zasugeruj styl opisu i zapytaj o brakujące informacje (max 2-3 pytania)
3. W kolejnych wiadomościach: odpowiadaj na pytania użytkownika, zbieraj dodatkowe informacje
4. Gdy już masz wystarczające dane lub użytkownik da sygnał (np. "generuj", "wystarczy", "ok") — ustaw readyToGenerate: true i podaj zebrany kontekst

DOSTĘPNE STYLE OPISU:
- "technical": Techniczny — spec na górze, lista zastosowań, BEZ storytellingu. Dla kabli, rur, narzędzi, materiałów budowlanych, elektryki.
- "lifestyle": Lifestyle — hook emocjonalny + historia użycia, cechy, spec na dole. Dla mebli, AGD, toreb, elektroniki konsumenckiej.
- "simple": Prosty — 3-4 sekcje, minimalistyczny. Gdy brakuje wielu danych lub produkt jest bardzo prosty.

DANE PRODUKTU:
Tytuł: ${body.title || '(brak)'}
Kategoria: ${body.category || '(brak)'}
Stan/uwagi: ${body.uwagi || '(brak)'}
${productIds ? productIds : ''}

Atrybuty (${Object.keys(filteredAttributes).length} szt.):
${attributesList}

Parametry Allegro (${Object.keys(body.filledParameters || {}).length} szt.):
${parametersList}

Zdjęcia: ${activeImages.length} szt. (${imagesWithDesc.length} z opisem AI)
${imagesList}${bundleSection}${referenceSection}${originalDescSection}

ZASADY:
- Pisz zwięźle i konkretnie po polsku
- W pierwszej wiadomości zawsze sugeruj styl i wyjaśnij dlaczego
- Pytaj tylko o informacje które naprawdę poprawią opis i których NIE MA w danych powyżej (zastosowania, główna korzyść, docelowy klient itp.)
- Nie pytaj o dane które już masz (w tym o dane z oryginalnego opisu)
- Gdy użytkownik odpowie na pytania, potwierdź i powiedz że możesz generować
- Możesz też zaakceptować "generuj" / "wystarczy" bez dalszych pytań

Zwróć WYŁĄCZNIE JSON (bez markdown, bez żadnego innego tekstu):
{
  "message": "tekst wiadomości dla użytkownika",
  "suggestedStyle": "technical|lifestyle|simple",
  "readyToGenerate": false,
  "gatheredContext": "dodatkowy kontekst zebrany od użytkownika (wypełniaj stopniowo, końcowa wersja gdy readyToGenerate: true)"
}`;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as DescriptionPreflightRequest;

    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY nie jest ustawiony' }, { status: 500 });
    }

    const systemPrompt = buildSystemPrompt(body);

    // Build messages for Claude
    const history = body.conversationHistory ?? [];
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    if (history.length === 0) {
      // First turn — trigger AI analysis automatically
      messages.push({ role: 'user', content: 'Przeanalizuj dane produktu i powiedz co masz, zaproponuj styl i zapytaj o brakujące informacje.' });
    } else {
      // Subsequent turns — include history
      for (const msg of history.slice(-12)) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1000,
        system: systemPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Claude API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    const content = data.content?.[0]?.text ?? '{}';

    // Strip markdown code fences
    const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    let parsed: {
      message?: string;
      suggestedStyle?: string;
      readyToGenerate?: boolean;
      gatheredContext?: string;
    } = {};

    const tryParse = (text: string) => JSON.parse(text);

    try {
      parsed = tryParse(cleaned);
    } catch {
      // Try extracting first JSON object from content (handles prefix text from model)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = tryParse(jsonMatch[0]);
        } catch {
          parsed = { message: 'Nie udało się przetworzyć odpowiedzi AI. Spróbuj ponownie.', readyToGenerate: false };
        }
      } else {
        parsed = { message: 'Nie udało się przetworzyć odpowiedzi AI. Spróbuj ponownie.', readyToGenerate: false };
      }
    }

    return NextResponse.json({
      message: parsed.message || 'Analizuję...',
      suggestedStyle: parsed.suggestedStyle || null,
      readyToGenerate: parsed.readyToGenerate === true,
      gatheredContext: parsed.gatheredContext || '',
    });
  } catch (err) {
    console.error('Description preflight failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Błąd preflightu' },
      { status: 500 },
    );
  }
}
