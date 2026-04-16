import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { BLProductListItem, BatchStatus, BatchItemStatus, BatchType, BatchJob, BatchJobItem, BatchJobProgress, SellerScrapeSession, SellerScrapedListing, ListingProduct, ProductData } from './types';

const DB_PATH = path.join(process.cwd(), 'tmp', 'sheets.db');
const PRODUCT_LIST_CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes

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
      extra_columns       TEXT,

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

  // Migration: add extra_columns if missing (for existing DBs)
  const cols = _db.pragma('table_info(sheet_products)') as { name: string }[];
  if (!cols.some((c) => c.name === 'extra_columns')) {
    _db.exec('ALTER TABLE sheet_products ADD COLUMN extra_columns TEXT');
  }
  if (!cols.some((c) => c.name === 'scraped_data')) {
    _db.exec('ALTER TABLE sheet_products ADD COLUMN scraped_data TEXT');
  }
  if (!cols.some((c) => c.name === 'workflow_session')) {
    _db.exec('ALTER TABLE sheet_products ADD COLUMN workflow_session TEXT');
  }

  // ─── Product list cache tables ───
  _db.exec(`
    CREATE TABLE IF NOT EXISTS bl_product_list_cache (
      id              TEXT PRIMARY KEY,
      name            TEXT,
      ean             TEXT,
      sku             TEXT,
      quantity        INTEGER DEFAULT 0,
      product_type    TEXT DEFAULT 'basic',
      parent_id       TEXT,
      is_bundle       INTEGER DEFAULT 0,
      inventory_id    INTEGER NOT NULL
    );
  `);

  _db.exec(`
    CREATE TABLE IF NOT EXISTS cache_meta (
      key       TEXT PRIMARY KEY,
      value     TEXT,
      timestamp TEXT NOT NULL
    );
  `);

  // ─── Batch jobs tables ───
  _db.exec(`
    CREATE TABLE IF NOT EXISTS batch_jobs (
      id                   TEXT PRIMARY KEY,
      source               TEXT NOT NULL,
      source_id            TEXT,
      label                TEXT NOT NULL,
      status               TEXT DEFAULT 'pending'
                           CHECK(status IN ('pending','running','paused','done','error')),
      batch_type           TEXT DEFAULT 'independent'
                           CHECK(batch_type IN ('independent','variants')),
      template_session     TEXT NOT NULL,
      diff_fields          TEXT,
      description_template TEXT,
      title_template       TEXT,
      total_items          INTEGER DEFAULT 0,
      completed_items      INTEGER DEFAULT 0,
      failed_items         INTEGER DEFAULT 0,
      parent_product_id    TEXT,
      last_activity        TEXT,
      created_at           TEXT DEFAULT (datetime('now')),
      updated_at           TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS batch_job_items (
      id                TEXT PRIMARY KEY,
      batch_job_id      TEXT NOT NULL REFERENCES batch_jobs(id) ON DELETE CASCADE,
      order_index       INTEGER NOT NULL,
      status            TEXT DEFAULT 'pending'
                        CHECK(status IN ('pending','processing','done','error','skipped')),
      product_data      TEXT NOT NULL,
      bl_product_id     TEXT,
      error_message     TEXT,
      override_data     TEXT,
      label             TEXT,
      thumbnail_url     TEXT,
      source_listing_id TEXT,
      created_at        TEXT DEFAULT (datetime('now')),
      updated_at        TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_batch_items_job ON batch_job_items(batch_job_id);
  `);

  // ─── Seller scraper tables ───
  _db.exec(`
    CREATE TABLE IF NOT EXISTS seller_scrape_sessions (
      id              TEXT PRIMARY KEY,
      seller_url      TEXT NOT NULL,
      seller_username TEXT NOT NULL,
      site_hostname   TEXT NOT NULL,
      query_filter    TEXT,
      status          TEXT DEFAULT 'pending'
                      CHECK(status IN ('pending','scraping','done','error')),
      total_pages     INTEGER DEFAULT 0,
      scraped_pages   INTEGER DEFAULT 0,
      total_products  INTEGER DEFAULT 0,
      error_message   TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS seller_scraped_listings (
      id                TEXT PRIMARY KEY,
      session_id        TEXT NOT NULL REFERENCES seller_scrape_sessions(id) ON DELETE CASCADE,
      product_url       TEXT NOT NULL,
      product_id_ext    TEXT,
      title             TEXT NOT NULL,
      thumbnail_url     TEXT,
      price             TEXT,
      currency          TEXT DEFAULT 'PLN',
      page_number       INTEGER DEFAULT 1,
      selected          INTEGER DEFAULT 0,
      group_name        TEXT,
      deep_scraped      INTEGER DEFAULT 0,
      deep_scrape_data  TEXT,
      deep_scrape_error TEXT,
      created_at        TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_seller_listings_session ON seller_scraped_listings(session_id);
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
  extra_columns: string | null;
  scrape_url: string;
  status: SheetProductStatus;
  bl_product_id: string | null;
  error_message: string | null;
  category_id: string | null;
  scraped_data: string | null;
  workflow_session: string | null;
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
  extraColumns?: Record<string, string>;
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
      szerokosc, wysokosc, zdjecie, lokalizacja, extra_columns, last_synced
    ) VALUES (
      @id, @row_index, @sku, @nazwa, @model, @ean, @rozmiar_gabaryt,
      @stan_techniczny, @opakowanie, @czy_wiecej_kartonow, @kolor,
      @uwagi_krotkie, @uwagi_magazynowe, @paleta, @waga, @dlugosc,
      @szerokosc, @wysokosc, @zdjecie, @lokalizacja, @extra_columns, @last_synced
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
      extra_columns       = excluded.extra_columns,
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
        extra_columns: row.extraColumns && Object.keys(row.extraColumns).length > 0
          ? JSON.stringify(row.extraColumns)
          : null,
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
  extra?: { error_message?: string; bl_product_id?: string; scraped_data?: string }
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
  if (extra?.scraped_data !== undefined) {
    sets.push('scraped_data = @scraped_data');
    params.scraped_data = extra.scraped_data;
  }

  db.prepare(`UPDATE sheet_products SET ${sets.join(', ')} WHERE id = @id`).run(params);
}

export function markDone(id: string, blProductId: string): void {
  setProductStatus(id, 'done', { bl_product_id: blProductId, error_message: undefined });
}

export function saveWorkflowSession(id: string, sessionJson: string): void {
  const db = getDb();
  db.prepare(`UPDATE sheet_products SET workflow_session = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(sessionJson, id);
}

