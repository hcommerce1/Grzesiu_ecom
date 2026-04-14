import type { AllegroParameter, ProductData, AutoFillEntry, AutoFillResult } from './types';
import { normalizePolish } from './parameter-matcher';

// ─── Token estimation ───

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Tiering: decide which parameters to include in prompt ───

interface ParameterTier {
  params: AllegroParameter[];
  truncateOptions: boolean;
}

function tierParameters(
  parameters: AllegroParameter[],
  productData: ProductData,
  alreadyFilled: Record<string, string | string[]>,
): ParameterTier[] {
  const unfilled = parameters.filter((p) => !alreadyFilled[p.id]);
  if (unfilled.length === 0) return [];

  const attrKeys = new Set(
    Object.keys(productData.attributes).map((k) => normalizePolish(k)),
  );
  const titleNorm = normalizePolish(productData.title);
  const descNorm = normalizePolish(productData.description || '');

  // Tier 1: required params — full options
  const tier1 = unfilled.filter((p) => p.required);

  // Tier 2: optional params whose name overlaps with scraped data
  const tier2 = unfilled.filter((p) => {
    if (p.required) return false;
    const nameNorm = normalizePolish(p.name);
    return (
      attrKeys.has(nameNorm) ||
      [...attrKeys].some((k) => k.includes(nameNorm) || nameNorm.includes(k)) ||
      titleNorm.includes(nameNorm) ||
      descNorm.includes(nameNorm)
    );
  });

  // Tier 3: remaining optional
  const tier2Ids = new Set(tier2.map((p) => p.id));
  const tier3 = unfilled.filter((p) => !p.required && !tier2Ids.has(p.id));

  const tiers: ParameterTier[] = [];
  if (tier1.length) tiers.push({ params: tier1, truncateOptions: false });
  if (tier2.length) tiers.push({ params: tier2, truncateOptions: false });
  if (tier3.length) tiers.push({ params: tier3, truncateOptions: true });

  return tiers;
}

// ─── Build prompt ───

function formatParamForPrompt(param: AllegroParameter, truncate: boolean): string {
  const opts = param.dictionary ?? (Array.isArray(param.options) ? param.options : null) ?? param.restrictions?.allowedValues ?? [];
  const lines: string[] = [];

  lines.push(`### Parametr ID="${param.id}" | Nazwa="${param.name}" | Typ=${param.type} | Wymagany=${param.required ? 'TAK' : 'NIE'}`);

  if (param.unit) lines.push(`Jednostka: ${param.unit}`);
  if (param.restrictions?.min !== undefined) lines.push(`Min: ${param.restrictions.min}`);
  if (param.restrictions?.max !== undefined) lines.push(`Max: ${param.restrictions.max}`);
  if (param.restrictions?.multipleChoices) lines.push(`Wielokrotny wybór: TAK`);

  if ((param.type === 'dictionary' || opts.length > 0) && opts.length > 0) {
    const displayOpts = truncate ? opts.slice(0, 30) : opts;
    lines.push(`Dozwolone wartości (ID → nazwa):`);
    for (const o of displayOpts) {
      lines.push(`  "${o.id}" → "${o.value}"`);
    }
    if (truncate && opts.length > 30) {
      lines.push(`  ... (i ${opts.length - 30} więcej opcji)`);
    }
    lines.push(`ZASADA: Zwróć WYŁĄCZNIE jedno z powyższych ID. Jeśli żadna opcja nie pasuje, zwróć null.`);
  }

  if (param.type === 'integer' || param.type === 'float') {
    lines.push(`ZASADA: Wyciągnij wartość liczbową z danych produktu. Przelicz jednostki jeśli potrzeba. Zwróć null jeśli brak danych.`);
  }

  if (param.type === 'string') {
    lines.push(`ZASADA: Wyciągnij dosłownie z danych produktu. NIE generuj ani nie parafrazuj. Zwróć null jeśli brak.`);
  }

  if (param.type === 'boolean') {
    lines.push(`ZASADA: Zwróć "true" lub "false" TYLKO jeśli dane produktu wprost to stwierdzają. Inaczej null.`);
  }

  return lines.join('\n');
}

