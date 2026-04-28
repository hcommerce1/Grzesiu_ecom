import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import type { ImageGenMode, ImageGenProvider, PhotoRoomOperation, PromptClassification } from '@/lib/types';
import { parseClaudeJson } from '@/lib/parse-claude-json';
import { logTokenUsage } from '@/lib/token-logger';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You are a routing brain for an e-commerce product photo tool. Users write short, often vague prompts in Polish. Your job is to:
1. Pick the best provider + operation for the task
2. Rewrite the prompt into a hyper-detailed English prompt for the chosen model

AVAILABLE PROVIDERS AND THEIR CAPABILITIES:

removebg — Background removal only. Cheap. No AI generation. Use when: user just wants a clean cutout, no other edits.

replicate — SDXL image-to-image. Good for: simple color/style changes, minor retouching. Needs a source image.

nanobananapro — FAL.ai general AI generation & editing (text-to-image and image-to-image). Good for: generating new product scenes, context edits, complex edits. Default for generation tasks.

fluxcontextpro — FAL.ai high-fidelity generation. Better than nanobananapro for: 4K output, character/product consistency across shots, complex scenic backgrounds. Slower and more expensive.

photoroom — Professional product photo editing suite. Supports multiple operations:
  * remove_background: clean AI background removal (better edge quality than removebg for complex objects)
  * replace_background: removes background AND generates new AI background from backgroundPrompt
  * relight: changes product lighting, adds colored light, mood lighting, studio lighting corrections
  * add_shadow: adds realistic soft AI shadow under the product
  * remove_text: AI inpainting to remove printed text, watermarks, labels from image
  * upscale: AI resolution upscaling (2x)
  * expand: AI image expansion / uncropping (adds context around product)
  * flat_lay: stylizes as flat lay product photography (top-down, arranged)
  * ghost_mannequin: invisible mannequin effect for clothing photography
  * custom: use when no specific operation fits but PhotoRoom is still the right tool

PROVIDER SELECTION — choose based on user intent:
- "usuń tło", "wytnij tło", "białe tło" → photoroom/remove_background OR removebg (use photoroom for complex products, removebg for simple clean cuts)
- "zmień tło na X", "inne tło", "tło z X" → photoroom/replace_background (set backgroundPrompt to English description of desired background)
- "doświetl", "zmień oświetlenie", "ciepłe/zimne światło", "studio light" → photoroom/relight
- "dodaj cień", "naturalny cień" → photoroom/add_shadow
- "usuń tekst", "usuń watermark", "zamaluj napis" → photoroom/remove_text
- "upscale", "powiększ rozdzielczość", "sharp up", "wyższa jakość px" → photoroom/upscale
- "rozszerz", "uncrop", "więcej miejsca", "poszerz kadr" → photoroom/expand
- "flat lay", "z góry", "układany" → photoroom/flat_lay
- "manekin", "invisible mannequin", "ghost mannequin" → photoroom/ghost_mannequin
- "wygeneruj", "stwórz nowe zdjęcie", "od zera" → nanobananapro (default) or fluxcontextpro (high fidelity)
- "zmień styl", "pokoloruj", "prosta zmiana" → replicate
- complex scene with product + specific context → fluxcontextpro

MODE RULES:
- mode="generate" → intent MUST be "generation", provider must be nanobananapro or fluxcontextpro
- mode="edit" → intent can be any non-generation intent; pick the best match

Return JSON:
{
  "isValid": boolean,
  "rejectionReason": "string in Polish or null",
  "intent": "background_removal" | "replace_background" | "simple_edit" | "generation" | "context_edit" | "relight" | "add_shadow" | "remove_text" | "upscale" | "expand",
  "recommendedProvider": "removebg" | "replicate" | "nanobananapro" | "fluxcontextpro" | "photoroom",
  "photoRoomOperation": "remove_background" | "replace_background" | "relight" | "add_shadow" | "remove_text" | "upscale" | "expand" | "flat_lay" | "ghost_mannequin" | "custom" | null,
  "backgroundPrompt": "English description of the desired background for replace_background, or null",
  "enrichedPrompt": "hyper-detailed English prompt ready to send to the image model",
  "confidence": 0.0-1.0,
  "suggestion": "short Polish note describing what you added/changed, or null"
}

RULES:
- ALMOST NEVER REJECT. isValid=false only for: completely random keyboard mashing (e.g. "asdfjkl"), or single isolated characters. Everything else is valid — lifestyle scenes, people, characters, game references, animals, fantasy, anything the user wants in or around their product photo. "dodaj chłopca grającego w Fortnite", "postaw produkt na Marsie", "dodaj kota" — ALL VALID. Route them to nanobananapro or fluxcontextpro. When in doubt: accept.
- photoRoomOperation: set ONLY when recommendedProvider="photoroom", otherwise null.
- backgroundPrompt: set ONLY when photoRoomOperation="replace_background". Write in English, describe the background scene (not the product).