export function getWorkflowSession(id: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT workflow_session FROM sheet_products WHERE id = ?').get(id) as { workflow_session: string | null } | undefined;
  return row?.workflow_session ?? null;
}

export function resetAllProducts(): void {
  const db = getDb();
  db.prepare(`
    UPDATE sheet_products SET
      status = 'new',
      scrape_url = '',
      bl_product_id = NULL,
      error_message = NULL,
      category_id = NULL,
      updated_at = datetime('now')
  `).run();
}

export function resetProduct(id: string): SheetProductRow | undefined {
  const db = getDb();
  db.prepare(`
    UPDATE sheet_products SET
      status = 'new',
      scrape_url = '',
      bl_product_id = NULL,
      error_message = NULL,
      category_id = NULL,
      updated_at = datetime('now')
    WHERE id = @id
  `).run({ id });
  return getProductById(id);
}

// ─── BL Product List Cache ───

export function getCachedProductList(inventoryId: number): { products: BLProductListItem[]; cachedAt: string } | null {
  const db = getDb();
  const meta = db.prepare(
    `SELECT timestamp FROM cache_meta WHERE key = 'bl_product_list'`
  ).get() as { timestamp: string } | undefined;

  if (!meta) return null;

  const age = Date.now() - new Date(meta.timestamp).getTime();
  if (age > PRODUCT_LIST_CACHE_TTL_MS) return null;

  const rows = db.prepare(
    `SELECT * FROM bl_product_list_cache WHERE inventory_id = ?`
  ).all(inventoryId) as Array<{
    id: string; name: string; ean: string; sku: string;
    quantity: number; product_type: string; parent_id: string | null;
    is_bundle: number; inventory_id: number;
  }>;

  if (rows.length === 0) return null;

  const products: BLProductListItem[] = rows.map((r) => ({
    id: r.id,
    name: r.name ?? '',
    ean: r.ean ?? '',
    sku: r.sku ?? '',
    quantity: r.quantity ?? 0,
    price: 0,
    thumbnailUrl: null,
    manufacturerId: 0,
    manufacturerName: '',
    productType: r.product_type as BLProductListItem['productType'],
    parentId: r.parent_id ?? undefined,
    isBundle: r.is_bundle === 1,
  }));

  return { products, cachedAt: meta.timestamp };
}

