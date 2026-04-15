import { NextRequest, NextResponse } from 'next/server';
import { getBatchJob, getBatchJobItems, getBatchJobProgress, deleteBatchJob } from '@/lib/db';

export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = getBatchJob(jobId);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  const items = getBatchJobItems(jobId);
  const progress = getBatchJobProgress(jobId);

  return NextResponse.json({ job, items, progress });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = getBatchJob(jobId);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  deleteBatchJob(jobId);
  return NextResponse.json({ success: true });
}
