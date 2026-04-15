import { NextRequest, NextResponse } from 'next/server';
import {
  getAllBatchJobs, createBatchJob, createBatchJobItems, getBatchJobProgress, updateBatchJob,
  type CreateBatchJobOpts, type BatchItemInput,
} from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') ?? undefined;
  const source = searchParams.get('source') ?? undefined;

  const jobs = getAllBatchJobs({ status, source });

  // Attach progress to each job
  const jobsWithProgress = jobs.map(job => ({
    ...job,
    progress: {
      total: job.totalItems,
      done: job.completedItems,
      failed: job.failedItems,
      pending: job.totalItems - job.completedItems - job.failedItems,
    },
  }));

  return NextResponse.json({ jobs: jobsWithProgress });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      label, source, sourceId, batchType, templateSession,
      diffFields, descriptionTemplate, titleTemplate, items,
    } = body;

    if (!label || !source || !templateSession || !Array.isArray(items)) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const opts: CreateBatchJobOpts = {
      source,
      sourceId,
      label,
      batchType: batchType ?? 'independent',
      templateSession: typeof templateSession === 'string' ? templateSession : JSON.stringify(templateSession),
      diffFields: diffFields ? (typeof diffFields === 'string' ? diffFields : JSON.stringify(diffFields)) : undefined,
      descriptionTemplate: descriptionTemplate ? (typeof descriptionTemplate === 'string' ? descriptionTemplate : JSON.stringify(descriptionTemplate)) : undefined,
      titleTemplate: titleTemplate ?? undefined,
      totalItems: items.length,
    };

    const jobId = createBatchJob(opts);

    const itemInputs: BatchItemInput[] = items.map((item: { productData: unknown; label?: string; thumbnailUrl?: string; sourceListingId?: string }) => ({
      productData: typeof item.productData === 'string' ? item.productData : JSON.stringify(item.productData),
      label: item.label,
      thumbnailUrl: item.thumbnailUrl,
      sourceListingId: item.sourceListingId,
    }));

    createBatchJobItems(jobId, itemInputs);

    return NextResponse.json({ jobId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
