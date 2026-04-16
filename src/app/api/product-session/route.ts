import { NextRequest, NextResponse } from 'next/server';
import { getSession, saveSession, clearSession, createDefaultFieldSelection } from '@/lib/product-session';
import { saveWorkflowSession } from '@/lib/db';
import type { ProductSession } from '@/lib/types';

// GET /api/product-session — retrieve current session
export async function GET() {
  const session = getSession();
  if (!session) {
    return NextResponse.json({ session: null });
  }
  return NextResponse.json({ session });
}

// POST /api/product-session — create or update session
export async function POST(req: NextRequest) {
  let body: Partial<ProductSession>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const existing = getSession();

  const sessionMode = body.mode ?? existing?.mode ?? 'new';
  const defaultSel = createDefaultFieldSelection(sessionMode);

  const session: ProductSession = {
    mode: sessionMode,
    product_id: body.product_id ?? existing?.product_id,
    parent_id: body.parent_id ?? existing?.parent_id,
    is_bundle: body.is_bundle ?? existing?.is_bundle,
    bundle_products: body.bundle_products ?? existing?.bundle_products,
    data: body.data ?? existing?.data ?? {
      title: '',
      images: [],
      description: '',
      attributes: {},
      url: '',
    },
    allegroCategory: 'allegroCategory' in body ? body.allegroCategory : existing?.allegroCategory,
    allegroParameters: 'allegroParameters' in body ? body.allegroParameters : existing?.allegroParameters,
    filledParameters: 'filledParameters' in body ? body.filledParameters : existing?.filledParameters,
    commissionInfo: body.commissionInfo ?? existing?.commissionInfo,
    images: body.images ?? existing?.images ?? [],
    tax_rate: body.tax_rate ?? existing?.tax_rate ?? 23,
    inventoryId: body.inventoryId ?? existing?.inventoryId,
    defaultWarehouse: body.defaultWarehouse ?? existing?.defaultWarehouse,
    fieldSelection: body.fieldSelection !== undefined
      ? { ...defaultSel, ...body.fieldSelection }
      : existing?.fieldSelection ?? defaultSel,
    editableFieldValues: body.editableFieldValues ?? existing?.editableFieldValues,
    extraFieldValues: body.extraFieldValues ?? existing?.extraFieldValues,
    ready: body.ready ?? existing?.ready ?? false,
    sheetProductId: body.sheetProductId ?? existing?.sheetProductId,
    sheetMeta: body.sheetMeta ?? existing?.sheetMeta,
    currentStep: body.currentStep ?? existing?.currentStep,
    imagesMeta: body.imagesMeta ?? existing?.imagesMeta,
    generatedTitle: body.generatedTitle ?? existing?.generatedTitle,
    titleCandidates: body.titleCandidates ?? existing?.titleCandidates,
    generatedDescription: body.generatedDescription ?? existing?.generatedDescription,
    descriptionInputSnapshot: body.descriptionInputSnapshot ?? existing?.descriptionInputSnapshot,
    descriptionPrompt: body.descriptionPrompt ?? existing?.descriptionPrompt,
    aiFillResults: body.aiFillResults ?? existing?.aiFillResults,
  };

  saveSession(session);

  // Per-product persistence — so "Kontynuuj" restores full state
  if (session.sheetProductId) {
    try {
      saveWorkflowSession(session.sheetProductId, JSON.stringify(session));
    } catch {
      // Non-fatal — global session still saved
    }
  }

  return NextResponse.json({ session });
}

// DELETE /api/product-session — clear session
export async function DELETE() {
  clearSession();
  return NextResponse.json({ success: true });
}
