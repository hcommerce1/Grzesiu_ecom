import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import type { ImageGenPreference, PromptClassification } from '@/lib/types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an image-generation prompt classifier for an e-commerce product photo tool.

Given a user prompt (may be in Polish or English) and whether they have a source image, return JSON:

{
  "isValid": boolean,
  "rejectionReason": "string in Polish or null",
  "intent": "background_removal" | "simple_edit" | "generation" | "context_edit",
  "translatedPrompt": "English translation optimized for image generation AI",
  "confidence": 0.0-1.0,
  "suggestion": "Polish suggestion to improve the prompt, or null"
}

Rules:
- REJECT (isValid=false) if: fewer than 3 meaningful words, gibberish, single characters, nonsensical input. Give rejectionReason in Polish.
- intent mapping:
  - "background_removal": user wants background removed, changed to white/transparent, or replaced
  - "simple_edit": color change, brightness, contrast, minor retouching, resize
  - "generation": create new product photo from scratch, text-to-image
  - "context_edit": complex editing needing image context (add props, change scene, composite, product placement)
- If no source image is provided and intent would be an edit, switch to "generation"
- translatedPrompt: translate to English and optimize for image generation (add detail, photographic style hints for product photos)
- suggestion: if prompt is acceptable but vague or could be better, suggest improvements in Polish. null if prompt is already good.
- confidence: how sure you are about the intent classification
- Answer with ONLY valid JSON, no markdown fences.`;

interface RequestBody {
  prompt: string;
  hasSourceImage: boolean;
  preference: ImageGenPreference;
}

export async function POST(req: Request) {
  try {
    const { prompt, hasSourceImage, preference } = (await req.json()) as RequestBody;

    if (!prompt?.trim()) {
      return NextResponse.json({
        isValid: false,
        rejectionReason: 'Prompt jest pusty.',
        intent: 'generation',
        recommendedProvider: preference,
        translatedPrompt: '',
        originalPrompt: '',
        confidence: 0,
      } satisfies PromptClassification);
    }

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Prompt: "${prompt}"\nHas source image: ${hasSourceImage}\nPreferred generation model: ${preference}`,
        },
      ],
    });

    const content = (response.content[0] as { type: 'text'; text: string }).text || '{}';
    const parsed = JSON.parse(content);

    // Mapuj intencję na provider
    const providerMap: Record<string, string> = {
      background_removal: 'removebg',
      simple_edit: 'replicate',
      generation: preference,
      context_edit: 'fluxcontextpro',
    };

    const result: PromptClassification = {
      isValid: parsed.isValid ?? true,
      rejectionReason: parsed.rejectionReason || undefined,
      intent: parsed.intent || 'generation',
      recommendedProvider: (providerMap[parsed.intent] || preference) as PromptClassification['recommendedProvider'],
      translatedPrompt: parsed.translatedPrompt || prompt,
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
