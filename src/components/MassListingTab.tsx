"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import {
  Layers, Play, Pause, Trash2, RotateCcw, ChevronLeft,
  CheckCircle2, Clock, Loader2, XCircle, SkipForward, Plus,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { SellerScraperTab } from "@/components/SellerScraperTab"
import type { BatchJob, BatchJobItem, BatchJobProgress } from "@/lib/types"
import type { AppUser } from "@/lib/user"

interface Props {
  user: AppUser | null
}

// ─── Types ───
interface JobWithProgress extends BatchJob {
  progress: BatchJobProgress
}

type ItemFilter = 'all' | 'done' | 'error' | 'pending'

// ─── Utils ───
function isZombie(job: BatchJob): boolean {
  if (job.status !== 'running') return false
  if (!job.lastActivity) return true
  const diff = Date.now() - new Date(job.lastActivity).getTime()
  return diff > 0 && diff > 2 * 60 * 1000 // 2 minutes, guard against clock skew
}

function statusIcon(status: BatchJob['status'] | BatchJobItem['status']) {
  switch (status) {
    case 'done': return <CheckCircle2 className="size-4 text-green-500" />
    case 'error': return <XCircle className="size-4 text-destructive" />
    case 'running': case 'processing': return <Loader2 className="size-4 animate-spin text-blue-500" />
    case 'paused': return <Pause className="size-4 text-yellow-500" />
    case 'pending': return <Clock className="size-4 text-muted-foreground" />
    case 'skipped': return <SkipForward className="size-4 text-muted-foreground" />
    default: return <Clock className="size-4 text-muted-foreground" />
  }
}

function ProgressBar({ done, total, failed }: { done: number; total: number; failed: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
        {done}/{total}{failed > 0 ? ` (${failed} błędów)` : ''}
      </span>
    </div>
  )
}

type View = 'list' | 'new-batch'

