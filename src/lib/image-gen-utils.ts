import type { ImageGenIntent, ImageGenPreference, ImageGenProvider } from './types';

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
  if (wordCount < 3) {
    return { valid: false, reason: 'Opisz bardziej szczegółowo (minimum 3 słowa).' };
  }

  return { valid: true };
}

/**
 * Mapowanie intencji na provider z uwzględnieniem preferencji użytkownika.
 */
export function getProviderForIntent(
  intent: ImageGenIntent,
  preference: ImageGenPreference,
): ImageGenProvider {
  switch (intent) {
    case 'background_removal':
      return 'removebg';
    case 'simple_edit':
      return 'replicate';
    case 'generation':
      return preference;
    case 'context_edit':
      return 'fluxcontextpro';
  }
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
  }
}

/**
 * Polska nazwa intencji.
 */
export function getIntentDisplayName(intent: ImageGenIntent): string {
  switch (intent) {
    case 'background_removal':
      return 'Usuwanie tła';
    case 'simple_edit':
      return 'Prosta edycja';
    case 'generation':
      return 'Generacja zdjęcia';
    case 'context_edit':
      return 'Edycja kontekstowa';
  }
}