ENRICHED PROMPT:
- Always write in English.
- If hasSourceImage=true: ALWAYS open with "Using the provided reference image as the product — " and then describe ONLY what to add/change. Never invent product appearance. If sourceAiDescription is available, use it for concrete details (color, shape, material). If not, still reference "the product as shown in the reference image". The image model receives the source image separately — your prompt just needs to say what to change, not re-describe the product.
- If hasSourceImage=false: describe the full scene and product from scratch using productTitle/productAttributes.
- Add photographic specifics when vague: light direction, surface, mood, camera angle, depth of field.
- 2-4 sentences, dense with specifics. No marketing fluff.

SUGGESTION — one Polish sentence describing what enrichedPrompt added vs original. Almost always set this.

Answer with ONLY valid JSON, no markdown fences.`;

interface RequestBody {
  prompt: string;
  hasSourceImage: boolean;
  mode: ImageGenMode;
  sourceAiDescription?: string;
  productTitle?: string;
  productAttributes?: Record<string, string>;
  productId?: string;
}

function fallbackProvider(mode: ImageGenMode, intent: PromptClassification['intent']): ImageGenProvider {
  if (mode === 'generate') return 'nanobananapro';
  if (intent === 'background_removal') return 'removebg';
  if (intent === 'simple_edit') return 'replicate';
  if (intent === 'replace_background' || intent === 'relight' || intent === 'add_shadow' ||
      intent === 'remove_text' || intent === 'upscale' || intent === 'expand') return 'photoroom';
  return 'nanobananapro';
}

export async function POST(req: Request) {
  try {
    const {
      prompt,
      hasSourceImage,
      mode,
      sourceAiDescription,
      productTitle,
      productAttributes,
      productId,
    } = (await req.json()) as RequestBody;

    if (!prompt?.trim()) {
      return NextResponse.json({
        isValid: false,
        rejectionReason: 'Prompt jest pusty.',
        intent: 'generation',
        mode: mode ?? 'generate',
        recommendedProvider: 'nanobananapro',
        enrichedPrompt: '',
        originalPrompt: '',
        confidence: 0,
      } satisfies PromptClassification);
    }

    const userMessageParts = [
      `User prompt: "${prompt}"`,
      `Mode (hard signal): ${mode}`,
      `Has source image: ${hasSourceImage}`,
    ];
    if (sourceAiDescription) {
      userMessageParts.push(`Source image AI description: ${sourceAiDescription}`);
    }
    if (productTitle) {
      userMessageParts.push(`Product title: ${productTitle}`);
    }
    if (productAttributes && Object.keys(productAttributes).length > 0) {
      const attrs = Object.entries(productAttributes)
        .slice(0, 12)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join('\n');
      userMessageParts.push(`Product attributes:\n${attrs}`);
    }

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessageParts.join('\n') }],
    });

    logTokenUsage({
      productId: productId ?? '__global__',
      toolName: 'classify_prompt',
      model: MODEL,
      usage: response.usage,
    });

    const content = (response.content[0] as { type: 'text'; text: string }).text || '{}';
    const parsed = parseClaudeJson<{
      isValid?: boolean;
      rejectionReason?: string;
      intent?: string;
      recommendedProvider?: string;
      photoRoomOperation?: string;
      backgroundPrompt?: string;
      enrichedPrompt?: string;
      confidence?: number;
      suggestion?: string;
    }>(content);

    // Wymuś spójność intent z mode
    let intent = (parsed.intent || (mode === 'edit' ? 'context_edit' : 'generation')) as PromptClassification['intent'];
    if (mode === 'generate' && intent !== 'generation') intent = 'generation';
    if (mode === 'edit' && intent === 'generation') intent = 'context_edit';

    const recommendedProvider = (parsed.recommendedProvider as ImageGenProvider | undefined)
      ?? fallbackProvider(mode, intent);

    // photoRoomOperation i backgroundPrompt tylko gdy provider=photoroom
    const photoRoomOperation = recommendedProvider === 'photoroom'
      ? (parsed.photoRoomOperation as PhotoRoomOperation | undefined) ?? 'custom'
      : undefined;
    const backgroundPrompt = photoRoomOperation === 'replace_background'
      ? (parsed.backgroundPrompt || undefined)
      : undefined;

    const result: PromptClassification = {
      isValid: parsed.isValid ?? true,
      rejectionReason: parsed.rejectionReason || undefined,
      intent,
      mode,
      recommendedProvider,
      enrichedPrompt: parsed.enrichedPrompt || prompt,
      originalPrompt: prompt,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      suggestion: parsed.suggestion || undefined,
      photoRoomOperation,
      backgroundPrompt,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error('Classify prompt failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Błąd klasyfikacji promptu' },
      { status: 500 },
    );
  }
}
