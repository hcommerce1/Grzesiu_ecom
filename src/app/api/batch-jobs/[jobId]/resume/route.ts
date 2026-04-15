import { NextRequest, NextResponse } from 'next/server';
import { getBatchJob, updateBatchJob } from '@/lib/db';

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = getBatchJob(jobId);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  updateBatchJob(jobId, { status: 'running' });
  return NextResponse.json({ success: true, status: 'running' });
}
