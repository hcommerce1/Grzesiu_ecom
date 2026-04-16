/**
 * Filtrowanie wewnętrznych pól produktu przed przekazaniem do AI.
 * Pola pasujące do wzorców są usuwane z atrybutów przed generacją opisu i tytułu.
 *
 * ai-autofill jest celowo wyłączony z filtrowania — tam EAN/SKU mogą być potrzebne.
 */

const INTERNAL_FIELD_PATTERNS: RegExp[] = [
  // Identyfikatory wewnętrzne
  /\bean\b/i,
  /\bsku\b/i,
  /\bgtin\b/i,
  /\bmpn\b/i,
  /kod.*produc/i,
  /numer.*katalog/i,
  /numer.*sku/i,
  /kod.*ean/i,
  /numer.*art/i,
  /index.*produc/i,

  // Stany magazynowe i dostępność
  /stan.*magazyn/i,
  /\bilość\b/i,
  /\bilość\b/i,
  /dostępność/i,
  /stan.*handl/i,
  /w magazynie/i,

  // Logistyka i opakowania zbiorcze
  /\bpaleta\b/i,
  /\bpaczka\b/i,
  /waga.*netto/i,
  /waga.*brutto/i,
  /waga.*opak/i,
  /wymiary.*opak/i,
  /rozmiar.*paczk/i,
  /rozmiar.*kartonu/i,
  /ilość.*kartonie/i,
  /ilość.*opakowaniu/i,

  // Bundle / zestawy / wielopaki
  /\bbundle\b/i,
  /\bwielopak\b/i,
  /zestaw.*bundle/i,
  /\bzwiązak\b/i,
];

/**
 * Zwraca atrybuty produktu bez pól wewnętrznych nieistotnych dla opisu/tytułu.
 */
export function filterAttributesForAI(
  attributes: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(attributes).filter(
      ([key]) => !INTERNAL_FIELD_PATTERNS.some((pattern) => pattern.test(key))
    )
  );
}