export function setCachedProductList(inventoryId: number, products: BLProductListItem[]): void {
  const db = getDb();
  const now = new Date().toISOString();

  const insert = db.prepare(`
    INSERT OR REPLACE INTO bl_product_list_cache
      (id, name, ean, sku, quantity, product_type, parent_id, is_bundle, inventory_id)
    VALUES (@id, @name, @ean, @sku, @quantity, @product_type, @parent_id, @is_bundle, @inventory_id)
  `);

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM bl_product_list_cache WHERE inventory_id = ?').run(inventoryId);

    for (const p of products) {
      insert.run({
        id: p.id,
        name: p.name,
        ean: p.ean,
        sku: p.sku,
        quantity: p.quantity,
        product_type: p.productType,
        parent_id: p.parentId ?? null,
        is_bundle: p.isBundle ? 1 : 0,
        inventory_id: inventoryId,
      });
    }

    db.prepare(`
      INSERT OR REPLACE INTO cache_meta (key, value, timestamp)
      VALUES ('bl_product_list', @value, @timestamp)
    `).run({ value: String(inventoryId), timestamp: now });
  });

  tx();
}

export function invalidateProductListCache(): void {
  const db = getDb();
  db.prepare('DELETE FROM bl_product_list_cache').run();
  db.prepare(`DELETE FROM cache_meta WHERE key = 'bl_product_list'`).run();
}

// ─── Batch Jobs CRUD ───

export interface CreateBatchJobOpts {
  source: string;
  sourceId?: string;
  label: string;
  batchType: BatchType;
  templateSession: string; // JSON
  diffFields?: string;     // JSON string[]
  descriptionTemplate?: string; // JSON
  titleTemplate?: string;
  totalItems: number;
}

export function createBatchJob(opts: CreateBatchJobOpts): string {
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO batch_jobs (id, source, source_id, label, status, batch_type, template_session, diff_fields, description_template, title_template, total_items)
    VALUES (@id, @source, @source_id, @label, 'pending', @batch_type, @template_session, @diff_fields, @description_template, @title_template, @total_items)
  `).run({
    id,
    source: opts.source,
    source_id: opts.sourceId ?? null,
    label: opts.label,
    batch_type: opts.batchType,
    template_session: opts.templateSession,
    diff_fields: opts.diffFields ?? null,
    description_template: opts.descriptionTemplate ?? null,
    title_template: opts.titleTemplate ?? null,
    total_items: opts.totalItems,
  });
  return id;
}

function rowToBatchJob(row: Record<string, unknown>): BatchJob {
  const parseJson = (val: unknown, fallback: unknown) => {
    if (!val) return fallback;
    try { return JSON.parse(val as string); } catch { return fallback; }
  };
  return {
    id: row.id as string,
    source: row.source as string,
    sourceId: row.source_id as string | undefined,
    label: row.label as string,
    status: row.status as BatchStatus,
    batchType: row.batch_type as BatchType,
    templateSession: parseJson(row.template_session, {}),
    diffFields: parseJson(row.diff_fields, []),
    descriptionTemplate: row.description_template ? parseJson(row.description_template, undefined) : undefined,
    titleTemplate: row.title_template as string | undefined,
    totalItems: row.total_items as number,
    completedItems: row.completed_items as number,
    failedItems: row.failed_items as number,
    parentProductId: row.parent_product_id as string | undefined,
    lastActivity: row.last_activity as string | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function getBatchJob(id: string): BatchJob | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM batch_jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToBatchJob(row) : null;
}

export function getAllBatchJobs(opts?: { status?: string; source?: string }): BatchJob[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts?.status) { conditions.push('status = ?'); params.push(opts.status); }
  if (opts?.source) { conditions.push('source = ?'); params.push(opts.source); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM batch_jobs ${where} ORDER BY created_at DESC`).all(...params) as Record<string, unknown>[];
  return rows.map(rowToBatchJob);
}

