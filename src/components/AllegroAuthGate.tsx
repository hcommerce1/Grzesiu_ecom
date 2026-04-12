'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, ExternalLink, RefreshCw, Link2 } from 'lucide-react';

type AuthState =
  | 'checking'
  | 'authenticated'
  | 'unauthenticated'
  | 'initializing'
  | 'waiting'
  | 'error';

interface DeviceFlowData {
  verification_uri_complete: string;
  device_code: string;
  interval: number;
}

interface AllegroAuthGateProps {
  children: React.ReactNode;
}

export function AllegroAuthGate({ children }: AllegroAuthGateProps) {
  const [state, setState] = useState<AuthState>('checking');
  const [flowData, setFlowData] = useState<DeviceFlowData | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [attempts, setAttempts] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const clearPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  // Check auth status on mount
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch('/api/allegro/auth?action=status');
        const data = await res.json();
        if (cancelled) return;
        setState(data.authenticated ? 'authenticated' : 'unauthenticated');
      } catch {
        if (!cancelled) setState('unauthenticated');
      }
    }
    check();
    return () => { cancelled = true; };
  }, []);

  // Cleanup on unmount
  useEffect(() => clearPolling, [clearPolling]);

  async function initDeviceFlow() {
    setState('initializing');
    setErrorMsg('');
    try {
      const res = await fetch('/api/allegro/auth?action=init');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data._demo) {
        setState('authenticated');
        return;
      }
      setFlowData(data);
      setState('waiting');
      startPolling(data.device_code, data.interval || 5);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Nie udało się zainicjować autoryzacji');
      setState('error');
    }
  }

  function startPolling(deviceCode: string, intervalSec: number) {
    setAttempts(0);
    let attempt = 0;
    const controller = new AbortController();
    abortRef.current = controller;

    intervalRef.current = setInterval(async () => {
      if (controller.signal.aborted) return;
      attempt++;
      setAttempts(attempt);

      if (attempt > 60) {
        clearPolling();
        setErrorMsg('Czas autoryzacji upłynął — użytkownik nie potwierdził w przeglądarce');
        setState('error');
        return;
      }

      try {
        const res = await fetch('/api/allegro/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_code: deviceCode }),
          signal: controller.signal,
        });
        const data = await res.json();

        if (data.success) {
          clearPolling();
          setState('authenticated');
          return;
        }
        if (data.error && !data.pending) {
          clearPolling();
          setErrorMsg(data.error);
          setState('error');
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
      }
    }, intervalSec * 1000);
  }

  function handleCancel() {
    clearPolling();
    setFlowData(null);
    setState('unauthenticated');
  }

  // ─── Render ───

  if (state === 'checking') {
    return (
      <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Sprawdzanie autoryzacji Allegro...
      </div>
    );
  }

  if (state === 'authenticated') {
    return <>{children}</>;
  }

  if (state === 'initializing') {
    return (
      <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Inicjowanie autoryzacji...
      </div>
    );
  }

  if (state === 'waiting' && flowData) {
    return (
      <div className="space-y-4 p-4 border border-border rounded-xl bg-card">
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">Autoryzacja Allegro</h3>
          <p className="text-xs text-muted-foreground">
            Otwórz poniższy link w przeglądarce i zaloguj się na swoje konto Allegro:
          </p>
        </div>

        <a
          href={flowData.verification_uri_complete}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-2.5 bg-accent/10 border border-accent/30 rounded-lg text-sm text-accent hover:bg-accent/20 transition-colors break-all"
        >
          <ExternalLink className="w-4 h-4 flex-shrink-0" />
          {flowData.verification_uri_complete}
        </a>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          Oczekiwanie na autoryzację... (próba {attempts}/60)
        </div>

        <button
          onClick={handleCancel}
          className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-card-hover transition-colors"
        >
          Anuluj
        </button>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="space-y-3 p-4 border border-red-500/30 rounded-xl bg-red-500/5">
        <p className="text-sm text-red-400">{errorMsg}</p>
        <button
          onClick={initDeviceFlow}
          className="flex items-center gap-2 px-3 py-1.5 text-xs text-foreground border border-border rounded-lg hover:bg-card-hover transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          Spróbuj ponownie
        </button>
      </div>
    );
  }

  // unauthenticated
  return (
    <div className="flex flex-col items-center gap-4 p-6 border border-border rounded-xl bg-card">
      <Link2 className="w-8 h-8 text-muted-foreground" />
      <div className="text-center space-y-1">
        <h3 className="text-sm font-medium text-foreground">Połącz z Allegro</h3>
        <p className="text-xs text-muted-foreground">
          Aby przeglądać kategorie i parametry, musisz najpierw połączyć swoje konto Allegro.
        </p>
      </div>
      <button
        onClick={initDeviceFlow}
        className="px-4 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent-hover transition-colors"
      >
        Połącz z Allegro
      </button>
    </div>
  );
}
