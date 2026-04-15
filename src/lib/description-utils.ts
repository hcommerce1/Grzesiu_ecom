import type { ImageMeta, DescriptionSection, DescriptionInputSnapshot, ChangeSeverity, ChangeClassification, ChangeDetail } from './types';

/**
 * Prosty hash stringa (djb2).
 */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return hash.toString(36);
}

/**
 * Oblicza hash danych wejsciowych opisu.
 */
export function computeInputHash(snapshot: DescriptionInputSnapshot): string {
  const data = JSON.stringify({
    title: snapshot.title,
    images: snapshot.imagesMeta.filter(i => !i.removed).map(i => ({
      url: i.url,
      desc: i.userDescription || i.aiDescription,
      order: i.order,
    })),
    params: snapshot.filledParameters,
    cat: snapshot.categoryId,
    attrs: snapshot.translatedAttributes,
  });
  return simpleHash(data);
}

/**
 * Levenshtein distance ratio (0 = identical, 1 = completely different).
 */
function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return 1;

  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length] / Math.max(a.length, b.length);
}

/**
 * Klasyfikuje zmiany między snapshotami z granularnym opisem.
 */
export function classifyChangesDetailed(
  oldSnapshot: DescriptionInputSnapshot | undefined,
  newSnapshot: DescriptionInputSnapshot,
): ChangeClassification {
  if (!oldSnapshot) return { severity: 'major', changes: [{ field: 'all', label: 'Brak poprzedniego stanu — wymagana pełna generacja', severity: 'major' }] };

  const changes: ChangeDetail[] = [];

  // Zmiana kategorii
  if (oldSnapshot.categoryId !== newSnapshot.categoryId) {
    changes.push({ field: 'category', label: 'Zmieniono kategorię Allegro', severity: 'major' });
  }

  // Zmiana zdjęć
  const oldImgs = oldSnapshot.imagesMeta.filter(i => !i.removed);
  const newImgs = newSnapshot.imagesMeta.filter(i => !i.removed);

  if (oldImgs.length !== newImgs.length) {
    const diff = newImgs.length - oldImgs.length;
    if (diff > 0) {
      changes.push({ field: 'images-added', label: `Dodano ${diff} ${diff === 1 ? 'zdjęcie' : diff < 5 ? 'zdjęcia' : 'zdjęć'}`, severity: 'major' });
    } else {
      changes.push({ field: 'images-removed', label: `Usunięto ${Math.abs(diff)} ${Math.abs(diff) === 1 ? 'zdjęcie' : Math.abs(diff) < 5 ? 'zdjęcia' : 'zdjęć'}`, severity: 'major' });
    }
  } else {
    // Same count — check reorder and description changes
    let reordered = false;
    let descChanged = false;
    for (let idx = 0; idx < oldImgs.length; idx++) {
      const old = oldImgs[idx];
      const nw = newImgs[idx];
      if (!nw) continue;
      if (old.url !== nw.url) reordered = true;
      if ((old.userDescription || old.aiDescription) !== (nw.userDescription || nw.aiDescription)) {
        descChanged = true;
      }
    }
    if (reordered) {
      changes.push({ field: 'images-reorder', label: 'Zmieniono kolejność zdjęć', severity: 'minor' });
    }
    if (descChanged) {
      changes.push({ field: 'images-desc', label: 'Zmieniono opisy zdjęć', severity: 'minor' });
    }
  }

  // Tytuł
  const titleDist = levenshteinRatio(oldSnapshot.title, newSnapshot.title);
  if (titleDist > 0) {
    if (titleDist > 0.3) {
      changes.push({ field: 'title', label: `Znacząca zmiana tytułu (${Math.round(titleDist * 100)}% różnicy)`, severity: 'major' });
    } else if (titleDist > 0.15) {
      changes.push({ field: 'title', label: `Umiarkowana zmiana tytułu (${Math.round(titleDist * 100)}% różnicy)`, severity: 'minor' });
    } else {
      changes.push({ field: 'title', label: `Drobna korekta tytułu (${Math.round(titleDist * 100)}% różnicy)`, severity: 'minor' });
    }
  }

  // Parametry
  const allParamKeys = new Set([
    ...Object.keys(oldSnapshot.filledParameters),
    ...Object.keys(newSnapshot.filledParameters),
  ]);
  let paramChanges = 0;
  for (const key of allParamKeys) {
    const oldVal = JSON.stringify(oldSnapshot.filledParameters[key] ?? '');
    const newVal = JSON.stringify(newSnapshot.filledParameters[key] ?? '');
    if (oldVal !== newVal) paramChanges++;
  }
  if (paramChanges > 0) {
    const severity: 'minor' | 'major' = paramChanges >= 4 ? 'major' : 'minor';
    changes.push({
      field: 'parameters',
      label: `Zmieniono ${paramChanges} ${paramChanges === 1 ? 'parametr' : paramChanges < 5 ? 'parametry' : 'parametrów'}`,
      severity,
    });
  }

  // Atrybuty przetłumaczone
  const oldAttrs = Object.keys(oldSnapshot.translatedAttributes).length;
  const newAttrs = Object.keys(newSnapshot.translatedAttributes).length;
  if (JSON.stringify(oldSnapshot.translatedAttributes) !== JSON.stringify(newSnapshot.translatedAttributes)) {
    const diff = newAttrs - oldAttrs;
    if (Math.abs(diff) > 3) {
      changes.push({ field: 'attributes', label: `Zmieniono atrybuty produktu (${diff > 0 ? '+' : ''}${diff})`, severity: 'major' });
    } else if (diff !== 0 || oldAttrs !== newAttrs) {
      changes.push({ field: 'attributes', label: 'Drobna zmiana atrybutów produktu', severity: 'minor' });
    }
  }

  // Determine overall severity
  if (changes.length === 0) return { severity: 'none', changes: [] };
  const hasMajor = changes.some(c => c.severity === 'major');
  return { severity: hasMajor ? 'major' : 'minor', changes };
}

