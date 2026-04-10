import { NextRequest, NextResponse } from 'next/server';
import { getRootCategories, getChildCategories } from '@/lib/allegro';
import type { AllegroCategory } from '@/lib/types';

// ─── Mock data for demo mode (no Allegro credentials) ───
const MOCK_ROOT: AllegroCategory[] = [
  { id: 'demo-1', name: 'Elektronika', path: 'Elektronika', leaf: false },
  { id: 'demo-2', name: 'Dom i Ogród', path: 'Dom i Ogród', leaf: false },
  { id: 'demo-3', name: 'Sport i Turystyka', path: 'Sport i Turystyka', leaf: false },
  { id: 'demo-4', name: 'Moda', path: 'Moda', leaf: false },
  { id: 'demo-5', name: 'Motoryzacja', path: 'Motoryzacja', leaf: false },
];

const MOCK_CHILDREN: Record<string, AllegroCategory[]> = {
  'demo-1': [
    { id: 'demo-1-1', name: 'Telefony i Smartfony', path: 'Elektronika > Telefony i Smartfony', leaf: false },
    { id: 'demo-1-2', name: 'Komputery', path: 'Elektronika > Komputery', leaf: false },
    { id: 'demo-1-3', name: 'Telewizory i Audio', path: 'Elektronika > Telewizory i Audio', leaf: false },
  ],
  'demo-1-1': [
    { id: 'demo-1-1-1', name: 'Smartfony', path: 'Elektronika > Telefony i Smartfony > Smartfony', leaf: true },
    { id: 'demo-1-1-2', name: 'Akcesoria do telefonów', path: 'Elektronika > Telefony i Smartfony > Akcesoria', leaf: true },
  ],
  'demo-1-2': [
    { id: 'demo-1-2-1', name: 'Laptopy', path: 'Elektronika > Komputery > Laptopy', leaf: true },
    { id: 'demo-1-2-2', name: 'Akcesoria komputerowe', path: 'Elektronika > Komputery > Akcesoria', leaf: true },
  ],
  'demo-1-3': [
    { id: 'demo-1-3-1', name: 'Telewizory', path: 'Elektronika > Telewizory i Audio > Telewizory', leaf: true },
    { id: 'demo-1-3-2', name: 'Słuchawki', path: 'Elektronika > Telewizory i Audio > Słuchawki', leaf: true },
  ],
  'demo-2': [
    { id: 'demo-2-1', name: 'Meble', path: 'Dom i Ogród > Meble', leaf: true },
    { id: 'demo-2-2', name: 'Oświetlenie', path: 'Dom i Ogród > Oświetlenie', leaf: true },
    { id: 'demo-2-3', name: 'Narzędzia', path: 'Dom i Ogród > Narzędzia', leaf: true },
  ],
  'demo-3': [
    { id: 'demo-3-1', name: 'Rowery', path: 'Sport i Turystyka > Rowery', leaf: true },
    { id: 'demo-3-2', name: 'Camping', path: 'Sport i Turystyka > Camping', leaf: true },
  ],
  'demo-4': [
    { id: 'demo-4-1', name: 'Odzież damska', path: 'Moda > Odzież damska', leaf: true },
    { id: 'demo-4-2', name: 'Odzież męska', path: 'Moda > Odzież męska', leaf: true },
  ],
  'demo-5': [
    { id: 'demo-5-1', name: 'Części samochodowe', path: 'Motoryzacja > Części samochodowe', leaf: true },
    { id: 'demo-5-2', name: 'Akcesoria samochodowe', path: 'Motoryzacja > Akcesoria', leaf: true },
  ],
};

function isDemoMode() {
  return !process.env.ALLEGRO_CLIENT_ID;
}

// GET /api/allegro/categories?parentId=<id>
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const parentId = searchParams.get('parentId') ?? '';

  if (isDemoMode()) {
    const categories = parentId
      ? (MOCK_CHILDREN[parentId] ?? [])
      : MOCK_ROOT;
    return NextResponse.json({ categories, _demo: true });
  }

  try {
    const categories = parentId
      ? await getChildCategories(parentId)
      : await getRootCategories();
    return NextResponse.json({ categories });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
