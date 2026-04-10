'use client';

import { ExternalLink } from 'lucide-react';

interface AllegroPreviewFrameProps {
  sessionUrl?: string;
}

export function AllegroPreviewFrame({ sessionUrl = '/offer-preview' }: AllegroPreviewFrameProps) {
  return (
    <div className="relative border border-border rounded-xl overflow-hidden bg-card">
      <div className="flex items-center justify-between px-3 py-2 bg-card-hover border-b border-border">
        <span className="text-xs text-muted font-medium">Podgląd oferty Allegro</span>
        <a
          href={sessionUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-accent hover:underline"
        >
          <ExternalLink className="w-3 h-3" />
          Pełny widok
        </a>
      </div>
      <iframe
        src={sessionUrl}
        className="w-full border-0"
        style={{ height: '400px' }}
        title="Podgląd oferty Allegro"
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  );
}
