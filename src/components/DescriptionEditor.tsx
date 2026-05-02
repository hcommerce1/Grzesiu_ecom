'use client';

import { useRef, useCallback, useEffect } from 'react';
import { Bold, Heading1, Heading2, List, ListOrdered, Type } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DescriptionEditorProps {
  value: string;
  onChange: (html: string) => void;
  className?: string;
}

export function DescriptionEditor({ value, onChange, className }: DescriptionEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastValueRef = useRef<string>(value);

  // Sync external value into editor only when value changes from outside
  useEffect(() => {
    if (!editorRef.current) return;
    if (value !== lastValueRef.current && document.activeElement !== editorRef.current) {
      editorRef.current.innerHTML = value;
      lastValueRef.current = value;
    }
  }, [value]);

  const exec = useCallback((cmd: string, val?: string) => {
    document.execCommand(cmd, false, val ?? undefined);
    editorRef.current?.focus();
  }, []);

  const handleInput = useCallback(() => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    lastValueRef.current = html;
    onChange(html);
  }, [onChange]);

  const applyBlock = useCallback((tag: string) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    let node: Node | null = range.commonAncestorContainer;
    // Walk up to find block element inside editor
    while (node && node !== editorRef.current) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        const blockTags = ['P', 'H1', 'H2', 'H3', 'LI', 'DIV'];
        if (blockTags.includes(el.tagName)) {
          const newEl = document.createElement(tag);
          newEl.innerHTML = el.innerHTML;
          el.parentNode?.replaceChild(newEl, el);
          handleInput();
          return;
        }
      }
      node = node.parentNode;
    }
    // Fallback
    exec('formatBlock', tag);
    handleInput();
  }, [exec, handleInput]);

  // eslint-disable-next-line react-hooks/refs
  const tools = [
    {
      icon: Bold,
      title: 'Pogrubienie',
      action: () => { exec('bold'); handleInput(); },
    },
    {
      icon: Heading1,
      title: 'Nagłówek H2',
      action: () => { applyBlock('h2'); },
    },
    {
      icon: Heading2,
      title: 'Nagłówek H3',
      action: () => { applyBlock('h3'); },
    },
    {
      icon: Type,
      title: 'Akapit',
      action: () => { applyBlock('p'); },
    },
    {
      icon: List,
      title: 'Lista punktowana',
      action: () => { exec('insertUnorderedList'); handleInput(); },
    },
    {
      icon: ListOrdered,
      title: 'Lista numerowana',
      action: () => { exec('insertOrderedList'); handleInput(); },
    },
  ];

  return (
    <div className={cn('border border-input rounded-lg overflow-hidden', className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-input bg-muted/30">
        {
          // eslint-disable-next-line react-hooks/refs
          tools.map(({ icon: Icon, title, action }) => (
          <button
            key={title}
            type="button"
            title={title}
            onMouseDown={(e) => { e.preventDefault(); action(); }}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <Icon className="size-3.5" />
          </button>
        ))}
      </div>

      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onBlur={handleInput}
        dangerouslySetInnerHTML={{ __html: value }}
        className="min-h-[200px] max-h-[400px] overflow-y-auto px-4 py-3 text-sm outline-none prose prose-sm prose-invert max-w-none [&_h2]:text-base [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-0.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_strong]:font-bold"
      />
    </div>
  );
}
