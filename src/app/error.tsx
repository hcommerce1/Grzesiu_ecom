'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[App Error Boundary]', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-md space-y-4 text-center">
        <AlertTriangle className="size-12 text-destructive mx-auto" />
        <h2 className="text-lg font-semibold">Coś poszło nie tak</h2>
        <p className="text-sm text-muted-foreground break-words">
          {error.message || 'Nieznany błąd aplikacji'}
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground">
            Kod błędu: <code>{error.digest}</code>
          </p>
        )}
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <RefreshCw className="size-4" />
          Spróbuj ponownie
        </button>
      </div>
    </div>
  );
}
