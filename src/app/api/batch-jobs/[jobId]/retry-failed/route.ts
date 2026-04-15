import { NextRequest, NextResponse } from 'next/server';
import { getBatchJob, updateBatchJob, retryFailedItems, getBatchJobProgress } from '@/lib/db';

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = getBatchJob(jobId);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  retryFailedItems(jobId);
  updateBatchJob(jobId, { status: 'running', failedItems: 0 });

  const progress = getBatchJobProgress(jobId);
  return NextResponse.json({ success: true, progress });
}
