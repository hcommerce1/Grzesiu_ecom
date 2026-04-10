'use client';

import { useState, useRef } from 'react';
import { Search, Loader2, Link as LinkIcon } from 'lucide-react';

interface SearchBarProps {
    onSubmit: (urls: string[]) => void;
    isLoading: boolean;
}

export function SearchBar({ onSubmit, isLoading }: SearchBarProps) {
    const [text, setText] = useState('');
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const urls = text.split('\n').map(l => l.trim()).filter(Boolean);
        if (urls.length === 0) return;
        onSubmit(urls);
    };

    const handlePaste = async () => {
        try {
            const pastedText = await navigator.clipboard.readText();
            setText(pastedText);
            if (inputRef.current) {
                inputRef.current.value = pastedText;
                inputRef.current.style.height = 'auto';
                inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
                inputRef.current.focus();
            }
        } catch {
            // clipboard access denied — ignore silently
        }
    };

    return (
        <form onSubmit={handleSubmit} className="max-w-2xl mx-auto">
            <div className="glass input-glow rounded-2xl p-1.5 transition-all duration-300">
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 flex-1 px-4">
                        <LinkIcon className="w-4 h-4 text-muted flex-shrink-0" />
                        <textarea
                            ref={inputRef}
                            value={text}
                            onChange={(e) => {
                                setText(e.target.value);
                                e.target.style.height = 'auto';
                                e.target.style.height = `${e.target.scrollHeight}px`;
                            }}
                            placeholder={"https://www.amazon.de/dp/...\\nhttps://www.aosom.de/item/..."}
                            className="flex-1 bg-transparent text-foreground placeholder:text-muted/60 text-sm py-3 outline-none resize-none min-h-[44px] max-h-[200px]"
                            disabled={isLoading}
                            rows={1}
                        />
                    </div>

                    <button
                        type="button"
                        onClick={handlePaste}
                        disabled={isLoading}
                        className="text-xs text-muted hover:text-foreground px-3 py-2 rounded-lg hover:bg-card transition-colors duration-200 disabled:opacity-50"
                    >
                        Paste
                    </button>

                    <button
                        type="submit"
                        disabled={isLoading || !text.trim()}
                        className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {isLoading ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Scraping…
                            </>
                        ) : (
                            <>
                                <Search className="w-4 h-4" />
                                Extract
                            </>
                        )}
                    </button>
                </div>
            </div>
        </form>
    );
}
