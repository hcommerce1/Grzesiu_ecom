import { NextResponse } from 'next/server';
import { generateTitle } from '@/lib/title-generator';
import { logTokenUsage } from '@/lib/token-logger';
import { calcCost } from '@/lib/token-cost';
import type { ProductSession, ImageMeta } from '@/lib/types';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const TITLE_MODEL = process.env.TITLE_MODEL || 'claude-haiku-4-5-20251001';

interface Body {
  session: ProductSession;
  imagesMeta: ImageMeta[];
  additionalContext?: string;
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

    const { title, candidates, usage } = await generateTitle(
      body.session,
      body.imagesMeta ?? [],
      body.additionalContext,
      ANTHROPIC_API_KEY,
    );

    logTokenUsage({
      productId: body.productId ?? 'local',
      sessionKey: body.sessionKey,
      toolName: 'generate_title',
      model: TITLE_MODEL,
      usage,
    });

    const cost = calcCost(usage, TITLE_MODEL);
    return NextResponse.json({ title, candidates, usage, cost });
  } catch (err) {
    console.error('[generate-title] failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Błąd generowania tytułu' },
      { status: 500 },
    );
  }
}
