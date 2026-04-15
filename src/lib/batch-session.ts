import type { ProductData, ProductSession, GeneratedDescription, DiffFieldInfo, ImageMeta } from './types';

// ─── Normalize string for comparison (lowercase, trim, remove diacritics) ───
function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

// ─── Find attribute key case/diacritic insensitive ───
function findAttrKey(attrs: Record<string, string>, key: string): string | undefined {
  const normKey = normalize(key);
  for (const k of Object.keys(attrs)) {
    if (normalize(k) === normKey) return k;
  }
  return undefined;
}

// ─── detectDiffFields ───
// Compare all products, find fields that differ between them.
export function detectDiffFields(products: ProductData[]): DiffFieldInfo[] {
  if (products.length === 0) return [];

  const fields: DiffFieldInfo[] = [];

  // --- title ---
  const titles = products.map(p => normalize(p.title));
  const uniqueTitles = new Set(titles);
  fields.push({
    field: 'title',
    label: 'Tytuł',
    isDiff: uniqueTitles.size > 1,
    uniqueValues: [...new Set(products.map(p => p.title))].slice(0, 10),
    totalUnique: uniqueTitles.size,
    coverage: 1,
  });

  // --- images ---
  // Images differ if overlap < 50% on average
  const allImageSets = products.map(p => new Set(p.images.map(img => img.replace(/\?.*$/, '').replace('/original/', '/').replace('/s1920/', '/'))));
  let imageDiff = false;
  if (products.length > 1) {
    for (let i = 1; i < allImageSets.length; i++) {
      const a = allImageSets[0];
      const b = allImageSets[i];
      const intersection = [...a].filter(x => b.has(x)).length;
      const union = new Set([...a, ...b]).size;
      if (union === 0 || intersection / union < 0.5) { imageDiff = true; break; }
    }
  }
  fields.push({
    field: 'images',
    label: 'Zdjęcia',
    isDiff: imageDiff,
    uniqueValues: [`${products[0]?.images.length ?? 0} zdjęć`],
    totalUnique: imageDiff ? products.length : 1,
    coverage: products.filter(p => p.images.length > 0).length / products.length,
  });

  // --- ean ---
  const eans = products.map(p => p.ean ?? '').filter(Boolean);
  const uniqueEans = new Set(eans);
  fields.push({
    field: 'ean',
    label: 'EAN',
    isDiff: true, // EAN is always treated as diff
    uniqueValues: [...uniqueEans].slice(0, 10),
    totalUnique: uniqueEans.size,
    coverage: eans.length / products.length,
  });

  // --- sku ---
  const skus = products.map(p => p.sku ?? '').filter(Boolean);
  const uniqueSkus = new Set(skus);
  if (uniqueSkus.size > 0) {
    fields.push({
      field: 'sku',
      label: 'SKU',
      isDiff: uniqueSkus.size > 1,
      uniqueValues: [...uniqueSkus].slice(0, 10),
      totalUnique: uniqueSkus.size,
      coverage: skus.length / products.length,
    });
  }

  // --- price ---
  const prices = products.map(p => p.price ?? '').filter(Boolean);
  const uniquePrices = new Set(prices);
  if (uniquePrices.size > 0) {
    fields.push({
      field: 'price',
      label: 'Cena',
      isDiff: uniquePrices.size > 1,
      uniqueValues: [...uniquePrices].slice(0, 10),
      totalUnique: uniquePrices.size,
      coverage: prices.length / products.length,
    });
  }

  // --- per-attribute ---
  const allAttrKeys = new Set<string>();
  for (const p of products) {
    for (const k of Object.keys(p.attributes ?? {})) {
      allAttrKeys.add(k);
    }
  }

  for (const key of allAttrKeys) {
    const values = products.map(p => {
      const found = findAttrKey(p.attributes ?? {}, key);
      return found ? (p.attributes[found] ?? '') : '';
    });
    const nonEmpty = values.filter(Boolean);
    if (nonEmpty.length === 0) continue;
    const uniqueVals = new Set(values.map(normalize));
    // Remove empty from unique count
    uniqueVals.delete('');
    fields.push({
      field: `attr:${key}`,
      label: key,
      isDiff: uniqueVals.size > 1,
      uniqueValues: [...new Set(nonEmpty)].slice(0, 10),
      totalUnique: uniqueVals.size,
      coverage: nonEmpty.length / products.length,
    });
  }

  // Sort: diff fields first, same last. Within each group sort by coverage desc.
  fields.sort((a, b) => {
    if (a.isDiff && !b.isDiff) return -1;
    if (!a.isDiff && b.isDiff) return 1;
    // Keep EAN + title + images at top of diff group
    const priority = ['ean', 'title', 'images', 'price', 'sku'];
    const ai = priority.indexOf(a.field);
    const bi = priority.indexOf(b.field);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return b.coverage - a.coverage;
  });

  return fields;
}