// ─── Main Component ───
export function MassListingTab({ user }: Props) {
  const [view, setView] = useState<View>('list')
  const [jobs, setJobs] = useState<JobWithProgress[]>([])
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const selectedJobIdRef = useRef<string | null>(null)
  const [jobItems, setJobItems] = useState<BatchJobItem[]>([])
  const [itemFilter, setItemFilter] = useState<ItemFilter>('all')
  const [loadingJobs, setLoadingJobs] = useState(true)
  const pollingRef = useRef<Record<string, boolean>>({})
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    selectedJobIdRef.current = selectedJobId
  }, [selectedJobId])

  // ─── Fetch jobs list ───
  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/batch-jobs')
      if (!res.ok) return
      const data = await res.json()
      if (mountedRef.current) {
        setJobs(data.jobs ?? [])
        setLoadingJobs(false)
      }
    } catch {
      if (mountedRef.current) setLoadingJobs(false)
    }
  }, [])

  useEffect(() => {
    fetchJobs()
    const interval = setInterval(fetchJobs, 30000)
    return () => clearInterval(interval)
  }, [fetchJobs])

  // ─── Fetch job detail ───
  const fetchJobDetail = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/batch-jobs/${jobId}`)
      if (!res.ok) return
      const data = await res.json()
      if (mountedRef.current) {
        setJobItems(data.items ?? [])
        setJobs(prev => prev.map(j => j.id === jobId ? { ...j, ...data.job, progress: data.progress } : j))
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (selectedJobId) fetchJobDetail(selectedJobId)
  }, [selectedJobId, fetchJobDetail])

  // ─── Polling loop for running jobs ───
  const startPolling = useCallback(async (jobId: string) => {
    if (pollingRef.current[jobId]) return
    pollingRef.current[jobId] = true

    while (pollingRef.current[jobId] && mountedRef.current) {
      try {
        const res = await fetch(`/api/batch-jobs/${jobId}/process-next`, { method: 'POST' })
        if (!res.ok) break
        const data = await res.json()

        if (!mountedRef.current) break

        // Update progress
        setJobs(prev => prev.map(j => j.id === jobId ? {
          ...j,
          completedItems: data.progress?.done ?? j.completedItems,
          failedItems: data.progress?.failed ?? j.failedItems,
          progress: data.progress ?? j.progress,
          status: data.done ? 'done' : j.status,
        } : j))

        // Update item in detail view
        if (data.item && selectedJobIdRef.current === jobId) {
          setJobItems(prev => prev.map(i => i.id === data.item.id ? {
            ...i,
            status: data.item.error ? 'error' : 'done',
            blProductId: data.item.blProductId,
            errorMessage: data.item.error,
          } : i))
        }

        if (data.done || data.error) break

        await new Promise(r => setTimeout(r, 200))
      } catch {
        break
      }
    }

    pollingRef.current[jobId] = false
    fetchJobs()
  }, [fetchJobs])

  // Start polling for running jobs on mount/change
  useEffect(() => {
    for (const job of jobs) {
      if (job.status === 'running' && !isZombie(job) && !pollingRef.current[job.id]) {
        startPolling(job.id)
      }
    }
  }, [jobs, startPolling])

  // ─── Actions ───
  const handlePause = async (jobId: string) => {
    pollingRef.current[jobId] = false
    await fetch(`/api/batch-jobs/${jobId}/pause`, { method: 'POST' })
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'paused' } : j))
    toast.success('Job wstrzymany')
  }

  const handleResume = async (jobId: string) => {
    await fetch(`/api/batch-jobs/${jobId}/resume`, { method: 'POST' })
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'running' } : j))
    toast.success('Job wznowiony')
    setTimeout(() => startPolling(jobId), 100)
  }

  const handleDelete = async (jobId: string) => {
    pollingRef.current[jobId] = false
    await fetch(`/api/batch-jobs/${jobId}`, { method: 'DELETE' })
    setJobs(prev => prev.filter(j => j.id !== jobId))
    if (selectedJobId === jobId) setSelectedJobId(null)
    toast.success('Job usunięty')
  }

  const handleRetryFailed = async (jobId: string) => {
    await fetch(`/api/batch-jobs/${jobId}/retry-failed`, { method: 'POST' })
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'running', failedItems: 0 } : j))
    toast.success('Błędy zresetowane — wznawianie...')
    setTimeout(() => startPolling(jobId), 100)
    if (selectedJobId === jobId) fetchJobDetail(jobId)
  }

  // ─── Detail view ───
  const selectedJob = jobs.find(j => j.id === selectedJobId)

  const filteredItems = jobItems.filter(item => {
    if (itemFilter === 'all') return true
    if (itemFilter === 'done') return item.status === 'done'
    if (itemFilter === 'error') return item.status === 'error'
    if (itemFilter === 'pending') return item.status === 'pending' || item.status === 'processing'
    return true
  })

  // ─── New batch sub-view (seller scraper) ───
  if (view === 'new-batch') {
    return (
      <SellerScraperTab onNavigateToMassListing={() => {
        setView('list')
        fetchJobs()
      }} />
    )
  }

  if (selectedJob) {
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setSelectedJobId(null)}>
            <ChevronLeft className="size-4 mr-1" /> Powrót
          </Button>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold truncate">{selectedJob.label}</h3>
          </div>
          <ProgressBar done={selectedJob.completedItems} total={selectedJob.totalItems} failed={selectedJob.failedItems} />
          {statusIcon(selectedJob.status)}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 border-b border-border">
          {(['all', 'done', 'error', 'pending'] as ItemFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setItemFilter(f)}
              className={cn(
                "px-3 py-1.5 text-sm font-medium border-b-2 transition-colors -mb-px",
                itemFilter === f ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {f === 'all' ? 'Wszystkie' : f === 'done' ? 'OK' : f === 'error' ? 'Błędy' : 'Oczekuje'}
              {' '}({jobItems.filter(i => {
                if (f === 'all') return true
                if (f === 'done') return i.status === 'done'
                if (f === 'error') return i.status === 'error'
                if (f === 'pending') return i.status === 'pending' || i.status === 'processing'
                return true
              }).length})
            </button>
          ))}
        </div>

        {/* Items list */}
        <div className="border border-border rounded-lg overflow-hidden max-h-[60vh] overflow-y-auto">
          {filteredItems.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Brak elementów</div>
          ) : (
            <div className="divide-y divide-border">
              {filteredItems.map(item => (
                <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                  {statusIcon(item.status)}
                  <span className="flex-1 text-sm truncate">{item.label ?? `Produkt #${item.orderIndex + 1}`}</span>
                  {item.blProductId && (
                    <span className="text-xs text-muted-foreground">BL#{item.blProductId}</span>
                  )}
                  {item.errorMessage && (
                    <span className="text-xs text-destructive truncate max-w-[200px]" title={item.errorMessage}>
                      {item.errorMessage}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          {(selectedJob.status === 'running' && !isZombie(selectedJob)) ? (
            <Button variant="outline" size="sm" onClick={() => handlePause(selectedJob.id)}>
              <Pause className="size-4 mr-1.5" /> Pauza
            </Button>
          ) : selectedJob.status !== 'done' ? (
            <Button variant="outline" size="sm" onClick={() => handleResume(selectedJob.id)}>
              <Play className="size-4 mr-1.5" /> Wznów
            </Button>
          ) : null}

          {selectedJob.failedItems > 0 && (
            <Button variant="outline" size="sm" onClick={() => handleRetryFailed(selectedJob.id)}>
              <RotateCcw className="size-4 mr-1.5" /> Retry {selectedJob.failedItems} błędów
            </Button>
          )}

          <Button variant="destructive" size="sm" onClick={() => handleDelete(selectedJob.id)}>
            <Trash2 className="size-4 mr-1.5" /> Usuń
          </Button>
        </div>
      </div>
    )
  }

  // ─── List view ───
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Layers className="size-5" /> Wystawianie masowe
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Batch joby z automatycznym wystawianiem produktów do BaseLinker
          </p>
        </div>
        <div className="flex gap-2">
          {user === 'hubert' && (
            <Button variant="outline" size="sm" onClick={() => setView('new-batch')}>
              <Plus className="size-4 mr-1.5" /> Nowy batch
            </Button>
          )}
        </div>
      </div>

      {loadingJobs ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-border rounded-xl">
          <Layers className="size-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">Brak batch jobów.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Utwórz job ze zakładki "Scraper sprzedawcy".
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map(job => {
            const zombie = isZombie(job)
            return (
              <div
                key={job.id}
                onClick={() => setSelectedJobId(job.id)}
                className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-muted/40 cursor-pointer transition-colors"
              >
                <div className="shrink-0">{statusIcon(zombie ? 'paused' : job.status)}</div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium truncate">{job.label}</span>
                    {zombie && (
                      <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-400 shrink-0">
                        Utrata połączenia
                      </Badge>
                    )}
                    {!zombie && job.status !== 'pending' && (
                      <Badge variant={job.status === 'done' ? 'default' : job.status === 'error' ? 'destructive' : 'outline'} className="text-xs shrink-0">
                        {job.status === 'running' ? 'W toku' : job.status === 'done' ? 'Gotowe' : job.status === 'paused' ? 'Pauza' : job.status === 'error' ? 'Błąd' : job.status}
                      </Badge>
                    )}
                  </div>
                  <ProgressBar done={job.completedItems} total={job.totalItems} failed={job.failedItems} />
                </div>

                {/* Actions */}
                <div className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                  {(zombie || job.status === 'paused' || job.status === 'error') ? (
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => handleResume(job.id)} title="Wznów">
                      <Play className="size-3.5" />
                    </Button>
                  ) : job.status === 'running' ? (
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => handlePause(job.id)} title="Pauza">
                      <Pause className="size-3.5" />
                    </Button>
                  ) : null}

                  {job.failedItems > 0 && (
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => handleRetryFailed(job.id)} title="Retry błędów">
                      <RotateCcw className="size-3.5" />
                    </Button>
                  )}

                  <Button variant="ghost" size="icon" className="size-7 text-destructive hover:text-destructive" onClick={() => handleDelete(job.id)} title="Usuń">
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
