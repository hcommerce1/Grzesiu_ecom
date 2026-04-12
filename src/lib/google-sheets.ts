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
 * Fetch all product rows from the configured Google Sheet.
 * Reads columns A-V starting from row 2 (skips header).
 * Identifies the sheet tab by gid (GOOGLE_SHEETS_SHEET_GID) instead of name.
 */
export async function fetchAllRows(): Promise<SheetRowInput[]> {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const spreadsheetId = getSpreadsheetId();
  const gid = getSheetGid();
  const sheetName = await resolveSheetNameByGid(sheets, spreadsheetId, gid);
  const range = `'${sheetName}'!A2:V`;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const rawRows = response.data.values;
  if (!rawRows || rawRows.length === 0) return [];

  const results: SheetRowInput[] = [];

  for (let index = 0; index < rawRows.length; index++) {
    const row = rawRows[index];

    const cell = (i: number): string | undefined => {
      const v = row[i];
      if (v == null) return undefined;
      const s = String(v).trim();
      return s || undefined;
    };

    // Skip completely empty rows
    const hasAnyData = row.some((v: unknown) => v != null && String(v).trim() !== '');
    if (!hasAnyData) continue;

    // Use column A as ID if present, otherwise fall back to row number
    const id = cell(0) ?? `row-${index + 2}`;

    results.push({
      id,
      rowIndex: index + 2, // 1-based, +1 for header
      sku: cell(1),
      nazwa: cell(2),
      model: cell(3),
      ean: cell(4),
      rozmiarGabaryt: cell(5),
      stanTechniczny: cell(6),
      opakowanie: cell(7),
      czyWiecejKartonow: cell(8),
      kolor: cell(9),
      uwagiKrotkie: cell(10),
      uwagiMagazynowe: cell(11),
      paleta: cell(12),
      waga: cell(13),
      dlugosc: cell(14),
      szerokosc: cell(15),
      wysokosc: cell(16),
      zdjecie: cell(17),
      // Column S (18) = Status, T (19) = Data Dodania — ignored
      lokalizacja: cell(20),
      // Column V (21) = Data Dodania do Lokalizacji — ignored
    });
  }

  return results;
}