export function updateBatchJob(id: string, patch: Partial<{
  status: BatchStatus;
  completedItems: number;
  failedItems: number;
  parentProductId: string;
  lastActivity: string;
  totalItems: number;
}>): void {
  const db = getDb();
  const sets: string[] = ["updated_at = datetime('now')"];
  const params: Record<string, unknown> = { id };
  if (patch.status !== undefined) { sets.push('status = @status'); params.status = patch.status; }
  if (patch.completedItems !== undefined) { sets.push('completed_items = @completed_items'); params.completed_items = patch.completedItems; }
  if (patch.failedItems !== undefined) { sets.push('failed_items = @failed_items'); params.failed_items = patch.failedItems; }
  if (patch.parentProductId !== undefined) { sets.push('parent_product_id = @parent_product_id'); params.parent_product_id = patch.parentProductId; }
  if (patch.lastActivity !== undefined) { sets.push('last_activity = @last_activity'); params.last_activity = patch.lastActivity; }
  if (patch.totalItems !== undefined) { sets.push('total_items = @total_items'); params.total_items = patch.totalItems; }
  db.prepare(`UPDATE batch_jobs SET ${sets.join(', ')} WHERE id = @id`).run(params);
}

export function deleteBatchJob(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM batch_jobs WHERE id = ?').run(id);
}

export interface BatchItemInput {
  productData: string; // JSON
  label?: string;
  thumbnailUrl?: string;
  sourceListingId?: string;
  blProductId?: string; // Set for edit-mode batch jobs
}

export function createBatchJobItems(jobId: string, items: BatchItemInput[]): void {
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO batch_job_items (id, batch_job_id, order_index, product_data, label, thumbnail_url, source_listing_id, bl_product_id)
    VALUES (@id, @batch_job_id, @order_index, @product_data, @label, @thumbnail_url, @source_listing_id, @bl_product_id)
  `);
  const tx = db.transaction(() => {
    items.forEach((item, i) => {
      insert.run({
        id: crypto.randomUUID(),
        batch_job_id: jobId,
        order_index: i,
        product_data: item.productData,
        label: item.label ?? null,
        thumbnail_url: item.thumbnailUrl ?? null,
        source_listing_id: item.sourceListingId ?? null,
        bl_product_id: item.blProductId ?? null,
      });
    });
  });
  tx();
}

function rowToBatchJobItem(row: Record<string, unknown>): BatchJobItem {
  const parseJson = (val: unknown, fallback: unknown) => {
    if (!val) return fallback;
    try { return JSON.parse(val as string); } catch { return fallback; }
  };
  return {
    id: row.id as string,
    batchJobId: row.batch_job_id as string,
    orderIndex: row.order_index as number,
    status: row.status as BatchItemStatus,
    productData: parseJson(row.product_data, {}),
    blProductId: row.bl_product_id as string | undefined,
    errorMessage: row.error_message as string | undefined,
    overrideData: row.override_data ? parseJson(row.override_data, undefined) : undefined,
    label: row.label as string | undefined,
    thumbnailUrl: row.thumbnail_url as string | undefined,
    sourceListingId: row.source_listing_id as string | undefined,
  };
}

export function getBatchJobItems(jobId: string): BatchJobItem[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM batch_job_items WHERE batch_job_id = ? ORDER BY order_index ASC').all(jobId) as Record<string, unknown>[];
  return rows.map(rowToBatchJobItem);
}

export function getNextPendingItem(jobId: string): BatchJobItem | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT * FROM batch_job_items WHERE batch_job_id = ? AND status = 'pending' ORDER BY order_index ASC LIMIT 1`
  ).get(jobId) as Record<string, unknown> | undefined;
  return row ? rowToBatchJobItem(row) : null;
}

