import { NextRequest, NextResponse } from 'next/server';
import {
  getBatchJob, getNextPendingItem, updateBatchJobItem, updateBatchJob, getBatchJobProgress,
} from '@/lib/db';
import { cloneSessionForItem } from '@/lib/batch-session';
import { buildBaselinkerPayload } from '@/lib/product-session';
import { addInventoryProduct } from '@/lib/baselinker';
import type { ProductSession, GeneratedDescription } from '@/lib/types';

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;

  try {
    const job = getBatchJob(jobId);
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

    if (job.status !== 'running') {
      return NextResponse.json({ error: 'Job is not running', status: job.status }, { status: 400 });
    }

    const item = getNextPendingItem(jobId);
    if (!item) {
      // All done
      updateBatchJob(jobId, { status: 'done' });
      const progress = getBatchJobProgress(jobId);
      return NextResponse.json({ done: true, progress });
    }

    // Mark as processing
    updateBatchJobItem(item.id, { status: 'processing' });
    updateBatchJob(jobId, { lastActivity: new Date().toISOString() });

    try {
      let templateSession: ProductSession = { ...job.templateSession };
      const diffFields: string[] = job.diffFields ?? [];
      const descTemplate: GeneratedDescription | null = job.descriptionTemplate ?? null;
      const titleTemplate: string | null = job.titleTemplate ?? null;

      // Determine mode
      let mode: 'new' | 'edit' | 'variant' = 'new';
      if (job.batchType === 'variants' && item.orderIndex > 0) {
        if (!job.parentProductId) {
          updateBatchJobItem(item.id, { status: 'error', errorMessage: 'parentProductId nie ustawiony po item 0 — nie można tworzyć wariantu' });
          updateBatchJob(jobId, { failedItems: job.failedItems + 1, lastActivity: new Date().toISOString() });
          return NextResponse.json({ done: false, item: { id: item.id, error: 'parentProductId missing' }, progress: getBatchJobProgress(jobId) });
        }
        mode = 'variant';
      } else if (templateSession.mode === 'edit') {
        mode = 'edit';
      }

      // For edit mode, set the product_id from item's blProductId
      const itemOverrides = item.overrideData;
      const editProductId = item.blProductId;
      if (mode === 'edit') {
        if (!editProductId) {
          updateBatchJobItem(item.id, {
            status: 'error',
            errorMessage: 'Brak blProductId — produkt nie może zostać zaktualizowany (tryb edit wymaga ID produktu BL)',
          });
          updateBatchJob(jobId, {
            failedItems: job.failedItems + 1,
            lastActivity: new Date().toISOString(),
          });
          const progress = getBatchJobProgress(jobId);
          return NextResponse.json({
            done: false,
            item: { id: item.id, label: item.label, error: 'Brak blProductId' },
            progress,
          });
        }
        // Patch without mutating original templateSession
        templateSession = { ...templateSession, product_id: editProductId };
      }

      const clonedSession = cloneSessionForItem(
        templateSession,
        item.productData,
        diffFields,
        descTemplate,
        titleTemplate,
        mode,
        job.parentProductId,
        itemOverrides
      );

      const payload = buildBaselinkerPayload(clonedSession);
      const result = await addInventoryProduct(payload);
      const blProductId = String(result.product_id);

      // If variants and this is the first item, persist parent product ID immediately
      if (job.batchType === 'variants' && item.orderIndex === 0) {
        updateBatchJob(jobId, { parentProductId: blProductId, lastActivity: new Date().toISOString() });
      }

      // Success
      updateBatchJobItem(item.id, { status: 'done', blProductId });
      updateBatchJob(jobId, {
        completedItems: job.completedItems + 1,
        lastActivity: new Date().toISOString(),
      });

      const progress = getBatchJobProgress(jobId);
      return NextResponse.json({
        done: false,
        item: { id: item.id, label: item.label, blProductId },
        progress,
      });

    } catch (itemErr) {
      const errorMsg = itemErr instanceof Error ? itemErr.message : 'Unknown error';

      updateBatchJobItem(item.id, { status: 'error', errorMessage: errorMsg });
      updateBatchJob(jobId, {
        failedItems: job.failedItems + 1,
        lastActivity: new Date().toISOString(),
      });

      const progress = getBatchJobProgress(jobId);
      return NextResponse.json({
        done: false,
        item: { id: item.id, label: item.label, error: errorMsg },
        progress,
      });
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
