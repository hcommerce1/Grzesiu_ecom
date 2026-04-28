import type { ImageGenIntent, ImageGenMode, ImageGenProvider, PhotoRoomOperation } from './types';

/**
 * Kliencka pre-walidacja promptu PRZED wysłaniem do API klasyfikacji.
 * Oszczędza tokeny na oczywistych śmieciach.
 */
export function isPromptValid(prompt: string): { valid: boolean; reason?: string } {
  const trimmed = prompt.trim();

  if (!trimmed) {
    return { valid: false, reason: 'Prompt jest pusty.' };
  }

  if (trimmed.length < 5) {
    return { valid: false, reason: 'Prompt jest za krótki — opisz dokładniej, co chcesz wygenerować.' };
  }

  // Sprawdź czy to nie powtórzony znak (np. "aaaa", "...")
  const uniqueChars = new Set(trimmed.replace(/\s/g, ''));
  if (uniqueChars.size <= 2) {
    return { valid: false, reason: 'Prompt wygląda na bezsensowny — użyj konkretnego opisu.' };
  }

  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount < 2) {
    return { valid: false, reason: 'Opisz bardziej szczegółowo (minimum 2 słowa).' };
  }

  return { valid: true };
}

/**
 * Polskie nazwy providerów do wyświetlenia w UI.
 */
export function getProviderDisplayName(provider: ImageGenProvider): string {
  switch (provider) {
    case 'removebg':
      return 'Remove.bg';
    case 'replicate':
      return 'Replicate (SDXL)';
    case 'nanobananapro':
      return 'NanoBananaPro';
    case 'fluxcontextpro':
      return 'FluxContextPro';
    case 'photoroom':
      return 'PhotoRoom';
  }
}

/**
 * Wskazówka kosztowa dla użytkownika.
 */
export function getProviderCostHint(provider: ImageGenProvider): string {
  switch (provider) {
    case 'removebg':
      return '$';
    case 'replicate':
      return '$$';
    case 'nanobananapro':
      return '$$$';
    case 'fluxcontextpro':
      return '$$$$';
    case 'photoroom':
      return '$$$';
  }
}

/**
 * Polska nazwa intencji.
 */
export function getIntentDisplayName(intent: ImageGenIntent): string {
  switch (intent) {
    case 'background_removal':
      return 'Usuwanie tła';
    case 'replace_background':
      return 'Zamiana tła';
    case 'simple_edit':
      return 'Prosta edycja';
    case 'generation':
      return 'Generacja zdjęcia';
    case 'context_edit':
      return 'Edycja kontekstowa';
    case 'relight':
      return 'Zmiana oświetlenia';
    case 'add_shadow':
      return 'Dodanie cienia';
    case 'remove_text':
      return 'Usunięcie tekstu';
    case 'upscale':
      return 'Powiększenie rozdzielczości';
    case 'expand':
      return 'Rozszerzenie kadru';
  }
}

export function getPhotoRoomOperationDisplayName(op: PhotoRoomOperation): string {
  switch (op) {
    case 'remove_background': return 'Usuń tło';
    case 'replace_background': return 'Zamień tło';
    case 'relight': return 'Zmień oświetlenie';
    case 'add_shadow': return 'Dodaj cień';
    case 'remove_text': return 'Usuń tekst';
    case 'upscale': return 'Upscale 2x';
    case 'expand': return 'Rozszerz kadr';
    case 'flat_lay': return 'Flat lay';
    case 'ghost_mannequin': return 'Ghost mannequin';
    case 'custom': return 'Edycja AI';
  }
}

/**
 * Deterministyczna detekcja trybu (generate vs edit) bez wywołania AI.
 * Brak source image → zawsze generate.
 * Jest source + prompt mówi "wygeneruj/stwórz nowe" → generate.
 * Jest source + reszta → edit.
 */
export function detectImageMode(hasSourceImage: boolean, prompt: string): ImageGenMode {
  if (!hasSourceImage) return 'generate';
  const generateKeywords = /\b(wygeneruj|stw[oó]rz|zr[oó]b\s+nowe|nowe\s+zdj[eę]cie|od\s+nowa|generate|create\s+new)\b/i;
  if (generateKeywords.test(prompt)) return 'generate';
  return 'edit';
}

/**
 * Polska nazwa trybu.
 */
export function getModeDisplayName(mode: ImageGenMode): string {
  switch (mode) {
    case 'generate':
      return 'Wygeneruj nowe';
    case 'edit':
      return 'Edytuj istniejące';
  }
}