export function updateBatchJobItem(itemId: string, patch: Partial<{
  status: BatchItemStatus;
  blProductId: string;
  errorMessage: string;
  overrideData: string;
}>): void {
  const db = getDb();
  const sets: string[] = ["updated_at = datetime('now')"];
  const params: Record<string, unknown> = { id: itemId };
  if (patch.status !== undefined) { sets.push('status = @status'); params.status = patch.status; }
  if (patch.blProductId !== undefined) { sets.push('bl_product_id = @bl_product_id'); params.bl_product_id = patch.blProductId; }
  if (patch.errorMessage !== undefined) { sets.push('error_message = @error_message'); params.error_message = patch.errorMessage; }
  if (patch.overrideData !== undefined) { sets.push('override_data = @override_data'); params.override_data = patch.overrideData; }
  db.prepare(`UPDATE batch_job_items SET ${sets.join(', ')} WHERE id = @id`).run(params);
}

export function getBatchJobProgress(jobId: string): BatchJobProgress {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status IN ('pending','processing') THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped
    FROM batch_job_items WHERE batch_job_id = ?
  `).get(jobId) as { total: number; done: number; failed: number; pending: number; skipped: number };
  return {
    total: row.total ?? 0,
    done: row.done ?? 0,
    failed: row.failed ?? 0,
    pending: row.pending ?? 0,
    skipped: row.skipped ?? 0,
  };
}

export function retryFailedItems(jobId: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE batch_job_items SET status = 'pending', error_message = NULL, updated_at = datetime('now')
    WHERE batch_job_id = ? AND status = 'error'
  `).run(jobId);
}

// ─── Seller Scraper CRUD ───

