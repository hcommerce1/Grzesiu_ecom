import { NextRequest, NextResponse } from 'next/server';
import { getCategoryParameters, getCommissionInfo } from '@/lib/allegro';
import type { AllegroParameter } from '@/lib/types';

// ─── Mock data for demo mode ───
const MOCK_PARAMETERS: AllegroParameter[] = [
  {
    id: 'demo-brand',
    name: 'Marka',
    type: 'string',
    required: true,
  },
  {
    id: 'demo-model',
    name: 'Model',
    type: 'string',
    required: true,
  },
  {
    id: 'demo-color',
    name: 'Kolor',
    type: 'dictionary',
    required: false,
    options: [
      { id: 'black', value: 'Czarny' },
      { id: 'white', value: 'Biały' },
      { id: 'silver', value: 'Srebrny' },
      { id: 'blue', value: 'Niebieski' },
      { id: 'red', value: 'Czerwony' },
    ],
  },
  {
    id: 'demo-condition',
    name: 'Stan',
    type: 'dictionary',
    required: true,
    options: [
      { id: 'new', value: 'Nowy' },
      { id: 'used', value: 'Używany' },
      { id: 'damaged', value: 'Uszkodzony' },
    ],
  },
  {
    id: 'demo-ean',
    name: 'EAN (GTIN)',
    type: 'string',
    required: false,
  },
  {
    id: 'demo-warranty',
    name: 'Gwarancja',
    type: 'dictionary',
    required: false,
    options: [
      { id: '12', value: '12 miesięcy' },
      { id: '24', value: '24 miesiące' },
      { id: '36', value: '36 miesięcy' },
    ],
  },
  {
    id: 'demo-weight',
    name: 'Waga (kg)',
    type: 'float',
    required: false,
    unit: 'kg',
    restrictions: { min: 0, max: 100 },
  },
];

const MOCK_COMMISSION = '⚠️ TRYB DEMO — Prowizja: ~8% dla tej kategorii. Ustaw ALLEGRO_CLIENT_ID aby pobrać prawdziwe stawki.';

function isDemoMode() {
  return !process.env.ALLEGRO_CLIENT_ID;
}

// GET /api/allegro/parameters?categoryId=<id>
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const categoryId = searchParams.get('categoryId');

  if (!categoryId) {
    return NextResponse.json({ error: 'Missing categoryId' }, { status: 400 });
  }

  if (isDemoMode()) {
    return NextResponse.json({
      parameters: MOCK_PARAMETERS,
      commissionInfo: MOCK_COMMISSION,
      _demo: true,
    });
  }

  try {
    const [parameters, commissionInfo] = await Promise.all([
      getCategoryParameters(categoryId),
      getCommissionInfo(categoryId),
    ]);
    return NextResponse.json({ parameters, commissionInfo });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
