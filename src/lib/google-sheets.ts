import { google } from 'googleapis';
import type { SheetRowInput } from './db';

function getAuth() {
  const credPath = process.env.GOOGLE_SHEETS_CREDENTIALS_PATH;

  if (!credPath) {
    throw new Error(
      'Google Sheets credentials not configured. Set GOOGLE_SHEETS_CREDENTIALS_PATH.'
    );
  }

  return new google.auth.GoogleAuth({
    keyFile: credPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

function getSpreadsheetId(): string {
  const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!id) throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID not set in environment');
  return id;
}

function getSheetGid(): number {
  const raw = process.env.GOOGLE_SHEETS_SHEET_GID;
  if (raw == null || raw === '') return 0;
  const gid = Number(raw);
  if (Number.isNaN(gid)) throw new Error(`GOOGLE_SHEETS_SHEET_GID is not a valid number: ${raw}`);
  return gid;
}

/**
 * Resolve sheet tab name by its gid (sheetId).
 * Google Sheets values.get requires A1 notation with the tab name,
 * so we first fetch sheet metadata and find the tab matching the gid.
 */
async function resolveSheetNameByGid(
  sheetsApi: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  gid: number
): Promise<string> {
  const meta = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
  });

  const sheet = meta.data.sheets?.find(
    (s) => s.properties?.sheetId === gid
  );

  if (!sheet?.properties?.title) {
    throw new Error(
      `Sheet with gid=${gid} not found in spreadsheet ${spreadsheetId}`
    );
  }

  return sheet.properties.title;
}

/**
 * Normalize a header string for fuzzy matching:
 * lowercase, trim, strip diacritics, collapse whitespace.
 */
function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Map of normalized header names → SheetRowInput field keys.
 * Supports multiple variations of the same header.
 */
const HEADER_FIELD_MAP: Record<string, keyof Omit<SheetRowInput, 'id' | 'rowIndex' | 'extraColumns'>> = {
  'id': 'id' as never, // special — handled separately
  'sku': 'sku',
  'nazwa': 'nazwa',
  'model': 'model',
  'ean': 'ean',
  'rozmiar/gabaryt': 'rozmiarGabaryt',
  'rozmiar gabaryt': 'rozmiarGabaryt',
  'rozmiar': 'rozmiarGabaryt',
  'gabaryt': 'rozmiarGabaryt',
  'stan techniczny': 'stanTechniczny',
  'stan': 'stanTechniczny',
  'opakowanie': 'opakowanie',
  'czy wiecej kartonow': 'czyWiecejKartonow',
  'czy wiecej kartonów': 'czyWiecejKartonow',
  'kolor': 'kolor',
  'uwagi krotkie': 'uwagiKrotkie',
  'uwagi': 'uwagiKrotkie',
  'uwagi magazynowe': 'uwagiMagazynowe',
  'paleta': 'paleta',
  'waga': 'waga',
  'dlugosc': 'dlugosc',
  'dl': 'dlugosc',
  'szerokosc': 'szerokosc',
  'szer': 'szerokosc',
  'wysokosc': 'wysokosc',
  'wys': 'wysokosc',
  'zdjecie': 'zdjecie',
  'zdjecia': 'zdjecie',
  'zdjecia wszystkie': 'zdjecie',
  'zdjęcia': 'zdjecie',
  'zdjęcia wszystkie': 'zdjecie',
  'foto': 'zdjecie',
  'lokalizacja': 'lokalizacja',
};

/** Headers to always ignore (app-managed columns). */
const IGNORED_HEADERS = new Set([
  'status', 'data dodania', 'data dodania do lokalizacji',
]);

function resolveImageFormula(raw: string): string {
  const m = raw.match(/=IMAGE\("([^"]+)"/i);
  return m ? m[1] : raw;
}

/**
 * Fetch all product rows from the configured Google Sheet.
 * Dynamically reads headers from row 1 and maps columns accordingly.
 * Unknown columns are stored in extraColumns.
 */
export async function fetchAllRows(): Promise<SheetRowInput[]> {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const spreadsheetId = getSpreadsheetId();
  const gid = getSheetGid();
  const sheetName = await resolveSheetNameByGid(sheets, spreadsheetId, gid);
  const range = `'${sheetName}'!A1:ZZ`;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const rawRows = response.data.values;
  if (!rawRows || rawRows.length < 2) return [];

  // --- Parse headers from row 1 ---
  const headerRow = rawRows[0];
  const columnMapping: { index: number; field: keyof SheetRowInput | null; rawHeader: string }[] = [];

  for (let i = 0; i < headerRow.length; i++) {
    const raw = String(headerRow[i] ?? '').trim();
    if (!raw) continue;

    const norm = normalizeHeader(raw);

    if (IGNORED_HEADERS.has(norm)) {
      columnMapping.push({ index: i, field: null, rawHeader: raw });
      continue;
    }

    const mapped = HEADER_FIELD_MAP[norm];
    if (mapped) {
      columnMapping.push({ index: i, field: mapped as keyof SheetRowInput, rawHeader: raw });
    } else {
      // Unknown column → will go to extraColumns
      columnMapping.push({ index: i, field: null, rawHeader: raw });
    }
  }

  // Find the ID column index (first column mapped to 'id', or column 0)
  const idMapping = columnMapping.find((m) => m.field === ('id' as never));
  const idColIndex = idMapping?.index ?? 0;

  // --- Parse data rows ---
  const results: SheetRowInput[] = [];

  for (let rowIdx = 1; rowIdx < rawRows.length; rowIdx++) {
    const row = rawRows[rowIdx];

    const cellAt = (i: number): string | undefined => {
      const v = row[i];
      if (v == null) return undefined;
      const s = String(v).trim();
      return s || undefined;
    };

    // Skip completely empty rows
    const hasAnyData = row.some((v: unknown) => v != null && String(v).trim() !== '');
    if (!hasAnyData) continue;

    const id = cellAt(idColIndex) ?? `row-${rowIdx + 1}`;

    const entry: SheetRowInput = {
      id,
      rowIndex: rowIdx + 1, // 1-based sheet row number
    };

    const extras: Record<string, string> = {};

    for (const col of columnMapping) {
      const val = cellAt(col.index);
      if (!val) continue;

      if (col.field && col.field !== ('id' as never)) {
        const resolved = col.field === 'zdjecie' ? resolveImageFormula(val) : val;
        (entry as unknown as Record<string, unknown>)[col.field] = resolved;
      } else if (!col.field && !IGNORED_HEADERS.has(normalizeHeader(col.rawHeader))) {
        extras[col.rawHeader] = val;
      }
    }

    if (Object.keys(extras).length > 0) {
      entry.extraColumns = extras;
    }

    results.push(entry);
  }

  return results;
}