function rowToSellerSession(row: Record<string, unknown>): SellerScrapeSession {
  return {
    id: row.id as string,
    sellerUrl: row.seller_url as string,
    sellerUsername: row.seller_username as string,
    siteHostname: row.site_hostname as string,
    queryFilter: row.query_filter as string | undefined,
    status: row.status as SellerScrapeSession['status'],
    totalPages: row.total_pages as number,
    scrapedPages: row.scraped_pages as number,
    totalProducts: row.total_products as number,
    errorMessage: row.error_message as string | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function createSellerSession(opts: {
  sellerUrl: string;
  sellerUsername: string;
  siteHostname: string;
  queryFilter?: string;
}): string {
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO seller_scrape_sessions (id, seller_url, seller_username, site_hostname, query_filter)
    VALUES (@id, @seller_url, @seller_username, @site_hostname, @query_filter)
  `).run({
    id,
    seller_url: opts.sellerUrl,
    seller_username: opts.sellerUsername,
    site_hostname: opts.siteHostname,
    query_filter: opts.queryFilter ?? null,
  });
  return id;
}

export function getSellerSession(id: string): SellerScrapeSession | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM seller_scrape_sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToSellerSession(row) : null;
}

export function getAllSellerSessions(): SellerScrapeSession[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM seller_scrape_sessions ORDER BY created_at DESC').all() as Record<string, unknown>[];
  return rows.map(rowToSellerSession);
}

export function updateSellerSession(id: string, patch: Partial<{
  status: SellerScrapeSession['status'];
  totalPages: number;
  scrapedPages: number;
  totalProducts: number;
  errorMessage: string;
}>): void {
  const db = getDb();
  const sets: string[] = ["updated_at = datetime('now')"];
  const params: Record<string, unknown> = { id };
  if (patch.status !== undefined) { sets.push('status = @status'); params.status = patch.status; }
  if (patch.totalPages !== undefined) { sets.push('total_pages = @total_pages'); params.total_pages = patch.totalPages; }
  if (patch.scrapedPages !== undefined) { sets.push('scraped_pages = @scraped_pages'); params.scraped_pages = patch.scrapedPages; }
  if (patch.totalProducts !== undefined) { sets.push('total_products = @total_products'); params.total_products = patch.totalProducts; }
  if (patch.errorMessage !== undefined) { sets.push('error_message = @error_message'); params.error_message = patch.errorMessage; }
  db.prepare(`UPDATE seller_scrape_sessions SET ${sets.join(', ')} WHERE id = @id`).run(params);
}

export function deleteSellerSession(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM seller_scrape_sessions WHERE id = ?').run(id);
}

function rowToListing(row: Record<string, unknown>): SellerScrapedListing {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    productUrl: row.product_url as string,
    productIdExt: row.product_id_ext as string | undefined,
    title: row.title as string,
    thumbnailUrl: row.thumbnail_url as string | undefined,
    price: row.price as string | undefined,
    currency: (row.currency as string) ?? 'PLN',
    pageNumber: row.page_number as number,
    selected: (row.selected as number) === 1,
    groupName: row.group_name as string | undefined,
    deepScraped: (row.deep_scraped as number) === 1,
    deepScrapeData: row.deep_scrape_data ? JSON.parse(row.deep_scrape_data as string) : undefined,
    deepScrapeError: row.deep_scrape_error as string | undefined,
  };
}

export function insertListings(sessionId: string, products: ListingProduct[], pageNumber: number): void {
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO seller_scraped_listings
      (id, session_id, product_url, product_id_ext, title, thumbnail_url, price, currency, page_number)
    VALUES (@id, @session_id, @product_url, @product_id_ext, @title, @thumbnail_url, @price, @currency, @page_number)
  `);
  const tx = db.transaction(() => {
    for (const p of products) {
      insert.run({
        id: crypto.randomUUID(),
        session_id: sessionId,
        product_url: p.url,
        product_id_ext: p.externalId ?? null,
        title: p.title,
        thumbnail_url: p.thumbnailUrl ?? null,
        price: p.price ?? null,
        currency: p.currency ?? 'PLN',
        page_number: pageNumber,
      });
    }
  });
  tx();
}

export function getListings(sessionId: string): SellerScrapedListing[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM seller_scraped_listings WHERE session_id = ? ORDER BY page_number ASC, rowid ASC'
  ).all(sessionId) as Record<string, unknown>[];
  return rows.map(rowToListing);
}

export function updateListing(id: string, patch: Partial<{
  selected: boolean;
  groupName: string | null;
}>): void {
  const db = getDb();
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };
  if (patch.selected !== undefined) { sets.push('selected = @selected'); params.selected = patch.selected ? 1 : 0; }
  if (patch.groupName !== undefined) { sets.push('group_name = @group_name'); params.group_name = patch.groupName; }
  if (sets.length === 0) return;
  db.prepare(`UPDATE seller_scraped_listings SET ${sets.join(', ')} WHERE id = @id`).run(params);
}

export function batchToggleSelection(sessionId: string, opts: { listingIds?: string[]; all?: boolean; selected: boolean }): void {
  const db = getDb();
  const val = opts.selected ? 1 : 0;
  if (opts.all) {
    db.prepare('UPDATE seller_scraped_listings SET selected = ? WHERE session_id = ?').run(val, sessionId);
  } else if (opts.listingIds && opts.listingIds.length > 0) {
    const placeholders = opts.listingIds.map(() => '?').join(',');
    db.prepare(`UPDATE seller_scraped_listings SET selected = ? WHERE id IN (${placeholders})`).run(val, ...opts.listingIds);
  }
}

export function setListingGroup(listingId: string, groupName: string | null): void {
  const db = getDb();
  db.prepare('UPDATE seller_scraped_listings SET group_name = ? WHERE id = ?').run(groupName, listingId);
}

export function updateDeepScrape(listingId: string, result: { data?: ProductData; error?: string }): void {
  const db = getDb();
  db.prepare(`
    UPDATE seller_scraped_listings SET
      deep_scraped = 1,
      deep_scrape_data = @data,
      deep_scrape_error = @error
    WHERE id = @id
  `).run({
    id: listingId,
    data: result.data ? JSON.stringify(result.data) : null,
    error: result.error ?? null,
  });
}
