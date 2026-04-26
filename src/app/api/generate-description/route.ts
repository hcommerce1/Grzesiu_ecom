import { NextResponse } from 'next/server';
import { generateDescription } from '@/lib/description-generator';
import { logTokenUsage } from '@/lib/token-logger';
import { calcCost } from '@/lib/token-cost';
import type { ProductSession, ImageMeta } from '@/lib/types';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const DESCRIPTION_MODEL = process.env.DESCRIPTION_MODEL || 'claude-sonnet-4-6';

interface Body {
  session: ProductSession;
  imagesMeta: ImageMeta[];
  style?: 'technical' | 'lifestyle' | 'simple';
  additionalContext?: string;
  customPrompt?: string;
  productId: string;
  sessionKey?: string;
}

export async function POST(req: Request) {
  try {
    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY nie jest ustawiony' }, { status: 500 });
    }

    const body = (await req.json()) as Body;
    if (!body.session) {
      return NextResponse.json({ error: 'Brak session w body' }, { status: 400 });
    }

    // Soft warning gdy wszystkie zdjęcia bez analizy — nie blokujemy generowania,
    // user może chcieć opis bez kontekstu wizji.
    const activeImages = (body.imagesMeta ?? []).filter(i => !i.removed);
    const validImages = activeImages.filter(i => (i.aiConfidence ?? 0) > 0);
    const warning = activeImages.length > 0 && validImages.length === 0
      ? 'Żadne zdjęcie nie ma poprawnej analizy AI — opis może być niskiej jakości (zrób analizę zdjęć dla lepszego efektu).'
      : (activeImages.length >= 3 && validImages.length / activeImages.length < 0.5
        ? `Tylko ${validImages.length}/${activeImages.length} zdjęć ma poprawną analizę.`
        : undefined);

    const { sections, fullHtml, inputHash, inputSnapshot, usage } = await generateDescription({
      session: body.session,
      imagesMeta: body.imagesMeta ?? [],
      style: body.style,
      additionalContext: body.additionalContext,
      customPrompt: body.customPrompt,
    }, ANTHROPIC_API_KEY);

    logTokenUsage({
      productId: body.productId ?? 'local',
      sessionKey: body.sessionKey,
      toolName: 'generate_description',
      model: DESCRIPTION_MODEL,
      usage,
    });

    const cost = calcCost(usage, DESCRIPTION_MODEL);
    return NextResponse.json({ sections, fullHtml, inputHash, inputSnapshot, usage, cost, warning });
  } catch (err) {
    console.error('[generate-description] failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Błąd generowania opisu' },
      { status: 500 },
    );
  }
}
