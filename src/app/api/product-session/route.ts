import { NextRequest, NextResponse } from 'next/server';
import { getSession, saveSession, clearSession, listSessions, deriveProductKey, createDefaultFieldSelection } from '@/lib/product-session';
import { saveWorkflowSession } from '@/lib/db';
import type { ProductSession } from '@/lib/types';

// GET /api/product-session — retrieve current session, lub konkretną przez ?productKey=, lub ?list=1
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (url.searchParams.get('list') === '1') {
    return NextResponse.json({ sessions: listSessions() });
  }
  const productKey = url.searchParams.get('productKey') ?? undefined;
  const session = getSession(productKey);
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

  const url = new URL(req.url);
  const productKey = url.searchParams.get('productKey') ?? undefined;
  const existing = getSession(productKey);

  // Nowy produkt? Nie ciagnij stanu z poprzedniej oferty (kategorii, parametrow, opisu, etc.).
  // Przy explicit productKey ten warunek nie ma znaczenia (każdy klucz ma swój plik).
  const incomingUrl = body.data?.url;
  const incomingProdId = body.product_id;
  const isDifferentProduct =
    !productKey && (
      !!(incomingUrl && existing?.data?.url && incomingUrl !== existing.data.url) ||
      !!(incomingProdId && existing?.product_id && incomingProdId !== existing.product_id)
    );
  const base = isDifferentProduct ? null : existing;

  const sessionMode = body.mode ?? base?.mode ?? 'new';
  const defaultSel = createDefaultFieldSelection(sessionMode);

  const session: ProductSession = {
    mode: sessionMode,
    product_id: body.product_id ?? base?.product_id,
    parent_id: body.parent_id ?? base?.parent_id,
    is_bundle: body.is_bundle ?? base?.is_bundle,
    bundle_products: body.bundle_products ?? base?.bundle_products,
    data: body.data ?? base?.data ?? {
      title: '',
      images: [],
      description: '',
      attributes: {},
      url: '',
    },
    allegroCategory: 'allegroCategory' in body ? body.allegroCategory : base?.allegroCategory,
    allegroParameters: 'allegroParameters' in body ? body.allegroParameters : base?.allegroParameters,
    filledParameters: 'filledParameters' in body ? body.filledParameters : base?.filledParameters,
    commissionInfo: body.commissionInfo ?? base?.commissionInfo,
    images: body.images ?? base?.images ?? [],
    tax_rate: body.tax_rate ?? base?.tax_rate ?? 23,
    inventoryId: body.inventoryId ?? base?.inventoryId,
    defaultWarehouse: body.defaultWarehouse ?? base?.defaultWarehouse,
    fieldSelection: body.fieldSelection !== undefined
      ? { ...defaultSel, ...body.fieldSelection }
      : base?.fieldSelection ?? defaultSel,
    editableFieldValues: body.editableFieldValues ?? base?.editableFieldValues,
    extraFieldValues: body.extraFieldValues ?? base?.extraFieldValues,
    ready: body.ready ?? base?.ready ?? false,
    sheetProductId: body.sheetProductId ?? base?.sheetProductId,
    sheetMeta: body.sheetMeta ?? base?.sheetMeta,
    currentStep: body.currentStep ?? base?.currentStep,
    imagesMeta: body.imagesMeta ?? base?.imagesMeta,
    generatedTitle: body.generatedTitle ?? base?.generatedTitle,
    titleCandidates: body.titleCandidates ?? base?.titleCandidates,
    generatedDescription: body.generatedDescription ?? base?.generatedDescription,
    descriptionInputSnapshot: body.descriptionInputSnapshot ?? base?.descriptionInputSnapshot,
    descriptionPrompt: body.descriptionPrompt ?? base?.descriptionPrompt,
    aiFillResults: body.aiFillResults ?? base?.aiFillResults,
  };

  const effectiveKey = productKey ?? deriveProductKey(session);
  saveSession(session, effectiveKey);

  // Per-product persistence — so "Kontynuuj" restores full state (legacy DB store)
  if (session.sheetProductId) {
    try {
      saveWorkflowSession(session.sheetProductId, JSON.stringify(session));
    } catch {
      // Non-fatal — global session still saved
    }
  }

  return NextResponse.json({ session, productKey: effectiveKey });
}

// DELETE /api/product-session — clear session (active lub konkretną przez ?productKey=)
export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const productKey = url.searchParams.get('productKey') ?? undefined;
  clearSession(productKey);
  return NextResponse.json({ success: true });
}
