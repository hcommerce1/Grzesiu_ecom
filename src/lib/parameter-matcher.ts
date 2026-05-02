import type { AllegroParameter, ParameterMatchResult, SheetMeta } from './types';

// ─── Polish character normalization ───

export function normalizePolish(s: string): string {
  return s
    .toLowerCase()
    .replace(/ą/g, 'a')
    .replace(/ć/g, 'c')
    .replace(/ę/g, 'e')
    .replace(/ł/g, 'l')
    .replace(/ń/g, 'n')
    .replace(/ó/g, 'o')
    .replace(/ś/g, 's')
    .replace(/ź/g, 'z')
    .replace(/ż/g, 'z')
    .trim();
}

// ─── Levenshtein distance ───

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}

// ─── Column → Parameter name mapping ───

// Wymiary (waga/dlugosc/szerokosc/wysokosc) celowo pomijane — dane z arkusza to wymiary kartonu,
// nie produktu. Trafiają wyłącznie do pól natywnych BL, nie do parametrów Allegro.
const COLUMN_PARAM_MAP: Record<string, string[]> = {
  stanTechniczny: ['stan'],
  kolor: ['kolor'],
  opakowanie: ['opakowanie'],
  rozmiarGabaryt: ['rozmiar', 'gabaryt', 'wymiar'],
  model: ['model'],
};

// ─── Unit conversion helpers ───

const UNIT_CONVERSIONS: Record<string, Record<string, number>> = {
  kg: { g: 1000, kg: 1 },
  g: { kg: 0.001, g: 1 },
  cm: { mm: 10, cm: 1, m: 0.01 },
  mm: { cm: 0.1, mm: 1, m: 0.001 },
  m: { cm: 100, mm: 1000, m: 1 },
};

// Default assumed units for sheet columns
const COLUMN_ASSUMED_UNITS: Record<string, string> = {
  waga: 'kg',
  dlugosc: 'cm',
  szerokosc: 'cm',
  wysokosc: 'cm',
};

function convertValue(value: number, fromUnit: string, toUnit: string): number | null {
  const from = fromUnit.toLowerCase();
  const to = toUnit.toLowerCase();
  if (from === to) return value;
  const table = UNIT_CONVERSIONS[from];
  if (!table || table[to] === undefined) return null;
  return value * table[to];
}

// ─── Find matching Allegro parameter for a sheet column ───

function findParameterForColumn(
  column: string,
  parameters: AllegroParameter[]
): AllegroParameter | null {
  const searchTerms = COLUMN_PARAM_MAP[column];
  if (!searchTerms) return null;

  for (const term of searchTerms) {
    const normTerm = normalizePolish(term);
    const match = parameters.find((p) => {
      const normName = normalizePolish(p.name);
      return normName.includes(normTerm);
    });
    if (match) return match;
  }

  // For weight/dimension columns, also match by unit
  const assumedUnit = COLUMN_ASSUMED_UNITS[column];
  if (assumedUnit) {
    const unitMatch = parameters.find(
      (p) => p.unit && p.unit.toLowerCase() === assumedUnit && p.type !== 'dictionary'
    );
    if (unitMatch) return unitMatch;
  }

  return null;
}

// ─── Match a sheet value to a dictionary parameter option ───

function matchDictionaryValue(
  sheetValue: string,
  options: { id: string; value: string }[]
): { optionId: string; optionValue: string; confidence: number; matchType: ParameterMatchResult['matchType'] } | null {
  if (!sheetValue || options.length === 0) return null;

  // 1. Exact match
  const exact = options.find((o) => o.value === sheetValue);
  if (exact) return { optionId: exact.id, optionValue: exact.value, confidence: 1.0, matchType: 'exact' };

  // 2. Normalized match
  const normSheet = normalizePolish(sheetValue);
  const normalized = options.find((o) => normalizePolish(o.value) === normSheet);
  if (normalized) return { optionId: normalized.id, optionValue: normalized.value, confidence: 0.95, matchType: 'normalized' };

  // 3. Contains match (one contains the other)
  const contains = options.find((o) => {
    const normOpt = normalizePolish(o.value);
    return normOpt.includes(normSheet) || normSheet.includes(normOpt);
  });
  if (contains) return { optionId: contains.id, optionValue: contains.value, confidence: 0.8, matchType: 'contains' };

  // 4. Fuzzy match (Levenshtein)
  let bestFuzzy: { id: string; value: string; distance: number } | null = null;
  for (const opt of options) {
    const normOpt = normalizePolish(opt.value);
    const dist = levenshtein(normSheet, normOpt);
    const maxLen = Math.max(normSheet.length, normOpt.length);
    const ratio = maxLen > 0 ? dist / maxLen : 1;

    if (ratio < 0.3 && (!bestFuzzy || dist < bestFuzzy.distance)) {
      bestFuzzy = { id: opt.id, value: opt.value, distance: dist };
    }
  }
  if (bestFuzzy) return { optionId: bestFuzzy.id, optionValue: bestFuzzy.value, confidence: 0.7, matchType: 'fuzzy' };

  return null;
}

