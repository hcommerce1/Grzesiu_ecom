import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import type { ImageGenMode, ImageGenProvider, PromptClassification } from '@/lib/types';
import { parseClaudeJson } from '@/lib/parse-claude-json';
import { logTokenUsage } from '@/lib/token-logger';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You are a prompt rewriter for an e-commerce product photo tool. Users write short, often vague prompts in Polish. Your job is to turn them into hyper-detailed English prompts ready for an image generation model (Google Nano Banana Pro / Black Forest Labs Flux).

The user has already chosen a mode (generate vs edit). Classify the sub-intent CONSISTENT with that mode and produce a rich English prompt.

Return JSON:
{
  "isValid": boolean,
  "rejectionReason": "string in Polish or null",
  "intent": "background_removal" | "simple_edit" | "generation" | "context_edit",
  "recommendedProvider": "removebg" | "replicate" | "nanobananapro" | "fluxcontextpro",
  "enrichedPrompt": "hyper-detailed English prompt ready to send to the image model",
  "confidence": 0.0-1.0,
  "suggestion": "short Polish note describing what you added/changed in enrichedPrompt, or null"
}

CORE RULES — read carefully:
- REJECT (isValid=false) if: fewer than 3 meaningful words, gibberish, single characters, nonsensical input. Give rejectionReason in Polish.
- The user's chosen mode is a HARD signal — do not override it.
  - mode="generate" → intent MUST be "generation"
  - mode="edit" → intent MUST be one of: "background_removal", "simple_edit", "context_edit"
- intent semantics (only relevant when mode="edit"):
  - "background_removal": user wants background removed, made white/transparent, or replaced
  - "simple_edit": color change, brightness/contrast, minor retouching, resize
  - "context_edit": complex editing — add props, change scene, composite, lighting effects, product placement
- recommendedProvider:
  - intent="background_removal" → "removebg"
  - intent="simple_edit" → "replicate"
  - intent="context_edit" or "generation" → "nanobananapro" (default), or "fluxcontextpro" if the prompt requires very high fidelity, character consistency, or large 4K output

ENRICHED PROMPT — the most important part:
- Always write enrichedPrompt in English.
- If a source image is provided (hasSourceImage=true), the prompt MUST treat it as the canonical reference. Use phrases like "the product visible in the reference image", "preserve the product's exact shape, color, material, and proportions". Then describe what to ADD or CHANGE. NEVER invent the product's appearance — the model sees the reference image too.
- If sourceAiDescription is provided, use it to enrich the prompt with concrete product details (color, material, model name, dimensions read from labels). Insert these details naturally so the model has stronger grounding.
- If productTitle / productAttributes are provided, use them as additional context (e.g. "an UV-resistant outdoor cable" gives the model a hint about realism).
- Add concrete photographic details when the user's prompt is vague: light direction (e.g. "warm sunlight from the upper-left corner"), surface materials, finishes, mood, camera angle, depth of field, background style. For product photos default to clean studio context unless the user requests otherwise.
- Keep enrichedPrompt focused: 2-4 sentences, dense with specifics. Do NOT add lists of styles or generic marketing fluff.

SUGGESTION — Polish, one sentence describing what enrichedPrompt added vs. the user's original input. Examples: "Dodałem kierunek światła z lewego górnego rogu i podkreślenie odporności kabla na UV." or "Skopiowałem opis produktu z analizy zdjęcia, żeby model nie wymyślił wyglądu." Set to null only when there is genuinely nothing meaningful to add — almost never.

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
  if (intent === 'background_removal') return 'removebg';
  if (intent === 'simple_edit') return 'replicate';
  return mode === 'generate' ? 'nanobananapro' : 'nanobananapro';
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
      enrichedPrompt?: string;
      confidence?: number;
      suggestion?: string;
    }>(content);

    // Wymuś spójność intent z mode (Claude ma to w prompcie, ale na wszelki wypadek)
    let intent = (parsed.intent || (mode === 'edit' ? 'context_edit' : 'generation')) as PromptClassification['intent'];
    if (mode === 'generate' && intent !== 'generation') intent = 'generation';
    if (mode === 'edit' && intent === 'generation') intent = 'context_edit';

    const recommendedProvider = (parsed.recommendedProvider as ImageGenProvider | undefined)
      ?? fallbackProvider(mode, intent);

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