// ─── interpolateValue — replace {{Key}} placeholders in template string ───
export function interpolateValue(template: string, attrs: Record<string, string>): string {
  return template.replace(/\{\{([^{}]+)\}\}/g, (_, key) => {
    const found = findAttrKey(attrs, key.trim());
    return found ? (attrs[found] ?? `{{${key}}}`) : `{{${key}}}`;
  });
}

// ─── generateTitleTemplate ───
// Replaces known diff-field attribute values with {{AttrName}} placeholders
export function generateTitleTemplate(title: string, attrs: Record<string, string>, diffFields: string[]): string {
  let template = title;
  for (const field of diffFields) {
    if (!field.startsWith('attr:')) continue;
    const attrName = field.slice(5);
    const foundKey = findAttrKey(attrs, attrName);
    if (!foundKey) continue;
    const value = attrs[foundKey];
    if (!value || value.length < 2) continue;
    // Case-insensitive replace of the value with placeholder
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    template = template.replace(new RegExp(escaped, 'gi'), `{{${attrName}}}`);
  }
  return template;
}

// ─── templatizeDescription ───
// Replaces attribute values with {{AttrName}} placeholders in description sections
export function templatizeDescription(
  desc: GeneratedDescription,
  attrs: Record<string, string>,
  diffFields: string[]
): { templated: GeneratedDescription; placeholders: string[] } {
  const attrDiffFields = diffFields.filter(f => f.startsWith('attr:')).map(f => f.slice(5));
  const placeholders = new Set<string>();

  const sections = desc.sections.map(section => {
    let { bodyHtml, heading } = section;

    for (const attrName of attrDiffFields) {
      const foundKey = findAttrKey(attrs, attrName);
      if (!foundKey) continue;
      const value = attrs[foundKey];
      if (!value || value.length < 2) continue;
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'gi');
      if (regex.test(bodyHtml) || regex.test(heading)) {
        placeholders.add(attrName);
        bodyHtml = bodyHtml.replace(new RegExp(escaped, 'gi'), `{{${attrName}}}`);
        heading = heading.replace(new RegExp(escaped, 'gi'), `{{${attrName}}}`);
      }
    }

    return { ...section, bodyHtml, heading };
  });

  const templated: GeneratedDescription = {
    ...desc,
    sections,
    fullHtml: sections.map(s => s.bodyHtml).join(''),
  };

  return { templated, placeholders: [...placeholders] };
}