// ─── Known SheetMeta fields (skip when looking for extra columns) ───

const KNOWN_SHEET_FIELDS = new Set<string>([
  'uwagiKrotkie', 'uwagiMagazynowe', 'zdjecie', 'paleta',
  'stanTechniczny', 'kolor', 'opakowanie', 'rozmiarGabaryt',
  'model', 'waga', 'dlugosc', 'szerokosc', 'wysokosc',
]);

// ─── Find parameter by column header name (for extra columns) ───

/**
 * Strict matching of a sheet header name to an Allegro parameter name.
 * Only returns a match if normalized similarity is >= 0.7.
 * Does NOT use COLUMN_PARAM_MAP — works purely from the raw header name.
 */
function findParameterByHeaderName(
  headerName: string,
  parameters: AllegroParameter[],
  alreadyMatchedIds: Set<string>
): AllegroParameter | null {
  const normHeader = normalizePolish(headerName);
  if (normHeader.length < 2) return null; // too short to match reliably

  // 1. Exact normalized match (highest confidence)
  const exact = parameters.find(
    (p) => !alreadyMatchedIds.has(p.id) && normalizePolish(p.name) === normHeader
  );
  if (exact) return exact;

  // 2. Contains match — parameter name contains header or vice versa
  //    Only if both are at least 3 chars (avoid "a" matching "masa")
  if (normHeader.length >= 3) {
    const contains = parameters.find((p) => {
      if (alreadyMatchedIds.has(p.id)) return false;
      const normName = normalizePolish(p.name);
      return normName.length >= 3 && (normName.includes(normHeader) || normHeader.includes(normName));
    });
    if (contains) return contains;
  }

  // 3. Levenshtein similarity >= 0.7
  let bestMatch: AllegroParameter | null = null;
  let bestSimilarity = 0;

  for (const p of parameters) {
    if (alreadyMatchedIds.has(p.id)) continue;
    const normName = normalizePolish(p.name);
    const maxLen = Math.max(normHeader.length, normName.length);
    if (maxLen === 0) continue;
    const dist = levenshtein(normHeader, normName);
    const similarity = 1 - dist / maxLen;

    if (similarity >= 0.7 && similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatch = p;
    }
  }

  return bestMatch;
}

/**
 * Safe dictionary match for extra columns — NO fuzzy matching on values.
 * Only exact, normalized, and contains matches are allowed.
 */
function matchDictionaryValueStrict(
  sheetValue: string,
  options: { id: string; value: string }[]
): { optionId: string; optionValue: string; confidence: number; matchType: ParameterMatchResult['matchType'] } | null {
  if (!sheetValue || options.length === 0) return null;

  // 1. Exact match
  const exact = options.find((o) => o.value === sheetValue);
  if (exact) return { optionId: exact.id, optionValue: exact.value, confidence: 1.0, matchType: 'exact' };

  // 2. Normalized match
  const normSheet = normalizePolish(sheetValue);
  const normalized = options.find((o) => normalizePolish(o.value) === normSheet);
  if (normalized) return { optionId: normalized.id, optionValue: normalized.value, confidence: 0.9, matchType: 'normalized' };

  // 3. Contains match (one contains the other, min 3 chars)
  if (normSheet.length >= 3) {
    const contains = options.find((o) => {
      const normOpt = normalizePolish(o.value);
      return normOpt.length >= 3 && (normOpt.includes(normSheet) || normSheet.includes(normOpt));
    });
    if (contains) return { optionId: contains.id, optionValue: contains.value, confidence: 0.8, matchType: 'contains' };
  }

  // NO fuzzy match — too risky for dynamic columns
  return null;
}

// ─── Main matching function ───

export interface MatchParametersResult {
  matchResults: ParameterMatchResult[];
  suggestedValues: Record<string, string | string[]>;
}

