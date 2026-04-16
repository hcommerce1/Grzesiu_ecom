import { useState, useRef, useCallback, useEffect } from 'react';

export interface BatchJobProgress {
  total: number;
  done: number;
  failed: number;
  pending: number;
}

export interface BatchJobPollerState {
  progress: BatchJobProgress | null;
  status: 'idle' | 'running' | 'done' | 'error' | 'paused';
  isPolling: boolean;
}

export interface BatchJobPollerActions {
  start: () => void;
  stop: () => void;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
}

/**
 * Reusable polling hook for batch job processing.
 * Polls /api/batch-jobs/{jobId}/process-next until done or stopped.
 */
export function useBatchJobPoller(
  jobId: string | null,
  opts?: { autoStart?: boolean; onDone?: (progress: BatchJobProgress) => void },
): BatchJobPollerState & BatchJobPollerActions {
  const [progress, setProgress] = useState<BatchJobProgress | null>(null);
  const [status, setStatus] = useState<BatchJobPollerState['status']>('idle');
  const pollingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const poll = useCallback(async (id: string) => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    setStatus('running');

    while (pollingRef.current && mountedRef.current) {
      try {
        const res = await fetch(`/api/batch-jobs/${id}/process-next`, { method: 'POST' });
        if (!res.ok) break;
        const data = await res.json() as {
          done?: boolean;
          error?: string;
          progress?: BatchJobProgress;
        };

        if (!mountedRef.current) break;

        if (data.progress) {
          setProgress(data.progress);
        }

        if (data.done) {
          setStatus('done');
          opts?.onDone?.(data.progress!);
          break;
        }

        if (data.error) break;

        await new Promise(r => setTimeout(r, 200));
      } catch {
        break;
      }
    }

    pollingRef.current = false;
    if (mountedRef.current && status !== 'done') {
      setStatus(prev => prev === 'running' ? 'idle' : prev);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback(() => {
    if (jobId) poll(jobId);
  }, [jobId, poll]);

  const stop = useCallback(() => {
    pollingRef.current = false;
  }, []);

  const pause = useCallback(async () => {
    pollingRef.current = false;
    if (!jobId) return;
    await fetch(`/api/batch-jobs/${jobId}/pause`, { method: 'POST' });
    setStatus('paused');
  }, [jobId]);

  const resume = useCallback(async () => {
    if (!jobId) return;
    await fetch(`/api/batch-jobs/${jobId}/resume`, { method: 'POST' });
    setStatus('running');
    setTimeout(() => poll(jobId), 100);
  }, [jobId, poll]);

  // Auto-start when jobId changes and autoStart is true
  useEffect(() => {
    if (opts?.autoStart && jobId) {
      poll(jobId);
    }
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { progress, status, isPolling: pollingRef.current, start, stop, pause, resume };
}
