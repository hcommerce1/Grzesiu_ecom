'use client';

import React, { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import { Lock, ChevronDown, ChevronRight, AlertCircle, X, Loader2 as Loader, Sparkles } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { FilterableSelect, Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/datepicker';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useFieldPreferences } from '@/lib/stores/field-preferences';
import { createDefaultFieldSelection } from '@/lib/field-selection';
import { BundleProductsPicker } from './BundleProductsPicker';
import type { FieldSelection, ProductMode, BLExtraField, AllegroParameter, ParameterMatchResult, AutoFillEntry } from '@/lib/types';

/* ─── Constants ─── */

const MANDATORY_FIELDS = ['inventory_id', 'tax_rate', 'name'];

const MANDATORY_LABELS: Record<string, string> = {
  inventory_id: 'Inventory ID',
  tax_rate: 'Stawka VAT',
  name: 'Nazwa (name)',
};

const TAX_RATE_OPTIONS = [
  { value: '23', label: '23%' },
  { value: '8', label: '8%' },
  { value: '5', label: '5%' },
  { value: '0', label: '0%' },
  { value: 'zw', label: 'Zwolniony (zw)' },
  { value: 'np', label: 'Nie podlega (np)' },
];

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

const MODE_EXTRA_FIELDS: Record<string, { key: string; label: string; mode: ProductMode }> = {
  edit: { key: 'product_id', label: 'product_id', mode: 'edit' },
  variant: { key: 'parent_id', label: 'parent_id', mode: 'variant' },
  bundle: { key: 'bundle_products', label: 'bundle_products', mode: 'bundle' },
};

/* ─── Props ─── */

interface FieldsAndParametersStepProps {
  mode: ProductMode;
  extraFields: BLExtraField[];
  parameters: AllegroParameter[];
  initialFieldSelection?: Partial<FieldSelection>;
  initialParameterValues?: Record<string, string | string[]>;
  fieldValues: Record<string, string>;
  onFieldSelectionChange: (sel: Partial<FieldSelection>) => void;
  onParameterValuesChange: (vals: Record<string, string | string[]>) => void;
  /** Whether title has been AI-generated (vs original scraped title) */
  isTitleGenerated?: boolean;
  /** Auto-match results from Google Sheets parameter matching */
  sheetMatchResults?: ParameterMatchResult[];
  /** AI auto-fill results with confidence scores */
  aiFillResults?: AutoFillEntry[];
  /** AI auto-fill status */
  aiFillStatus?: 'idle' | 'loading' | 'done' | 'error';
  /** Whether this product is a bundle */
  isBundle: boolean;
  /** Callback when is_bundle changes */
  onIsBundleChange: (val: boolean) => void;
  /** Bundle component products */
  bundleProducts: Record<string, number>;
  /** Callback when bundle products change */
  onBundleProductsChange: (val: Record<string, number>) => void;
  /** Inventory ID for loading BL products */
  inventoryId?: number;
  /** Initial extra field values (from session) */
  initialExtraFieldValues?: Record<string, string>;
  /** Callback when extra field values change */
  onExtraFieldValuesChange?: (vals: Record<string, string>) => void;
  /** Tax rate change callback */
  onTaxRateChange?: (rate: number | string) => void;
  /** Current tax rate */
  taxRate?: number | string;
  /** Editable field values (user overrides for ean, weight, etc.) */
  editableFieldValues?: Record<string, string>;
  /** Callback when editable field values change */
  onEditableFieldValueChange?: (key: string, value: string) => void;
  /** BL manufacturers list for manufacturer dropdown */
  manufacturers?: { manufacturer_id: number; name: string }[];
}

/* ─── Section Header ─── */

function SectionHeader({
  title,
  count,
  expanded,
  onToggle,
}: {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-2 w-full py-3.5 group"
    >
      {expanded ? (
        <ChevronDown className="size-4 text-muted-foreground" />
      ) : (
        <ChevronRight className="size-4 text-muted-foreground" />
      )}
      <span className="text-sm font-semibold text-foreground/70 uppercase tracking-wider">
        {title}
      </span>
      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
        {count}
      </Badge>
      <div className="flex-1 h-px bg-border ml-2" />
    </button>
  );
}

/* ─── Row Component (memoized) ─── */

interface FieldRowProps {
  fieldKey: string;
  label: string;
  checked: boolean;
  locked: boolean;
  previewValue?: string;
  validationError?: boolean;
  onToggle: (key: string) => void;
  children?: React.ReactNode;
  conditionLabel?: string;
}

const FieldRow = memo(function FieldRow({
  fieldKey,
  label,
  checked,
  locked,
  previewValue,
  validationError,
  onToggle,
  children,
  conditionLabel,
}: FieldRowProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-[2rem_1fr_minmax(12rem,20rem)] items-start gap-3 px-3 py-2.5 rounded-lg transition-colors',
        locked ? '' : 'hover:bg-muted/40',
        validationError && 'bg-destructive/5'
      )}
    >
      {/* Checkbox */}
      <div className="flex items-center justify-center pt-0.5">
        {locked ? (
          <div className="flex items-center gap-1">
            <Checkbox checked={true} disabled />
          </div>
        ) : (
          <Checkbox
            checked={checked}
            onCheckedChange={() => onToggle(fieldKey)}
          />
        )}
      </div>

      {/* Label + preview */}
      <div className="min-w-0 pt-0.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium text-foreground">{label}</span>
          {locked && <Lock className="size-3 text-muted-foreground" />}
          {conditionLabel && (
            <span className="text-xs text-muted-foreground">({conditionLabel})</span>
          )}
        </div>
        {previewValue && previewValue.trim().length > 0 ? (
          <span
            className="text-xs text-primary/80 font-mono break-words block"
            title={previewValue}
          >
            {previewValue}
          </span>
        ) : (
          !children && (
            <span className="text-xs text-muted-foreground/70 italic">brak danych</span>
          )
        )}
      </div>

      {/* Value editor */}
      <div className="min-w-0">
        {children}
        {validationError && (
          <p className="text-xs text-destructive mt-1 flex items-center gap-1">
            <AlertCircle className="size-3" />
            Pole wymagane
          </p>
        )}
      </div>
    </div>
  );
});

