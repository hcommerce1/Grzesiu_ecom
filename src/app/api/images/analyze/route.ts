import { NextResponse } from 'next/server';
import { analyzeImages, type ProductContext } from '@/lib/image-analyzer';
import { logTokenUsage } from '@/lib/token-logger';
import { calcCost } from '@/lib/token-cost';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const VISION_MODEL = process.env.AGENT_VISION_MODEL || 'claude-sonnet-4-6';

interface Body {
  images: string[];
  context?: ProductContext;
  productId?: string;
  sessionKey?: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const { images, context } = body;

    if (!images?.length) {
      return NextResponse.json({ error: 'Brak zdjęć do analizy' }, { status: 400 });
    }

    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY nie jest ustawiony' }, { status: 500 });
    }

    console.log(`[image-analyze] Analyzing ${images.length} images via shared analyzeImages (base64)`);
    const { results, usage } = await analyzeImages(images, ANTHROPIC_API_KEY, context);

    logTokenUsage({
      productId: body.productId ?? 'local',
      sessionKey: body.sessionKey,
      toolName: 'analyze_images',
      model: VISION_MODEL,
      usage,
    });

    const cost = calcCost(usage, VISION_MODEL);
    return NextResponse.json({ results, usage, cost });
  } catch (err) {
    console.error('Image analysis failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Błąd analizy zdjęć' },
      { status: 500 },
    );
  }
}