/**
 * Backward-compatible wrapper — returns just the severity string.
 */
export function classifyChanges(
  oldSnapshot: DescriptionInputSnapshot | undefined,
  newSnapshot: DescriptionInputSnapshot,
): ChangeSeverity {
  return classifyChangesDetailed(oldSnapshot, newSnapshot).severity;
}

/**
 * Kompiluje sekcje do HTML z klasami CSS (BaseLinker template format).
 */
export function compileSectionsToHtml(sections: DescriptionSection[]): string {
  const parts: string[] = [];

  for (const section of sections) {
    if (section.layout === 'images-only') {
      for (const url of section.imageUrls) {
        parts.push(`<section class="section">    <div class="item item-12">        <section class="image-item">            <img src="${url}"/>        </section>    </div></section>`);
      }
    } else {
      const imgUrl = section.imageUrls[0];
      if (imgUrl) {
        parts.push(`<section class="section">    <div class="item item-6">        <section class="image-item">            <img src="${imgUrl}"/>        </section>    </div>    <div class="item item-6">        <section class="text-item">            ${section.heading ? `<h2>${section.heading}</h2>` : ''}${section.bodyHtml}        </section>    </div></section>`);
      }
    }
  }

  return parts.join('');
}

/**
 * CSS do podglądu opisu w preview (klasy z BaseLinker template).
 */
export const DESCRIPTION_PREVIEW_CSS = `<style>.section{display:flex;gap:24px;margin-bottom:32px;align-items:flex-start}.item{box-sizing:border-box}.item-6{flex:0 0 50%;max-width:50%}.item-12{flex:0 0 100%;max-width:100%}.image-item img{width:100%;height:auto;border-radius:8px}.text-item h2{margin:0 0 12px;font-size:18px;font-weight:700;color:#222}.text-item{font-size:14px;line-height:1.6;color:#444}</style>`;

/**
 * Buduje snapshot danych wejsciowych opisu z aktualnego stanu sesji.
 */
export function buildInputSnapshot(
  title: string,
  imagesMeta: ImageMeta[],
  filledParameters: Record<string, string | string[]>,
  categoryId: string,
  translatedAttributes: Record<string, string>,
): DescriptionInputSnapshot {
  return {
    title,
    imagesMeta: imagesMeta.filter(i => !i.removed),
    filledParameters,
    categoryId,
    translatedAttributes,
  };
}

/**
 * Przygotowuje prompt z podstawionymi zmiennymi.
 */
export function interpolatePrompt(
  template: string,
  vars: {
    title: string;
    attributes: string;
    category: string;
    parameters: string;
    image_count: number;
    image_descriptions: string;
    uwagi: string;
  },
): string {
  return template
    .replace(/\{title\}/g, vars.title)
    .replace(/\{attributes\}/g, vars.attributes)
    .replace(/\{category\}/g, vars.category)
    .replace(/\{parameters\}/g, vars.parameters)
    .replace(/\{image_count\}/g, String(vars.image_count))
    .replace(/\{image_descriptions\}/g, vars.image_descriptions)
    .replace(/\{uwagi\}/g, vars.uwagi);
}
