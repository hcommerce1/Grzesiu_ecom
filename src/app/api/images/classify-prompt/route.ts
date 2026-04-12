import { NextResponse } from 'next/server';
import type { ImageGenPreference, PromptClassification } from '@/lib/types';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

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
- confidence: how sure you are about the intent classification`;

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

    if (!OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OPENAI_API_KEY nie jest ustawiony' }, { status: 500 });
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Prompt: "${prompt}"\nHas source image: ${hasSourceImage}\nPreferred generation model: ${preference}`,
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 300,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{}';
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