export function matchSheetToParameters(
  sheetMeta: SheetMeta,
  parameters: AllegroParameter[]
): MatchParametersResult {
  const matchResults: ParameterMatchResult[] = [];
  const suggestedValues: Record<string, string | string[]> = {};
  const matchedParamIds = new Set<string>();

  // ─── Phase 1: Known columns (existing behavior) ───

  // Wymiary (waga/dlugosc/szerokosc/wysokosc) celowo wykluczone — to wymiary kartonu,
  // trafiają wyłącznie do pól natywnych BL, nie do parametrów Allegro.
  const columnsToMatch: string[] = [
    'stanTechniczny',
    'kolor',
    'opakowanie',
    'rozmiarGabaryt',
    'model',
  ];

  for (const column of columnsToMatch) {
    const sheetValue = sheetMeta[column];
    if (!sheetValue || sheetValue.trim() === '') continue;

    const param = findParameterForColumn(column, parameters);
    if (!param) continue;

    matchedParamIds.add(param.id);

    // Dictionary type: match value to options
    if (param.type === 'dictionary' || param.dictionary?.length || (Array.isArray(param.options) && param.options.length)) {
      const opts = param.dictionary ?? (Array.isArray(param.options) ? param.options : null) ?? param.restrictions?.allowedValues ?? [];
      const match = matchDictionaryValue(sheetValue, opts);

      if (match) {
        matchResults.push({
          parameterId: param.id,
          parameterName: param.name,
          sheetColumn: column,
          sheetValue,
          matchedOptionId: match.optionId,
          matchedOptionValue: match.optionValue,
          confidence: match.confidence,
          matchType: match.matchType,
        });

        if (match.confidence >= 0.7) {
          suggestedValues[param.id] = param.restrictions?.multipleChoices
            ? [match.optionId]
            : match.optionId;
        }
      } else {
        matchResults.push({
          parameterId: param.id,
          parameterName: param.name,
          sheetColumn: column,
          sheetValue,
          matchedOptionId: null,
          matchedOptionValue: null,
          confidence: 0,
          matchType: 'none',
        });
      }
      continue;
    }

    // Numeric types (integer/float): direct value, with unit conversion
    if (param.type === 'integer' || param.type === 'float') {
      const numericValue = parseFloat(sheetValue.replace(',', '.'));
      if (isNaN(numericValue)) continue;

      let finalValue = numericValue;
      const assumedUnit = COLUMN_ASSUMED_UNITS[column];
      if (assumedUnit && param.unit) {
        const converted = convertValue(numericValue, assumedUnit, param.unit);
        if (converted !== null) finalValue = converted;
      }

      const valueStr = param.type === 'integer' ? String(Math.round(finalValue)) : String(finalValue);

      matchResults.push({
        parameterId: param.id,
        parameterName: param.name,
        sheetColumn: column,
        sheetValue,
        matchedOptionId: null,
        matchedOptionValue: valueStr,
        confidence: 1.0,
        matchType: 'direct',
      });

      suggestedValues[param.id] = valueStr;
      continue;
    }

    // String type: direct value
    if (param.type === 'string') {
      matchResults.push({
        parameterId: param.id,
        parameterName: param.name,
        sheetColumn: column,
        sheetValue,
        matchedOptionId: null,
        matchedOptionValue: sheetValue,
        confidence: 1.0,
        matchType: 'direct',
      });

      suggestedValues[param.id] = sheetValue;
    }
  }

  // ─── Phase 2: Extra/dynamic columns (cautious matching) ───
  // Only dictionary and numeric params get auto-suggested.
  // String params are reported as low-confidence suggestions (no auto-fill).
  // No fuzzy matching on dictionary values — only exact/normalized/contains.

  for (const key of Object.keys(sheetMeta)) {
    if (KNOWN_SHEET_FIELDS.has(key)) continue;

    const val = sheetMeta[key];
    if (!val || val.trim() === '') continue;

    const param = findParameterByHeaderName(key, parameters, matchedParamIds);
    if (!param) continue;

    matchedParamIds.add(param.id);

    // Dictionary type: strict matching (no fuzzy on values)
    if (param.type === 'dictionary' || param.dictionary?.length || (Array.isArray(param.options) && param.options.length)) {
      const opts = param.dictionary ?? (Array.isArray(param.options) ? param.options : null) ?? param.restrictions?.allowedValues ?? [];
      const match = matchDictionaryValueStrict(val, opts);

      if (match) {
        matchResults.push({
          parameterId: param.id,
          parameterName: param.name,
          sheetColumn: key,
          sheetValue: val,
          matchedOptionId: match.optionId,
          matchedOptionValue: match.optionValue,
          confidence: match.confidence,
          matchType: match.matchType,
        });

        // Higher threshold for extra columns: 0.8 instead of 0.7
        if (match.confidence >= 0.8) {
          suggestedValues[param.id] = param.restrictions?.multipleChoices
            ? [match.optionId]
            : match.optionId;
        }
      }
      continue;
    }

    // Numeric types: must be valid number, no unit conversion (units unknown)
    if (param.type === 'integer' || param.type === 'float') {
      const numericValue = parseFloat(val.replace(',', '.'));
      if (isNaN(numericValue)) continue;

      const valueStr = param.type === 'integer' ? String(Math.round(numericValue)) : String(numericValue);

      matchResults.push({
        parameterId: param.id,
        parameterName: param.name,
        sheetColumn: key,
        sheetValue: val,
        matchedOptionId: null,
        matchedOptionValue: valueStr,
        confidence: 0.85,
        matchType: 'direct',
      });

      suggestedValues[param.id] = valueStr;
      continue;
    }

    // String type: low-confidence suggestion only (no auto-fill)
    if (param.type === 'string') {
      matchResults.push({
        parameterId: param.id,
        parameterName: param.name,
        sheetColumn: key,
        sheetValue: val,
        matchedOptionId: null,
        matchedOptionValue: val,
        confidence: 0.5,
        matchType: 'direct',
      });
      // Deliberately NOT adding to suggestedValues — string params from
      // dynamic columns are too risky for auto-fill, shown as suggestion only
    }
  }

  return { matchResults, suggestedValues };
}
