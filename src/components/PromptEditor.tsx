'use client';

import { useState, useEffect } from 'react';
import { Settings, X, RotateCcw } from 'lucide-react';

// Empty string means "use the server-side default prompt" (defined in src/lib/translator.ts)
const DEFAULT_PROMPT = '';

const STORAGE_KEY = 'ecom-scraper-system-prompt';

interface PromptEditorProps {
    onPromptChange: (prompt: string) => void;
}

export function PromptEditor({ onPromptChange }: PromptEditorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [prompt, setPrompt] = useState(DEFAULT_PROMPT);

    // Load saved prompt on mount
    useEffect(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            setPrompt(saved);
            onPromptChange(saved);
        } else {
            onPromptChange(DEFAULT_PROMPT);
        }
    }, [onPromptChange]);

    const handleSave = () => {
        localStorage.setItem(STORAGE_KEY, prompt);
        onPromptChange(prompt);
        setIsOpen(false);
    };

    const handleReset = () => {
        setPrompt(DEFAULT_PROMPT);
        localStorage.removeItem(STORAGE_KEY);
        onPromptChange(DEFAULT_PROMPT);
    };

    return (
        <>
            {/* Trigger Button */}
            <button
                onClick={() => setIsOpen(true)}
                className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted hover:text-foreground bg-card hover:bg-card-hover border border-border hover:border-border-hover rounded-xl transition-all duration-200"
            >
                <Settings className="w-3.5 h-3.5" />
                Edytuj Prompta
            </button>

            {/* Modal */}
            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
                    {/* Backdrop */}
                    <div
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
                        onClick={() => setIsOpen(false)}
                    />

                    {/* Dialog */}
                    <div className="relative w-full max-w-5xl bg-card border border-border rounded-2xl shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-300">
                        {/* Header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
                            <div>
                                <h3 className="text-base font-semibold text-foreground">
                                    System Prompt
                                </h3>
                                <p className="text-xs text-muted mt-0.5">
                                    Edytuj prompt systemowy używany do tłumaczenia wyników przez LLM
                                </p>
                            </div>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-card-hover transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="p-6">
                            <textarea
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                rows={24}
                                className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50 resize-y font-mono leading-relaxed transition-all"
                                placeholder="Zostaw puste, aby użyć domyślnego prompta Allegro. Wpisz własny prompt, aby nadpisać domyślny."
                            />
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-between px-6 py-4 border-t border-border/50">
                            <button
                                onClick={handleReset}
                                className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors"
                            >
                                <RotateCcw className="w-3 h-3" />
                                Przywróć domyślny
                            </button>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setIsOpen(false)}
                                    className="px-4 py-2 text-xs font-medium text-muted hover:text-foreground bg-card-hover rounded-lg transition-colors"
                                >
                                    Anuluj
                                </button>
                                <button
                                    onClick={handleSave}
                                    className="px-4 py-2 text-xs font-medium text-white bg-accent hover:bg-accent-hover rounded-lg transition-colors"
                                >
                                    Zapisz prompt
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
