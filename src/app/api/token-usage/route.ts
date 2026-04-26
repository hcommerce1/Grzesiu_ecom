import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(req: NextRequest) {
  const productId = req.nextUrl.searchParams.get('productId');
  const db = getDb();

  if (!productId) {
    const rows = db.prepare(`
      SELECT tool_name, model,
             SUM(input_tokens)       AS input_tokens,
             SUM(output_tokens)      AS output_tokens,
             SUM(cache_write_tokens) AS cache_write_tokens,
             SUM(cache_read_tokens)  AS cache_read_tokens,
             SUM(cost_usd)           AS cost_usd,
             SUM(cost_pln)           AS cost_pln
      FROM product_token_usage
      GROUP BY tool_name, model
      ORDER BY cost_pln DESC
    `).all();

    const totals = db.prepare(`
      SELECT SUM(input_tokens)  AS total_input,
             SUM(output_tokens) AS total_output,
             SUM(cost_usd)      AS total_usd,
             SUM(cost_pln)      AS total_pln
      FROM product_token_usage
    `).get();

    return NextResponse.json({ rows, totals });
  }

  const rows = db.prepare(`
    SELECT tool_name, model,
           SUM(input_tokens)       AS input_tokens,
           SUM(output_tokens)      AS output_tokens,
           SUM(cache_write_tokens) AS cache_write_tokens,
           SUM(cache_read_tokens)  AS cache_read_tokens,
           SUM(cost_usd)           AS cost_usd,
           SUM(cost_pln)           AS cost_pln
    FROM product_token_usage
    WHERE product_id = ?
    GROUP BY tool_name, model
    ORDER BY cost_pln DESC
  `).all(productId);

  const totals = db.prepare(`
    SELECT SUM(input_tokens)  AS total_input,
           SUM(output_tokens) AS total_output,
           SUM(cost_usd)      AS total_usd,
           SUM(cost_pln)      AS total_pln
    FROM product_token_usage
    WHERE product_id = ?
  `).get(productId);

  return NextResponse.json({ rows, totals });
}
