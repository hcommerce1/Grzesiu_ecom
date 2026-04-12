import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'tmp', 'sheets.db');

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS sheet_products (
      id                  TEXT PRIMARY KEY,
      row_index           INTEGER NOT NULL,
      sku                 TEXT,
      nazwa               TEXT,
      model               TEXT,
      ean                 TEXT,
      rozmiar_gabaryt     TEXT,
      stan_techniczny     TEXT,
      opakowanie          TEXT,
      czy_wiecej_kartonow TEXT,
      kolor               TEXT,
      uwagi_krotkie       TEXT,
      uwagi_magazynowe    TEXT,
      paleta              TEXT,
      waga                TEXT,
      dlugosc             TEXT,
      szerokosc           TEXT,
      wysokosc            TEXT,
      zdjecie             TEXT,
      lokalizacja         TEXT,

      scrape_url          TEXT DEFAULT '',
      status              TEXT DEFAULT 'new'
                          CHECK(status IN ('new','queued','scraping','in_progress','done','error')),
      bl_product_id       TEXT,
      error_message       TEXT,
      category_id         TEXT,
      last_synced         TEXT,
      created_at          TEXT DEFAULT (datetime('now')),
      updated_at          TEXT DEFAULT (datetime('now'))
    );
  `);

  return _db;
}

// ─── Types ───

export type SheetProductStatus = 'new' | 'queued' | 'scraping' | 'in_progress' | 'done' | 'error';

export interface SheetProductRow {
  id: string;
  row_index: number;
  sku: string | null;
  nazwa: string | null;
  model: string | null;
  ean: string | null;
  rozmiar_gabaryt: string | null;
  stan_techniczny: string | null;
  opakowanie: string | null;
  czy_wiecej_kartonow: string | null;
  kolor: string | null;
  uwagi_krotkie: string | null;
  uwagi_magazynowe: string | null;
  paleta: string | null;
  waga: string | null;
  dlugosc: string | null;
  szerokosc: string | null;
  wysokosc: string | null;
  zdjecie: string | null;
  lokalizacja: string | null;
  scrape_url: string;
  status: SheetProductStatus;
  bl_product_id: string | null;
  error_message: string | null;
  category_id: string | null;
  last_synced: string | null;
  created_at: string;
  updated_at: string;
}

// ─── CRUD ───

export function getAllProducts(): SheetProductRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM sheet_products
    ORDER BY
      CASE status
        WHEN 'in_progress' THEN 0
        WHEN 'scraping'    THEN 1
        WHEN 'queued'      THEN 2
        WHEN 'error'       THEN 3
        WHEN 'new'         THEN 4
        WHEN 'done'        THEN 5
      END,
      row_index ASC
  `).all() as SheetProductRow[];
}

export function getProductById(id: string): SheetProductRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM sheet_products WHERE id = ?').get(id) as SheetProductRow | undefined;
}

export function getProductsByStatus(status: SheetProductStatus): SheetProductRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM sheet_products WHERE status = ? ORDER BY row_index ASC').all(status) as SheetProductRow[];
}

export interface SheetRowInput {
  id: string;
  rowIndex: number;
  sku?: string;
  nazwa?: string;
  model?: string;
  ean?: string;
  rozmiarGabaryt?: string;
  stanTechniczny?: string;
  opakowanie?: string;
  czyWiecejKartonow?: string;
  kolor?: string;
  uwagiKrotkie?: string;
  uwagiMagazynowe?: string;
  paleta?: string;
  waga?: string;
  dlugosc?: string;
  szerokosc?: string;
  wysokosc?: string;
  zdjecie?: string;
  lokalizacja?: string;
}

/**
 * Upsert rows from Google Sheets into SQLite.
 * Inserts new rows, updates sheet data columns on existing rows,
 * but NEVER overwrites app-managed fields (scrape_url, status, bl_product_id, etc.)
 */
