let cached: { rate: number; ts: number } | null = null;
const TTL_MS = 24 * 60 * 60 * 1000;
const FALLBACK = 4.10;

export async function getUsdToPln(): Promise<number> {
  const now = Date.now();
  if (cached && now - cached.ts < TTL_MS) return cached.rate;
  try {
    const r = await fetch(
      'https://api.nbp.pl/api/exchangerates/rates/A/USD/?format=json',
      { next: { revalidate: 86400 } },
    );
    if (!r.ok) throw new Error(`NBP ${r.status}`);
    const j = await r.json();
    const rate = j?.rates?.[0]?.mid;
    if (typeof rate === 'number' && rate > 0) {
      cached = { rate, ts: now };
      return rate;
    }
  } catch (e) {
    console.warn('[fx-rate] NBP fetch failed, using fallback', e);
  }
  return cached?.rate ?? FALLBACK;
}

export function getCachedUsdToPln(): number {
  return cached?.rate ?? FALLBACK;
}
