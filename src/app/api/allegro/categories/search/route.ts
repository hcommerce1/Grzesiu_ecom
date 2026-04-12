import { NextRequest, NextResponse } from 'next/server';
import { searchCategories, getCommissionInfo } from '@/lib/allegro';

function isDemoMode() {
  return !process.env.ALLEGRO_CLIENT_ID;
}

const DEMO_RESULTS = [
  { id: 'demo-1-1-1', name: 'Smartfony', fullPath: 'Elektronika > Telefony > Smartfony', leaf: true },
  { id: 'demo-1-2-1', name: 'Laptopy', fullPath: 'Elektronika > Komputery > Laptopy', leaf: true },
  { id: 'demo-2-1', name: 'Meble', fullPath: 'Dom i Ogród > Meble', leaf: true },
];

// GET /api/allegro/categories/search?q=odkurzacze&withCommission=true
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q') ?? '';
  const withCommission = searchParams.get('withCommission') === 'true';

  if (!query.trim()) {
    return NextResponse.json({ results: [] });
  }

  if (isDemoMode()) {
    const filtered = DEMO_RESULTS.filter(r =>
      r.name.toLowerCase().includes(query.toLowerCase()) ||
      r.fullPath.toLowerCase().includes(query.toLowerCase())
    );
    return NextResponse.json({
      results: filtered.map(r => ({ ...r, commission: '⚠️ TRYB DEMO — ~8%' })),
      _demo: true,
    });
  }

  try {
    const results = await searchCategories(query.trim(), 20);

    if (withCommission && results.length > 0) {
      const leafResults = results.filter(r => r.leaf).slice(0, 15);
      const commissionsRaw = await Promise.allSettled(
        leafResults.map(cat => getCommissionInfo(cat.id))
      );

      const enriched = leafResults.map((cat, i) => ({
        ...cat,
        commission: commissionsRaw[i].status === 'fulfilled'
          ? commissionsRaw[i].value
          : null,
      }));

      return NextResponse.json({ results: enriched });
    }

    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