export function upsertFromSheet(rows: SheetRowInput[]): void {
  const db = getDb();
  const now = new Date().toISOString();

  const upsert = db.prepare(`
    INSERT INTO sheet_products (
      id, row_index, sku, nazwa, model, ean, rozmiar_gabaryt,
      stan_techniczny, opakowanie, czy_wiecej_kartonow, kolor,
      uwagi_krotkie, uwagi_magazynowe, paleta, waga, dlugosc,
      szerokosc, wysokosc, zdjecie, lokalizacja, last_synced
    ) VALUES (
      @id, @row_index, @sku, @nazwa, @model, @ean, @rozmiar_gabaryt,
      @stan_techniczny, @opakowanie, @czy_wiecej_kartonow, @kolor,
      @uwagi_krotkie, @uwagi_magazynowe, @paleta, @waga, @dlugosc,
      @szerokosc, @wysokosc, @zdjecie, @lokalizacja, @last_synced
    )
    ON CONFLICT(id) DO UPDATE SET
      row_index           = excluded.row_index,
      sku                 = excluded.sku,
      nazwa               = excluded.nazwa,
      model               = excluded.model,
      ean                 = excluded.ean,
      rozmiar_gabaryt     = excluded.rozmiar_gabaryt,
      stan_techniczny     = excluded.stan_techniczny,
      opakowanie          = excluded.opakowanie,
      czy_wiecej_kartonow = excluded.czy_wiecej_kartonow,
      kolor               = excluded.kolor,
      uwagi_krotkie       = excluded.uwagi_krotkie,
      uwagi_magazynowe    = excluded.uwagi_magazynowe,
      paleta              = excluded.paleta,
      waga                = excluded.waga,
      dlugosc             = excluded.dlugosc,
      szerokosc           = excluded.szerokosc,
      wysokosc            = excluded.wysokosc,
      zdjecie             = excluded.zdjecie,
      lokalizacja         = excluded.lokalizacja,
      last_synced         = excluded.last_synced,
      updated_at          = datetime('now')
  `);

  const removeStale = db.prepare(`
    DELETE FROM sheet_products
    WHERE id NOT IN (${rows.map(() => '?').join(',')})
      AND status IN ('new', 'error')
  `);

  const tx = db.transaction(() => {
    for (const row of rows) {
      upsert.run({
        id: row.id,
        row_index: row.rowIndex,
        sku: row.sku ?? null,
        nazwa: row.nazwa ?? null,
        model: row.model ?? null,
        ean: row.ean ?? null,
        rozmiar_gabaryt: row.rozmiarGabaryt ?? null,
        stan_techniczny: row.stanTechniczny ?? null,
        opakowanie: row.opakowanie ?? null,
        czy_wiecej_kartonow: row.czyWiecejKartonow ?? null,
        kolor: row.kolor ?? null,
        uwagi_krotkie: row.uwagiKrotkie ?? null,
        uwagi_magazynowe: row.uwagiMagazynowe ?? null,
        paleta: row.paleta ?? null,
        waga: row.waga ?? null,
        dlugosc: row.dlugosc ?? null,
        szerokosc: row.szerokosc ?? null,
        wysokosc: row.wysokosc ?? null,
        zdjecie: row.zdjecie ?? null,
        lokalizacja: row.lokalizacja ?? null,
        last_synced: now,
      });
    }

    // Remove products no longer in the sheet (only new/error — don't touch in-progress or done)
    if (rows.length > 0) {
      removeStale.run(...rows.map((r) => r.id));
    } else {
      // Sheet is empty — remove all new/error products
      db.prepare(`DELETE FROM sheet_products WHERE status IN ('new', 'error')`).run();
    }
  });

  tx();
}

export interface ProductPatch {
  scrape_url?: string;
  status?: SheetProductStatus;
  bl_product_id?: string;
  error_message?: string | null;
  category_id?: string;
}

export function updateProduct(id: string, patch: ProductPatch): SheetProductRow | undefined {
  const db = getDb();

  const sets: string[] = ['updated_at = datetime(\'now\')'];
  const params: Record<string, unknown> = { id };

  if (patch.scrape_url !== undefined) {
    sets.push('scrape_url = @scrape_url');
    params.scrape_url = patch.scrape_url;
  }
  if (patch.status !== undefined) {
    sets.push('status = @status');
    params.status = patch.status;
  }
  if (patch.bl_product_id !== undefined) {
    sets.push('bl_product_id = @bl_product_id');
    params.bl_product_id = patch.bl_product_id;
  }
  if (patch.error_message !== undefined) {
    sets.push('error_message = @error_message');
    params.error_message = patch.error_message;
  }
  if (patch.category_id !== undefined) {
    sets.push('category_id = @category_id');
    params.category_id = patch.category_id;
  }

  if (sets.length === 1) return getProductById(id); // nothing to update

  db.prepare(`UPDATE sheet_products SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return getProductById(id);
}

export function setProductStatus(
  id: string,
  status: SheetProductStatus,
  extra?: { error_message?: string; bl_product_id?: string }
): void {
  const db = getDb();
  const sets = ["status = @status", "updated_at = datetime('now')"];
  const params: Record<string, unknown> = { id, status };

  if (extra?.error_message !== undefined) {
    sets.push('error_message = @error_message');
    params.error_message = extra.error_message;
  }
  if (extra?.bl_product_id !== undefined) {
    sets.push('bl_product_id = @bl_product_id');
    params.bl_product_id = extra.bl_product_id;
  }

  db.prepare(`UPDATE sheet_products SET ${sets.join(', ')} WHERE id = @id`).run(params);
}

export function markDone(id: string, blProductId: string): void {
  setProductStatus(id, 'done', { bl_product_id: blProductId, error_message: undefined });
}
