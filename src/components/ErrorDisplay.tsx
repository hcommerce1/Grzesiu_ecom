'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorDisplayProps {
    message: string;
    onRetry: () => void;
}

export function ErrorDisplay({ message, onRetry }: ErrorDisplayProps) {
    const isAccessDenied = message.toLowerCase().includes('access denied') ||
        message.toLowerCase().includes('blocked') ||
        message.toLowerCase().includes('captcha');

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-error-bg border border-error/20 rounded-2xl p-8 text-center max-w-lg mx-auto">
                <div className="w-12 h-12 rounded-xl bg-error/10 mx-auto mb-4 flex items-center justify-center">
                    <AlertTriangle className="w-6 h-6 text-error" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">
                    {isAccessDenied ? 'Access Blocked' : 'Extraction Failed'}
                </h3>
                <p className="text-sm text-muted mb-6 leading-relaxed">
                    {isAccessDenied
                        ? 'The target website blocked the request. Try again in a moment, or configure an Unblocker API in your .env file for better reliability.'
                        : message}
                </p>
                <button
                    onClick={onRetry}
                    className="inline-flex items-center gap-2 bg-card hover:bg-card-hover text-foreground text-sm font-medium px-5 py-2.5 rounded-xl border border-border hover:border-border-hover transition-all duration-200"
                >
                    <RefreshCw className="w-4 h-4" />
                    Try Again
                </button>
            </div>
        </div>
    );
}