export function buildAutoFillPrompt(
  productData: ProductData,
  parameters: AllegroParameter[],
  alreadyFilled: Record<string, string | string[]>,
): { systemPrompt: string; parameterIds: string[] } {
  const tiers = tierParameters(parameters, productData, alreadyFilled);
  if (tiers.length === 0) {
    return { systemPrompt: '', parameterIds: [] };
  }

  const attrLines = Object.entries(productData.attributes)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');

  const paramSections: string[] = [];
  const parameterIds: string[] = [];

  for (const tier of tiers) {
    for (const param of tier.params) {
      paramSections.push(formatParamForPrompt(param, tier.truncateOptions));
      parameterIds.push(param.id);
    }
  }

  // Check total size and batch if needed
  const paramText = paramSections.join('\n\n');
  const totalTokens = estimateTokens(paramText);

  // If too large, keep only tier 1 + tier 2
  let finalParamText = paramText;
  let finalIds = parameterIds;

  if (totalTokens > 80000 && tiers.length > 1) {
    const reducedSections: string[] = [];
    const reducedIds: string[] = [];
    for (const tier of tiers.slice(0, 2)) {
      for (const param of tier.params) {
        reducedSections.push(formatParamForPrompt(param, true));
        reducedIds.push(param.id);
      }
    }
    finalParamText = reducedSections.join('\n\n');
    finalIds = reducedIds;
  }

  const systemPrompt = `Jesteś systemem ekstrakcji danych produktowych. Twoje zadanie to dopasowanie danych zeskrapowanych ze strony produktowej do parametrów kategorii Allegro.

## ZASADY BEZWZGLĘDNE
1. NIGDY nie wymyślaj wartości. Każda wartość MUSI pochodzić z danych produktu podanych poniżej.
2. Dla parametrów typu dictionary — zwracaj WYŁĄCZNIE ID z listy dozwolonych wartości. Żadnych innych.
3. Jeśli nie znajdziesz wartości w danych — zwróć null. Lepiej zwrócić null niż zgadywać.
4. W polu "source" podaj DOKŁADNIE skąd wzięta wartość (np. "attributes.Kolor = Czarny").
5. Confidence: 1.0 = pewne dopasowanie, 0.8 = bardzo prawdopodobne, 0.6 = niepewne. Poniżej 0.5 = zwróć null.

## DANE PRODUKTU

Tytuł: ${productData.title}

Opis:
${(productData.description || '(brak)').slice(0, 3000)}

Atrybuty:
${attrLines || '(brak)'}

EAN: ${productData.ean || '(brak)'}
SKU: ${productData.sku || '(brak)'}

## PARAMETRY DO WYPEŁNIENIA

${finalParamText}

## FORMAT ODPOWIEDZI

Zwróć tablicę JSON. Dla każdego parametru, który udało się dopasować:
[
  {
    "parameterId": "id_parametru",
    "value": "id_opcji_lub_wartość",
    "confidence": 0.95,
    "source": "dokładne źródło w danych produktu"
  }
]

Jeśli parametr ma multipleChoices=TAK, "value" może być tablicą ID: ["id1", "id2"].
NIE uwzględniaj parametrów, dla których nie znaleziono wartości. Zwróć pustą tablicę [] jeśli nic nie pasuje.`;

  return { systemPrompt, parameterIds: finalIds };
}

// ─── Validate LLM response ───

export function validateAutoFillResponse(
  rawEntries: unknown[],
  parameters: AllegroParameter[],
  productData: ProductData,
): AutoFillResult {
  const paramMap = new Map(parameters.map((p) => [p.id, p]));
  const filled: Record<string, string | string[]> = {};
  const details: AutoFillEntry[] = [];
  const processedIds = new Set<string>();

  // Normalize all product text for string validation
  const productText = normalizePolish(
    [
      productData.title,
      productData.description || '',
      ...Object.values(productData.attributes),
      productData.ean || '',
      productData.sku || '',
    ].join(' '),
  );

  for (const raw of rawEntries) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;

    const parameterId = String(entry.parameterId ?? '');
    const confidence = Number(entry.confidence ?? 0);
    const source = String(entry.source ?? '');

    if (!parameterId || confidence < 0.5) continue;

    const param = paramMap.get(parameterId);
    if (!param) continue;
    if (processedIds.has(parameterId)) continue;
    processedIds.add(parameterId);

    const opts = param.dictionary ?? (Array.isArray(param.options) ? param.options : null) ?? param.restrictions?.allowedValues ?? [];

    // Validate based on type
    if (param.type === 'dictionary' || opts.length > 0) {
      const optIds = new Set(opts.map((o) => o.id));

      if (param.restrictions?.multipleChoices && Array.isArray(entry.value)) {
        const validIds = (entry.value as string[]).filter((id) => optIds.has(String(id)));
        if (validIds.length > 0) {
          filled[parameterId] = validIds;
          details.push({ parameterId, value: validIds, confidence, source });
        }
      } else {
        const val = String(entry.value ?? '');
        if (optIds.has(val)) {
          filled[parameterId] = val;
          details.push({ parameterId, value: val, confidence, source });
        }
      }
      continue;
    }

    if (param.type === 'integer' || param.type === 'float') {
      const numStr = String(entry.value ?? '');
      const num = parseFloat(numStr.replace(',', '.'));
      if (isNaN(num)) continue;

      if (param.restrictions?.min !== undefined && num < param.restrictions.min) continue;
      if (param.restrictions?.max !== undefined && num > param.restrictions.max) continue;

      const finalStr = param.type === 'integer' ? String(Math.round(num)) : String(num);
      filled[parameterId] = finalStr;
      details.push({ parameterId, value: finalStr, confidence, source });
      continue;
    }

    if (param.type === 'boolean') {
      const val = String(entry.value ?? '').toLowerCase();
      if (val === 'true' || val === 'false') {
        filled[parameterId] = val;
        details.push({ parameterId, value: val, confidence, source });
      }
      continue;
    }

    if (param.type === 'string') {
      const val = String(entry.value ?? '');
      if (!val) continue;

      // Verify the value exists in product data (anti-hallucination)
      const normVal = normalizePolish(val);
      if (normVal.length > 2 && !productText.includes(normVal)) {
        // Check individual words — allow if at least 60% of words match
        const words = normVal.split(/\s+/).filter((w) => w.length > 2);
        const matchCount = words.filter((w) => productText.includes(w)).length;
        if (words.length > 0 && matchCount / words.length < 0.6) continue;
      }

      filled[parameterId] = val;
      details.push({ parameterId, value: val, confidence, source });
      continue;
    }

    // date/datetime — pass through
    if (param.type === 'date' || param.type === 'datetime') {
      const val = String(entry.value ?? '');
      if (val) {
        filled[parameterId] = val;
        details.push({ parameterId, value: val, confidence, source });
      }
    }
  }

  // Compute unfilled
  const allUnfilledIds = parameters
    .filter((p) => !filled[p.id])
    .map((p) => p.id);

  return { filled, details, unfilled: allUnfilledIds };
}
