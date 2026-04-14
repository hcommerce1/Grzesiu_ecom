import { NextRequest, NextResponse } from 'next/server';
import { getCategoryParameters } from '@/lib/allegro';
import { matchSheetToParameters } from '@/lib/parameter-matcher';
import type { SheetMeta } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sheets/match-parameters
 * Given a category ID and sheet data, returns fuzzy-matched Allegro parameter values.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { categoryId, sheetData, parameters: clientParameters } = body as {
      categoryId: string;
      sheetData: SheetMeta;
      parameters?: import('@/lib/types').AllegroParameter[];
    };

    if (!categoryId) {
      return NextResponse.json({ error: 'categoryId is required' }, { status: 400 });
    }
    if (!sheetData) {
      return NextResponse.json({ error: 'sheetData is required' }, { status: 400 });
    }

    // Użyj parametrów przesłanych przez klienta jeśli dostępne, żeby uniknąć podwójnego fetcha z Allegro
    const parameters = clientParameters?.length ? clientParameters : await getCategoryParameters(categoryId);
    const { matchResults, suggestedValues } = matchSheetToParameters(sheetData, parameters);

    return NextResponse.json({ parameters, matchResults, suggestedValues });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
