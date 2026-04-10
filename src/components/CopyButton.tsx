'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CopyButtonProps {
    text: string;
    className?: string;
    variant?: 'icon' | 'button';
    label?: string;
}

export function CopyButton({ text, className = '', variant = 'icon', label }: CopyButtonProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // fallback
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    if (variant === 'button') {
        return (
            <button
                onClick={handleCopy}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all duration-200 ${copied
                        ? 'bg-success/10 text-success'
                        : 'bg-card hover:bg-card-hover text-muted hover:text-foreground border border-border hover:border-border-hover'
                    } ${className}`}
            >
                {copied ? (
                    <>
                        <Check className="w-3 h-3 copy-success" />
                        Copied!
                    </>
                ) : (
                    <>
                        <Copy className="w-3 h-3" />
                        {label || 'Copy'}
                    </>
                )}
            </button>
        );
    }

    return (
        <button
            onClick={handleCopy}
            className={`p-1.5 rounded-lg transition-all duration-200 ${copied
                    ? 'text-success bg-success/10'
                    : 'text-muted hover:text-foreground hover:bg-card-hover'
                } ${className}`}
            title="Copy to clipboard"
        >
            {copied ? (
                <Check className="w-3.5 h-3.5 copy-success" />
            ) : (
                <Copy className="w-3.5 h-3.5" />
            )}
        </button>
    );
}
