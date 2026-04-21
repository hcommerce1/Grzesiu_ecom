import { getCategoryParameters, getCommissionInfo } from '@/lib/allegro';
import type { AllegroParameter } from './types';

const MOCK_PARAMETERS: AllegroParameter[] = [
  { id: 'demo-brand', name: 'Marka', type: 'string', required: true },
  { id: 'demo-model', name: 'Model', type: 'string', required: true },
  { id: 'demo-color', name: 'Kolor', type: 'dictionary', required: false,
    options: [
      { id: 'black', value: 'Czarny' }, { id: 'white', value: 'Biały' },
      { id: 'silver', value: 'Srebrny' }, { id: 'blue', value: 'Niebieski' }, { id: 'red', value: 'Czerwony' },
    ],
  },
  { id: 'demo-condition', name: 'Stan', type: 'dictionary', required: true,
    options: [{ id: 'new', value: 'Nowy' }, { id: 'used', value: 'Używany' }],
  },
];

export async function fetchCategoryParameters(
  categoryId: string,
): Promise<{ parameters: AllegroParameter[]; commissionInfo: string }> {
  if (!process.env.ALLEGRO_CLIENT_ID) {
    return {
      parameters: MOCK_PARAMETERS,
      commissionInfo: '⚠️ TRYB DEMO — Ustaw ALLEGRO_CLIENT_ID aby pobrać prawdziwe parametry.',
    };
  }

  const parameters = await getCategoryParameters(categoryId);
  let commissionInfo = '';
  try {
    commissionInfo = await getCommissionInfo(categoryId);
  } catch {
    // commission is optional
  }
  return { parameters, commissionInfo };
}