// ─── cloneSessionForItem ───
// Full clone of template session with item-specific field substitutions
export function cloneSessionForItem(
  template: ProductSession,
  itemData: ProductData,
  diffFields: string[],
  descTemplate: GeneratedDescription | null,
  titleTemplate: string | null,
  mode: 'new' | 'edit' | 'variant',
  parentId?: string,
  overrides?: Partial<ProductData>
): ProductSession {
  // Deep clone
  const clone: ProductSession = JSON.parse(JSON.stringify(template));

  const attrs = itemData.attributes ?? {};

  // Apply diff fields
  for (const field of diffFields) {
    if (field === 'title') {
      if (titleTemplate) {
        clone.data.title = interpolateValue(titleTemplate, attrs);
      } else {
        clone.data.title = itemData.title;
      }
    } else if (field === 'images') {
      clone.data.images = itemData.images;
      clone.images = itemData.images;
      clone.imagesMeta = itemData.images.map((url, i): ImageMeta => ({
        url,
        order: i,
        removed: false,
        aiDescription: '',
        aiConfidence: 0,
        userDescription: '',
        isFeatureImage: i === 0,
        features: [],
      }));
    } else if (field === 'ean') {
      clone.data.ean = itemData.ean ?? '';
    } else if (field === 'sku') {
      clone.data.sku = itemData.sku ?? '';
    } else if (field === 'price') {
      if (itemData.price && clone.editableFieldValues) {
        clone.editableFieldValues.prices = itemData.price;
      }
    } else if (field === 'weight') {
      const foundKey = findAttrKey(attrs, 'waga') ?? findAttrKey(attrs, 'weight');
      if (foundKey && clone.editableFieldValues) {
        clone.editableFieldValues.weight = attrs[foundKey];
      }
    } else if (field === 'dimensions') {
      const h = findAttrKey(attrs, 'wysokosc') ?? findAttrKey(attrs, 'height');
      const w = findAttrKey(attrs, 'szerokosc') ?? findAttrKey(attrs, 'width');
      const l = findAttrKey(attrs, 'dlugosc') ?? findAttrKey(attrs, 'length');
      if (h && clone.editableFieldValues) clone.editableFieldValues.height = attrs[h];
      if (w && clone.editableFieldValues) clone.editableFieldValues.width = attrs[w];
      if (l && clone.editableFieldValues) clone.editableFieldValues.length = attrs[l];
    } else if (field.startsWith('attr:')) {
      const attrName = field.slice(5);
      const foundKey = findAttrKey(attrs, attrName);
      if (foundKey && clone.filledParameters) {
        // Try to find the Allegro parameter ID matching this attribute name
        const paramId = findAllegroParamId(clone, attrName);
        if (paramId) {
          clone.filledParameters[paramId] = attrs[foundKey];
        }
      }
    }
  }

  // Interpolate description
  if (descTemplate) {
    const sections = descTemplate.sections.map(section => ({
      ...section,
      bodyHtml: interpolateValue(section.bodyHtml, attrs),
      heading: interpolateValue(section.heading, attrs),
      // Map image positions from template → variant images
      imageUrls: section.imageUrls.map((_, i) => itemData.images[i] ?? '').filter(Boolean),
    }));
    const fullHtml = sections.map(s => {
      let html = '';
      if (s.heading) html += `<h2>${s.heading}</h2>`;
      html += s.bodyHtml;
      return html;
    }).join('');
    clone.generatedDescription = { ...descTemplate, sections, fullHtml, generatedAt: new Date().toISOString() };
  }

  // Apply overrides
  if (overrides) {
    if (overrides.title) clone.data.title = overrides.title;
    if (overrides.ean) clone.data.ean = overrides.ean;
    if (overrides.sku) clone.data.sku = overrides.sku;
    if (overrides.price && clone.editableFieldValues) clone.editableFieldValues.prices = overrides.price;
  }

  // Set mode
  clone.mode = mode;
  if (mode === 'variant' && parentId) {
    clone.parent_id = parentId;
  }

  return clone;
}

// ─── Find Allegro parameter ID by name match ───
function findAllegroParamId(session: ProductSession, attrName: string): string | null {
  const params = session.allegroParameters ?? [];
  const normAttrName = normalize(attrName);
  for (const param of params) {
    if (normalize(param.name) === normAttrName) return param.id;
  }
  return null;
}

// ─── applyTitleDiff ───
// Detect word-level diff and batch replace in all titles
export function applyTitleDiff(
  titles: string[],
  oldTitle: string,
  newTitle: string
): { updatedTitles: string[]; changed: number } {
  // Find words that differ
  const oldWords = oldTitle.split(/\s+/);
  const newWords = newTitle.split(/\s+/);

  if (oldWords.length !== newWords.length) {
    // Can't do word-level replace, just return as-is
    return { updatedTitles: titles, changed: 0 };
  }

  const replacements: Array<{ from: string; to: string }> = [];
  for (let i = 0; i < oldWords.length; i++) {
    if (normalize(oldWords[i]) !== normalize(newWords[i])) {
      replacements.push({ from: oldWords[i], to: newWords[i] });
    }
  }

  if (replacements.length === 0) return { updatedTitles: titles, changed: 0 };

  let changed = 0;
  const updatedTitles = titles.map(title => {
    let updated = title;
    for (const { from, to } of replacements) {
      const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const next = updated.replace(new RegExp(escaped, 'gi'), to);
      if (next !== updated) changed++;
      updated = next;
    }
    return updated;
  });

  return { updatedTitles, changed };
}
