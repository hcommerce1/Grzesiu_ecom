'use client';

import { useState } from 'react';
import { Lock } from 'lucide-react';
import type { FieldSelection, ProductMode, BLExtraField } from '@/lib/types';
import { createDefaultFieldSelection } from '@/lib/field-selection';

interface FieldSelectorProps {
  mode: ProductMode;
  extraFields?: BLExtraField[];
  initialSelection?: Partial<FieldSelection>;
  onChange: (selection: Partial<FieldSelection>) => void;
  /** Preview values to show under each field label so the user knows what will be sent */
  values?: Record<string, string>;
}

const MANDATORY = ['inventory_id', 'is_bundle', 'tax_rate', 'name'];

const OPTIONAL_FIELDS: { key: string; label: string }[] = [
  { key: 'sku', label: 'SKU' },
  { key: 'ean', label: 'EAN' },
  { key: 'asin', label: 'ASIN' },
  { key: 'description', label: 'Opis (description)' },
  { key: 'images', label: 'Zdjęcia (images)' },
  { key: 'description_extra1', label: 'Opis extra1' },
  { key: 'features', label: 'Parametry Allegro (features)' },
  { key: 'weight', label: 'Waga' },
  { key: 'dimensions', label: 'Wymiary (H/W/L)' },
  { key: 'stock', label: 'Stan magazynowy' },
  { key: 'prices', label: 'Ceny' },
  { key: 'locations', label: 'Lokalizacje' },
  { key: 'manufacturer_id', label: 'Producent' },
  { key: 'category_id', label: 'Kategoria' },
  { key: 'average_cost', label: 'Średni koszt' },
  { key: 'tags', label: 'Tagi' },
];

export function FieldSelector({ mode, extraFields = [], initialSelection, onChange, values = {} }: FieldSelectorProps) {
  const defaultSel = createDefaultFieldSelection(mode);
  const [selection, setSelection] = useState<Partial<FieldSelection>>(initialSelection ?? defaultSel);

  function toggle(key: string) {
    const next = { ...selection, [key]: !selection[key as keyof FieldSelection] };
    setSelection(next);
    onChange(next);
  }

  function renderField(key: string, label: string, isMandatory: boolean, conditionLabel?: string) {
    const val = isMandatory ? true : selection[key as keyof FieldSelection];
    const previewValue = values[key];
    const hasValue = previewValue && previewValue.trim().length > 0;

    return (
      <label
        key={key}
        className={`flex items-start gap-3 p-2.5 rounded-lg cursor-pointer ${isMandatory ? 'opacity-70' : 'hover:bg-card-hover/30'} transition-colors`}
      >
        <input
          type="checkbox"
          checked={!!val}
          disabled={isMandatory}
          onChange={() => !isMandatory && toggle(key)}
          className="rounded border-border accent-accent mt-0.5 flex-shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-foreground">{label}</span>
            {conditionLabel && (
              <span className="text-xs text-muted">({conditionLabel})</span>
            )}
          </div>
          {hasValue ? (
            <span className="text-xs text-primary/80 font-mono truncate block max-w-[200px]" title={previewValue}>
              {previewValue}
            </span>
          ) : (
            <span className="text-xs text-muted/50 italic">brak danych</span>
          )}
        </div>
        {isMandatory && <Lock className="w-3 h-3 text-muted flex-shrink-0 mt-1" />}
      </label>
    );
  }

  return (
    <div className="space-y-4">
      {/* Mandatory */}
      <div>
        <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Obowiązkowe</div>
        <div className="space-y-1">
          {MANDATORY.map(key => renderField(key, key === 'name' ? 'Nazwa (name w text_fields)' : key, true))}
          {mode === 'edit' && renderField('product_id', 'product_id', true, 'edycja')}
          {mode === 'variant' && renderField('parent_id', 'parent_id', true, 'wariant')}
          {mode === 'bundle' && renderField('bundle_products', 'bundle_products', true, 'bundle')}
        </div>
      </div>

      {/* Optional */}
      <div>
        <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Opcjonalne</div>
        <div className="grid grid-cols-2 gap-1">
          {OPTIONAL_FIELDS.map(f => renderField(f.key, f.label, false))}
        </div>
      </div>

      {/* Extra fields */}
      {extraFields.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Pola dodatkowe</div>
          <div className="space-y-1">
            {extraFields.map(ef => {
              const key = `extra_field_${ef.extra_field_id}`;
              return renderField(key, ef.name, false);
            })}
          </div>
        </div>
      )}
    </div>
  );
}
