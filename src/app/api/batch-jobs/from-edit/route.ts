import { NextRequest, NextResponse } from 'next/server';
import { createBatchJob, createBatchJobItems, updateBatchJob } from '@/lib/db';
import type { ProductSession, GeneratedDescription, ProductData } from '@/lib/types';

interface RemainingProduct {
  blProductId: string;
  name: string;
  ean?: string;
  sku?: string;
  productType?: 'basic' | 'variant' | 'bundle';
  parentId?: string;
}

interface ExtractionResult {
  productId: string;
  values: Record<string, string>;
  confidence: number;
  missing: string[];
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      templateSession: ProductSession;
      remainingProducts: RemainingProduct[];
      diffFields: string[];
      keepExistingImages?: boolean;
      titleTemplate?: string;
      descriptionTemplate?: GeneratedDescription;
      label?: string;
    };

    const {
      templateSession,
      remainingProducts,
      diffFields,
      keepExistingImages = true,
      titleTemplate,
      descriptionTemplate,
      label,
    } = body;

    if (!templateSession || !remainingProducts?.length) {
      return NextResponse.json({ error: 'Missing templateSession or remainingProducts' }, { status: 400 });
    }

    // Call ai-extract-variants internally to get attribute values from product names
    const attrFields = diffFields.filter(f => f.startsWith('attr:'));
    let extractions: ExtractionResult[] = [];

    if (attrFields.length > 0 || diffFields.includes('ean') || diffFields.includes('sku')) {
      const baseUrl = req.nextUrl.origin;
      const extractRes = await fetch(`${baseUrl}/api/ai-extract-variants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          products: remainingProducts.map(p => ({
            id: p.blProductId,
            name: p.name,
            ean: p.ean,
            sku: p.sku,
          })),
          diffFields,
          templateTitle: templateSession.data?.title,
        }),
      });

      if (extractRes.ok) {
        const extractData = await extractRes.json() as { extractions: ExtractionResult[] };
        extractions = extractData.extractions;
      }
    }

    const extractionMap = new Map(extractions.map(e => [e.productId, e]));

    // Effective diff fields: remove 'images' if keepExistingImages
    const effectiveDiffFields = keepExistingImages
      ? diffFields.filter(f => f !== 'images')
      : diffFields;

    // Build template session in edit mode
    const editTemplateSession: ProductSession = {
      ...templateSession,
      mode: 'edit',
    };

    // Build batch job items
    const items = remainingProducts.map(p => {
      const extraction = extractionMap.get(p.blProductId);
      const attributes: Record<string, string> = {};

      // Map extracted attr: fields to attributes
      for (const field of attrFields) {
        const attrName = field.replace('attr:', '');
        const val = extraction?.values[attrName];
        if (val) attributes[attrName] = val;
      }

      const productData: ProductData = {
        title: p.name,
        images: [],
        description: '',
        attributes,
        ean: extraction?.values['ean'] || p.ean,
        sku: extraction?.values['sku'] || p.sku,
        url: '',
      };

      return {
        productData: JSON.stringify(productData),
        label: p.name,
        blProductId: p.blProductId,
      };
    });

    const jobLabel = label || `Edycja masowa — ${remainingProducts.length} produktów`;

    const jobId = createBatchJob({
      source: 'edit-batch',
      label: jobLabel,
      batchType: 'independent',
      templateSession: JSON.stringify(editTemplateSession),
      diffFields: JSON.stringify(effectiveDiffFields),
      descriptionTemplate: descriptionTemplate ? JSON.stringify(descriptionTemplate) : undefined,
      titleTemplate: titleTemplate || undefined,
      totalItems: items.length,
    });

    createBatchJobItems(jobId, items);

    // Auto-start: set status to running immediately
    updateBatchJob(jobId, { status: 'running' });

    return NextResponse.json({ jobId });
  } catch (err) {
    console.error('[batch-jobs/from-edit]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Błąd tworzenia batch joba' },
      { status: 500 },
    );
  }
}
