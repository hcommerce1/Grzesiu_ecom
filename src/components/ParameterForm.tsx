'use client';

import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import type { AllegroParameter } from '@/lib/types';

interface ParameterFormProps {
  parameters: AllegroParameter[];
  initialValues?: Record<string, string | string[]>;
  onChange: (values: Record<string, string | string[]>) => void;
}

export function ParameterForm({ parameters, initialValues = {}, onChange }: ParameterFormProps) {
  const [values, setValues] = useState<Record<string, string | string[]>>(initialValues);

  function update(id: string, value: string | string[]) {
    const next = { ...values, [id]: value };
    setValues(next);
    onChange(next);
  }

  const required = parameters.filter(p => p.required);
  const optional = parameters.filter(p => !p.required);

  function renderInput(param: AllegroParameter) {
    const val = values[param.id];

    if (param.type === 'dictionary' || param.options?.length) {
      const opts = param.options ?? param.restrictions?.allowedValues ?? [];
      if (param.restrictions?.multipleChoices) {
        const selected = Array.isArray(val) ? val : val ? [val] : [];
        return (
          <div className="flex flex-wrap gap-2">
            {opts.map(opt => (
              <label key={opt.id} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.includes(opt.id)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, opt.id]
                      : selected.filter(v => v !== opt.id);
                    update(param.id, next);
                  }}
                  className="rounded border-border"
                />
                <span className="text-sm text-foreground">{opt.value}</span>
              </label>
            ))}
          </div>
        );
      }
      return (
        <select
          value={typeof val === 'string' ? val : ''}
          onChange={(e) => update(param.id, e.target.value)}
          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-accent"
        >
          <option value="">-- wybierz --</option>
          {opts.map(opt => (
            <option key={opt.id} value={opt.id}>{opt.value}</option>
          ))}
        </select>
      );
    }

    if (param.type === 'boolean') {
      return (
        <div className="flex gap-3">
          {['true', 'false'].map(v => (
            <label key={v} className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name={param.id}
                value={v}
                checked={val === v}
                onChange={() => update(param.id, v)}
              />
              <span className="text-sm text-foreground">{v === 'true' ? 'Tak' : 'Nie'}</span>
            </label>
          ))}
        </div>
      );
    }

    return (
      <input
        type={param.type === 'integer' || param.type === 'float' ? 'number' : 'text'}
        value={typeof val === 'string' ? val : ''}
        onChange={(e) => update(param.id, e.target.value)}
        placeholder={param.unit ? `Wartość [${param.unit}]` : 'Wartość'}
        min={param.restrictions?.min}
        max={param.restrictions?.max}
        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent"
      />
    );
  }

  function renderSection(title: string, params: AllegroParameter[], isRequired: boolean) {
    if (params.length === 0) return null;
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">{title}</h3>
          {isRequired && <AlertCircle className="w-3 h-3 text-red-400" />}
        </div>
        {params.map(param => {
          const missing = isRequired && (!values[param.id] || values[param.id] === '');
          return (
            <div key={param.id} className="space-y-1">
              <label className="flex items-center gap-1.5 text-sm text-foreground">
                {param.name}
                {isRequired && <span className="text-red-400">*</span>}
                {param.unit && <span className="text-xs text-muted">[{param.unit}]</span>}
              </label>
              {renderInput(param)}
              {missing && (
                <p className="text-xs text-red-400">Pole wymagane</p>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {renderSection('Wymagane', required, true)}
      {renderSection('Opcjonalne', optional, false)}
    </div>
  );
}