/* ─── Multi-select for dictionary params with multipleChoices ─── */

function MultiSelect({
  options,
  selected,
  onChange,
}: {
  options: { id: string; value: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const showFilter = options.length > 10;

  const filtered = filter
    ? options.filter((o) => o.value.toLowerCase().includes(filter.toLowerCase()))
    : options;

  const selectedLabels = selected
    .map((id) => options.find((o) => o.id === id)?.value)
    .filter(Boolean);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-3 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
      >
        <span className="truncate text-left">
          {selected.length > 0 ? `${selected.length} wybrano` : '-- wybierz --'}
        </span>
        <ChevronDown className="size-4 shrink-0 opacity-50" />
      </button>

      {/* Selected chips */}
      {selectedLabels.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {selectedLabels.slice(0, 5).map((label, i) => (
            <span
              key={selected[i]}
              className="inline-flex items-center gap-1 rounded-md bg-accent text-accent-foreground px-2 py-0.5 text-xs"
            >
              {label}
              <button
                type="button"
                onClick={() => onChange(selected.filter((id) => id !== selected[i]))}
                className="hover:text-destructive"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          {selectedLabels.length > 5 && (
            <span className="text-xs text-muted-foreground px-1 py-0.5">
              +{selectedLabels.length - 5} więcej
            </span>
          )}
        </div>
      )}

      {/* Dropdown */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-border bg-popover shadow-md p-1">
            {showFilter && (
              <div className="flex items-center gap-2 px-2 pb-1.5 border-b border-border mb-1">
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Szukaj..."
                  className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
                  autoFocus
                />
              </div>
            )}
            {filtered.length === 0 && (
              <div className="px-2 py-3 text-center text-sm text-muted-foreground">
                Brak wyników
              </div>
            )}
            {filtered.slice(0, 50).map((opt) => {
              const isChecked = selected.includes(opt.id);
              return (
                <label
                  key={opt.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-pointer hover:bg-accent"
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        onChange([...selected, opt.id]);
                      } else {
                        onChange(selected.filter((id) => id !== opt.id));
                      }
                    }}
                  />
                  {opt.value}
                </label>
              );
            })}
            {filtered.length > 50 && (
              <div className="px-2 py-2 text-center text-xs text-muted-foreground">
                Wpisz więcej aby zawęzić ({filtered.length - 50} ukrytych)
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Memoized Parameter Row ─── */

interface ParameterRowProps {
  param: AllegroParameter;
  value: string | string[] | undefined;
  match: ParameterMatchResult | undefined;
  aiFill: AutoFillEntry | undefined;
  isRequired: boolean;
  checked: boolean;
  onToggle: (key: string) => void;
  onValueChange: (id: string, val: string | string[]) => void;
}

const ParameterRow = memo(function ParameterRow({
  param,
  value,
  match,
  aiFill,
  isRequired,
  checked,
  onToggle,
  onValueChange,
}: ParameterRowProps) {
  const handleChange = useCallback(
    (v: string | string[]) => onValueChange(param.id, v),
    [param.id, onValueChange]
  );

  const isEmpty = !value || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && value.length === 0);
  const fieldKey = isRequired ? param.id : `param_${param.id}`;

  return (
    <FieldRow
      key={param.id}
      fieldKey={fieldKey}
      label={param.name}
      checked={checked}
      locked={isRequired}
      onToggle={onToggle}
      validationError={isRequired && isEmpty}
      conditionLabel={param.unit ? `${param.unit}` : undefined}
    >
      {(isRequired || checked) && (
        <div className="space-y-1">
          <div className="flex items-start gap-1">
            <div className="flex-1 min-w-0">
              <ParameterEditor
                param={param}
                value={value}
                onChange={handleChange}
              />
            </div>
            {!isEmpty && (
              <button
                type="button"
                onClick={() => onValueChange(param.id, Array.isArray(value) ? [] : '')}
                className="mt-1.5 p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                title="Wyczyść"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          {/* Sheet match indicators */}
          {match && match.confidence >= 0.7 && (
            <p className="text-[10px] text-green-600 flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-green-500 inline-block" />
              Z arkusza: {match.sheetValue}
            </p>
          )}
          {match && match.confidence > 0 && match.confidence < 0.7 && (
            <p className="text-[10px] text-amber-600 flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-amber-500 inline-block" />
              Sugestia: {match.sheetValue} (niepewne)
            </p>
          )}
          {/* AI fill indicator */}
          {!match && aiFill && aiFill.confidence >= 0.5 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {aiFill.confidence >= 0.8 ? (
                <div className="flex items-center gap-1.5 bg-blue-50 dark:bg-blue-950/20 rounded px-1.5 py-0.5">
                  <Sparkles className="size-3 text-blue-500" />
                  <p className="text-[10px] text-blue-600 font-medium">
                    AI: {aiFill.source} ({Math.round(aiFill.confidence * 100)}%)
                  </p>
                </div>
              ) : (
                <p className="text-[10px] text-amber-600 flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-amber-400 inline-block" />
                  AI sugestia: {aiFill.source} ({Math.round(aiFill.confidence * 100)}%)
                </p>
              )}
              {isEmpty && (
                <button
                  type="button"
                  onClick={() => onValueChange(param.id, aiFill.value)}
                  className="text-[10px] font-medium text-blue-700 bg-blue-100 hover:bg-blue-200 px-1.5 py-0.5 rounded transition-colors"
                >
                  Zastosuj
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </FieldRow>
  );
});

/* ─── Parameter Value Editor ─── */

function ParameterEditor({
  param,
  value,
  onChange,
}: {
  param: AllegroParameter;
  value: string | string[] | undefined;
  onChange: (val: string | string[]) => void;
}) {
  // Prawdziwe API Allegro: opcje w param.dictionary (tablica), param.options to obiekt z metadanymi
  const rawOpts = param.dictionary ?? (Array.isArray(param.options) ? param.options : null) ?? param.restrictions?.allowedValues ?? [];
  const opts = rawOpts.filter((o): o is { id: string; value: string } => o != null && o.id != null && o.value != null);

  if (param.type === 'dictionary' || opts.length > 0) {
    if (param.restrictions?.multipleChoices) {
      const selected = Array.isArray(value) ? value : value ? [value] : [];
      return (
        <MultiSelect
          options={opts}
          selected={selected}
          onChange={onChange}
        />
      );
    }
    return (
      <FilterableSelect
        value={typeof value === 'string' ? value : ''}
        onValueChange={(v) => onChange(v)}
        options={opts.map((o) => ({ id: o.id, label: o.value }))}
        placeholder="-- wybierz --"
      />
    );
  }

  if (param.type === 'boolean') {
    const strVal = typeof value === 'string' ? value : '';
    return (
      <div className="flex gap-1">
        {[
          { v: 'true', label: 'Tak' },
          { v: 'false', label: 'Nie' },
        ].map(({ v, label }) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={cn(
              'flex-1 h-9 rounded-lg border text-sm font-medium transition-colors',
              strVal === v
                ? 'border-primary bg-accent text-accent-foreground'
                : 'border-input hover:bg-muted'
            )}
          >
            {label}
          </button>
        ))}
      </div>
    );
  }

  if (param.type === 'date') {
    return (
      <DatePicker
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (param.type === 'datetime') {
    return (
      <DatePicker
        includeTime
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <Input
      type={param.type === 'integer' || param.type === 'float' ? 'number' : 'text'}
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={param.unit ? `Wartość [${param.unit}]` : 'Wartość'}
      min={param.restrictions?.min}
      max={param.restrictions?.max}
    />
  );
}

/* ─── Extra Field Value Editor ─── */

function ExtraFieldEditor({
  field,
  value,
  onChange,
}: {
  field: BLExtraField;
  value: string;
  onChange: (val: string) => void;
}) {
  if (field.kind === 'list') {
    const options = field.editor
      ? field.editor.split('\n').filter(Boolean).map((v) => ({ id: v, label: v }))
      : [];

    if (options.length > 0) {
      return (
        <FilterableSelect
          value={value}
          onValueChange={onChange}
          options={options}
          placeholder="-- wybierz --"
        />
      );
    }
    return (
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Wartość"
      />
    );
  }

  return (
    <Input
      type={field.kind === 'number' ? 'number' : 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Wartość"
    />
  );
}

/* ─── Error Boundary ─── */

class ParametersErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center gap-2 p-4 rounded-lg border border-destructive/30 bg-destructive/5 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          Błąd ładowania parametrów — odśwież stronę
        </div>
      );
    }
    return this.props.children;
  }
}

/* ─── Main Component ─── */

export function FieldsAndParametersStep(props: FieldsAndParametersStepProps) {
  return (
    <ParametersErrorBoundary>
      <FieldsAndParametersStepInner {...props} />
    </ParametersErrorBoundary>
  );
}

function FieldsAndParametersStepInner({
  mode,
  extraFields,
  parameters: rawParameters,
  initialFieldSelection,
  initialParameterValues,
  fieldValues,
  onFieldSelectionChange,
  onParameterValuesChange,
  isTitleGenerated,
  sheetMatchResults,
  aiFillResults,
  aiFillStatus,
  isBundle,
  onIsBundleChange,
  bundleProducts,
  onBundleProductsChange,
  inventoryId,
  initialExtraFieldValues,
  onExtraFieldValuesChange,
  onTaxRateChange,
  taxRate,
  editableFieldValues,
  onEditableFieldValueChange,
  manufacturers,
}: FieldsAndParametersStepProps) {
  const parameters = rawParameters ?? [];

  // Build a lookup for sheet match results by parameter ID
  const matchByParamId = useMemo(() =>
    (sheetMatchResults ?? []).reduce<Record<string, ParameterMatchResult>>(
      (acc, r) => { acc[r.parameterId] = r; return acc; }, {}
    ), [sheetMatchResults]
  );

  // Build a lookup for AI fill results by parameter ID
  const aiFillByParamId = useMemo(() =>
    (aiFillResults ?? []).reduce<Record<string, AutoFillEntry>>(
      (acc, r) => { acc[r.parameterId] = r; return acc; }, {}
    ), [aiFillResults]
  );
  const { preferences, mergePreferences } = useFieldPreferences();

  // Initialize field selection: session > localStorage > defaults
  const [selection, setSelection] = useState<Partial<FieldSelection>>(() => {
    const defaults = createDefaultFieldSelection(mode);
    return { ...defaults, ...preferences, ...initialFieldSelection };
  });

  const [paramValues, setParamValues] = useState<Record<string, string | string[]>>(
    initialParameterValues ?? {}
  );
  const lastSyncedParams = useRef(initialParameterValues);
  useEffect(() => {
    if (initialParameterValues !== lastSyncedParams.current) {
      lastSyncedParams.current = initialParameterValues;
      setParamValues(initialParameterValues ?? {});
    }
  }, [initialParameterValues]);

  // Extra field values stored separately
  const [extraFieldValues, setExtraFieldValues] = useState<Record<string, string>>(initialExtraFieldValues ?? {});
  const lastSyncedExtras = useRef(initialExtraFieldValues);
  useEffect(() => {
    if (initialExtraFieldValues !== lastSyncedExtras.current) {
      lastSyncedExtras.current = initialExtraFieldValues;
      setExtraFieldValues(initialExtraFieldValues ?? {});
    }
  }, [initialExtraFieldValues]);

  // Section collapse state
  const [expandedSections, setExpandedSections] = useState({
    basic: true,
    extra: true,
    params: true,
  });

  // Toggle field selection
  const toggleField = useCallback(
    (key: string) => {
      setSelection((prev) => {
        const next = { ...prev, [key]: !prev[key as keyof FieldSelection] };
        onFieldSelectionChange(next);
        mergePreferences({ [key]: next[key as keyof FieldSelection] } as Partial<FieldSelection>);
        return next;
      });
    },
    [onFieldSelectionChange, mergePreferences]
  );

  // Update parameter value
  const updateParamValue = useCallback(
    (id: string, value: string | string[]) => {
      setParamValues((prev) => {
        const next = { ...prev, [id]: value };
        lastSyncedParams.current = next;
        onParameterValuesChange(next);
        return next;
      });
    },
    [onParameterValuesChange]
  );

  // Update extra field value
  const updateExtraFieldValue = useCallback(
    (key: string, value: string) => {
      setExtraFieldValues((prev) => {
        const next = { ...prev, [key]: value };
        lastSyncedExtras.current = next;
        onExtraFieldValuesChange?.(next);
        return next;
      });
    },
    [onExtraFieldValuesChange]
  );

  const toggleSection = useCallback((section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }, []);

  // Build rows
  const modeExtraField = MODE_EXTRA_FIELDS[mode];
  const requiredParams = useMemo(() => parameters.filter((p) => p.required), [parameters]);
  const optionalParams = useMemo(() => parameters.filter((p) => !p.required), [parameters]);

  // Lazy rendering for optional parameters
  const OPTIONAL_RENDER_LIMIT = 30;
  const [showAllOptional, setShowAllOptional] = useState(false);

  const visibleOptionalParams = useMemo(() => {
    if (showAllOptional || optionalParams.length <= OPTIONAL_RENDER_LIMIT) return optionalParams;
    const withValues = new Set(
      optionalParams.filter((p) => {
        const v = paramValues[p.id];
        return v && (typeof v === 'string' ? v.trim() : v.length > 0);
      }).map((p) => p.id)
    );
    const result: AllegroParameter[] = [];
    for (const p of optionalParams) {
      if (result.length < OPTIONAL_RENDER_LIMIT || withValues.has(p.id)) {
        result.push(p);
      }
    }
    return result;
  }, [optionalParams, paramValues, showAllOptional]);

  const basicFieldCount = MANDATORY_FIELDS.length + OPTIONAL_FIELDS.length + (modeExtraField ? 1 : 0);
  const extraFieldCount = extraFields.length;
  const paramCount = parameters.length;

  return (
    <div className="-mx-1 px-1 space-y-1">
      {/* ─── Section 1: Dane podstawowe ─── */}
      <SectionHeader
        title="Dane podstawowe"
        count={basicFieldCount}
        expanded={expandedSections.basic}
        onToggle={() => toggleSection('basic')}
      />
      {expandedSections.basic && (
        <div className="space-y-0.5">
          {/* Mandatory fields */}
          {MANDATORY_FIELDS.map((key) => (
            <FieldRow
              key={key}
              fieldKey={key}
              label={MANDATORY_LABELS[key] || key}
              checked={true}
              locked={key !== 'tax_rate'}
              previewValue={key === 'tax_rate' ? undefined : fieldValues[key]}
              onToggle={toggleField}
              conditionLabel={key === 'name' && !isTitleGenerated ? 'oryginalny — wygeneruj tytuł' : undefined}
            >
              {key === 'tax_rate' && (
                <Select
                  value={String(taxRate ?? 23)}
                  onValueChange={(v) => onTaxRateChange?.(isNaN(Number(v)) ? v : Number(v))}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Stawka VAT" />
                  </SelectTrigger>
                  <SelectContent>
                    {TAX_RATE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FieldRow>
          ))}

          {/* is_bundle toggle */}
          <div className="grid grid-cols-[2rem_1fr_minmax(12rem,20rem)] items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/40">
            <div className="flex items-center justify-center pt-0.5">
              <Checkbox checked={true} disabled />
            </div>
            <div className="min-w-0 pt-0.5">
              <span className="text-sm text-foreground">Bundle (zestaw)</span>
              <span className="text-xs text-muted-foreground block">
                {isBundle ? 'Tak — produkt jest zestawem' : 'Nie — produkt podstawowy'}
              </span>
            </div>
            <div className="flex gap-1">
              {[
                { v: false, label: 'Nie' },
                { v: true, label: 'Tak' },
              ].map(({ v, label }) => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => onIsBundleChange(v)}
                  className={cn(
                    'flex-1 h-9 rounded-lg border text-sm font-medium transition-colors',
                    isBundle === v
                      ? 'border-primary bg-accent text-accent-foreground'
                      : 'border-input hover:bg-muted'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Bundle products picker */}
          {isBundle && (
            <div className="mx-3 mt-1 mb-2">
              <BundleProductsPicker
                inventoryId={inventoryId}
                bundleProducts={bundleProducts}
                onChange={onBundleProductsChange}
              />
            </div>
          )}

          {/* Mode-specific mandatory */}
          {modeExtraField && modeExtraField.key !== 'bundle_products' && (
            <FieldRow
              fieldKey={modeExtraField.key}
              label={modeExtraField.label}
              checked={true}
              locked={true}
              previewValue={fieldValues[modeExtraField.key]}
              onToggle={toggleField}
              conditionLabel={modeExtraField.mode}
            />
          )}

          {/* Separator between mandatory and optional */}
          <div className="mx-3 my-2 h-px bg-border/50" />

          {/* Optional fields with inline editors */}
          {OPTIONAL_FIELDS.map((f) => {
            const checked = !!selection[f.key as keyof FieldSelection];
            const efvVal = editableFieldValues?.[f.key] ?? '';
            return (
              <FieldRow
                key={f.key}
                fieldKey={f.key}
                label={f.label}
                checked={checked}
                locked={false}
                previewValue={!checked ? fieldValues[f.key] : undefined}
                onToggle={toggleField}
              >
                {checked && f.key === 'ean' && (
                  <Input
                    type="text"
                    value={efvVal || fieldValues['ean'] || ''}
                    onChange={(e) => onEditableFieldValueChange?.('ean', e.target.value)}
                    placeholder="Kod EAN"
                  />
                )}
                {checked && f.key === 'sku' && (
                  <Input
                    type="text"
                    value={efvVal || fieldValues['sku'] || ''}
                    onChange={(e) => onEditableFieldValueChange?.('sku', e.target.value)}
                    placeholder="SKU"
                  />
                )}
                {checked && f.key === 'weight' && (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={efvVal || fieldValues['weight'] || ''}
                      onChange={(e) => onEditableFieldValueChange?.('weight', e.target.value)}
                      placeholder="0.00"
                    />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">kg</span>
                  </div>
                )}
                {checked && f.key === 'dimensions' && (
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1">
                      <label className="text-[10px] text-muted-foreground block mb-0.5">Wys. (cm)</label>
                      <Input
                        type="number"
                        step="0.1"
                        min="0"
                        value={editableFieldValues?.['height'] ?? ''}
                        onChange={(e) => onEditableFieldValueChange?.('height', e.target.value)}
                        placeholder="0"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] text-muted-foreground block mb-0.5">Szer. (cm)</label>
                      <Input
                        type="number"
                        step="0.1"
                        min="0"
                        value={editableFieldValues?.['width'] ?? ''}
                        onChange={(e) => onEditableFieldValueChange?.('width', e.target.value)}
                        placeholder="0"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] text-muted-foreground block mb-0.5">Dł. (cm)</label>
                      <Input
                        type="number"
                        step="0.1"
                        min="0"
                        value={editableFieldValues?.['length'] ?? ''}
                        onChange={(e) => onEditableFieldValueChange?.('length', e.target.value)}
                        placeholder="0"
                      />
                    </div>
                  </div>
                )}
                {checked && f.key === 'stock' && (
                  <Input
                    type="number"
                    min="0"
                    value={efvVal || '0'}
                    onChange={(e) => onEditableFieldValueChange?.('stock', e.target.value)}
                    placeholder="0"
                  />
                )}
                {checked && f.key === 'prices' && (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={efvVal || fieldValues['prices']?.replace(/[^\d.,]/g, '') || ''}
                      onChange={(e) => onEditableFieldValueChange?.('prices', e.target.value)}
                      placeholder="0.00"
                    />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">PLN</span>
                  </div>
                )}
                {checked && f.key === 'locations' && (
                  <Input
                    type="text"
                    value={efvVal || ''}
                    onChange={(e) => onEditableFieldValueChange?.('locations', e.target.value)}
                    placeholder="np. Regał A1"
                  />
                )}
                {checked && f.key === 'manufacturer_id' && (
                  manufacturers && manufacturers.length > 0 ? (
                    <FilterableSelect
                      value={efvVal || ''}
                      onValueChange={(v) => onEditableFieldValueChange?.('manufacturer_id', v)}
                      options={manufacturers.map((m) => ({ id: String(m.manufacturer_id), label: m.name }))}
                      placeholder="-- wybierz producenta --"
                    />
                  ) : (
                    <Input
                      type="text"
                      value={efvVal || fieldValues['manufacturer_id'] || ''}
                      onChange={(e) => onEditableFieldValueChange?.('manufacturer_id', e.target.value)}
                      placeholder="Producent"
                    />
                  )
                )}
                {checked && f.key === 'average_cost' && (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={efvVal || ''}
                      onChange={(e) => onEditableFieldValueChange?.('average_cost', e.target.value)}
                      placeholder="0.00"
                    />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">PLN</span>
                  </div>
                )}
              </FieldRow>
            );
          })}
        </div>
      )}

      {/* ─── Section 2: Pola dodatkowe ─── */}
      {extraFields.length > 0 && (
        <>
          <SectionHeader
            title="Pola dodatkowe"
            count={extraFieldCount}
            expanded={expandedSections.extra}
            onToggle={() => toggleSection('extra')}
          />
          {expandedSections.extra && (
            <div className="space-y-0.5">
              {extraFields.map((ef) => {
                const key = `extra_field_${ef.extra_field_id}`;
                const checked = !!selection[key as keyof FieldSelection];
                const val = extraFieldValues[key] || '';
                const needsValue = checked && !val.trim();

                return (
                  <FieldRow
                    key={key}
                    fieldKey={key}
                    label={ef.name}
                    checked={checked}
                    locked={false}
                    onToggle={toggleField}
                    validationError={needsValue}
                  >
                    {checked && (
                      <ExtraFieldEditor
                        field={ef}
                        value={val}
                        onChange={(v) => updateExtraFieldValue(key, v)}
                      />
                    )}
                  </FieldRow>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ─── Section 3: Parametry ─── */}
      {parameters.length > 0 && (
        <>
          <SectionHeader
            title="Parametry"
            count={paramCount}
            expanded={expandedSections.params}
            onToggle={() => toggleSection('params')}
          />

          {/* AI auto-fill status banner */}
          {aiFillStatus === 'loading' && (
            <div className="flex items-center gap-2 mx-3 mb-2 px-3 py-2 rounded-lg bg-primary/5 text-sm text-primary">
              <Loader className="size-3.5 animate-spin" />
              AI wypełnia parametry...
            </div>
          )}
          {aiFillStatus === 'done' && (aiFillResults?.length ?? 0) > 0 && (
            <div className="flex items-center gap-2 mx-3 mb-2 px-3 py-2 rounded-lg bg-green-50 text-sm text-green-700">
              <span className="size-2 rounded-full bg-green-500 inline-block" />
              AI wypełniło {aiFillResults?.length ?? 0} z {paramCount} parametrów
            </div>
          )}
          {aiFillStatus === 'error' && (
            <div className="flex items-center gap-2 mx-3 mb-2 px-3 py-2 rounded-lg bg-amber-50 text-sm text-amber-700">
              <AlertCircle className="size-3.5" />
              AI nie mogło wypełnić parametrów
            </div>
          )}
          {expandedSections.params && (
            <div className="space-y-1">
              {/* Required parameters */}
              {requiredParams.length > 0 && (
                <div className="rounded-lg bg-amber-50/40 dark:bg-amber-950/10 p-2 space-y-1">
                  <div className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider px-3 pb-1">
                    Wymagane ({requiredParams.length})
                  </div>
                  {requiredParams.map((param) => (
                    <ParameterRow
                      key={param.id}
                      param={param}
                      value={paramValues[param.id]}
                      match={matchByParamId[param.id]}
                      aiFill={aiFillByParamId[param.id]}
                      isRequired={true}
                      checked={true}
                      onToggle={toggleField}
                      onValueChange={updateParamValue}
                    />
                  ))}
                </div>
              )}

              {/* Optional parameters */}
              {visibleOptionalParams.map((param) => {
                const paramKey = `param_${param.id}`;
                const checked = selection[paramKey as keyof FieldSelection] !== false;
                return (
                  <ParameterRow
                    key={param.id}
                    param={param}
                    value={paramValues[param.id]}
                    match={matchByParamId[param.id]}
                    aiFill={aiFillByParamId[param.id]}
                    isRequired={false}
                    checked={checked}
                    onToggle={toggleField}
                    onValueChange={updateParamValue}
                  />
                );
              })}
              {!showAllOptional && optionalParams.length > OPTIONAL_RENDER_LIMIT && (
                <button
                  type="button"
                  onClick={() => setShowAllOptional(true)}
                  className="w-full py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Pokaż wszystkie ({optionalParams.length - visibleOptionalParams.length} ukrytych)
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
