import { NextResponse } from 'next/server';
import type { ImageGenMode, ImageGenProvider, ImageGenResult } from '@/lib/types';
import { uploadImage } from '@/lib/cloud-storage';

// Env vars
const FAL_KEY = process.env.FAL_KEY || '';
const REMOVEBG_API_KEY = process.env.REMOVEBG_API_KEY || '';
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || '';

// Konfigurowalne slugi modeli
const FAL_MODEL_NANOBANANAPRO = process.env.FAL_MODEL_NANOBANANAPRO || 'fal-ai/nano-banana-pro';
const FAL_MODEL_FLUXCONTEXTPRO = process.env.FAL_MODEL_FLUXCONTEXTPRO || 'fal-ai/flux-pro/v1.1-ultra';
const REPLICATE_MODEL_VERSION =
  process.env.REPLICATE_MODEL_VERSION ||
  'stability-ai/sdxl:7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc';

// Replicate polling — max 120s
export const maxDuration = 120;

interface RequestBody {
  prompt: string;
  sourceImageUrl?: string;
  provider: ImageGenProvider;
  mode: ImageGenMode;
}

// ─── remove.bg ───
async function generateRemoveBg(sourceImageUrl: string): Promise<ImageGenResult> {
  if (!REMOVEBG_API_KEY) {
    return { success: false, provider: 'removebg', error: 'REMOVEBG_API_KEY nie jest ustawiony' };
  }
  if (!sourceImageUrl) {
    return { success: false, provider: 'removebg', error: 'Remove.bg wymaga zdjęcia źródłowego' };
  }

  const response = await fetch('https://api.remove.bg/v1.0/removebg', {
    method: 'POST',
    headers: {
      'X-Api-Key': REMOVEBG_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      image_url: sourceImageUrl,
      size: 'auto',
      type: 'product',
      format: 'png',
      bg_color: 'FFFFFF',
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    return { success: false, provider: 'removebg', error: `Remove.bg error (${response.status}): ${err}` };
  }

  const data = await response.json();
  const resultUrl = data.data?.result_b64
    ? `data:image/png;base64,${data.data.result_b64}`
    : data.data?.url;

  if (!resultUrl) {
    return { success: false, provider: 'removebg', error: 'Brak wyniku z Remove.bg' };
  }

  return { success: true, provider: 'removebg', imageUrl: resultUrl, costEstimate: '~$0.20', costUsd: 0.20 };
}

// ─── Replicate (SDXL) ───
async function generateReplicate(prompt: string, sourceImageUrl?: string): Promise<ImageGenResult> {
  if (!REPLICATE_API_TOKEN) {
    return { success: false, provider: 'replicate', error: 'REPLICATE_API_TOKEN nie jest ustawiony' };
  }

  // Parsuj model:version
  const [model, version] = REPLICATE_MODEL_VERSION.includes(':')
    ? REPLICATE_MODEL_VERSION.split(':')
    : [REPLICATE_MODEL_VERSION, undefined];

  const input: Record<string, unknown> = {
    prompt,
    width: 1024,
    height: 768,
    num_outputs: 1,
  };

  if (sourceImageUrl) {
    input.image = sourceImageUrl;
    input.prompt_strength = 0.75;
  }

  // Utwórz prediction
  const createRes = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...(version ? { version } : { model }),
      input,
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    return { success: false, provider: 'replicate', error: `Replicate error (${createRes.status}): ${err}` };
  }

  const prediction = await createRes.json();
  const predictionUrl = prediction.urls?.get || `https://api.replicate.com/v1/predictions/${prediction.id}`;

  // Polling — co 2s, max 120s
  const startTime = Date.now();
  const POLL_INTERVAL = 2000;
  const MAX_WAIT = 115000; // zostawiamy margines

  while (Date.now() - startTime < MAX_WAIT) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));

    const pollRes = await fetch(predictionUrl, {
      headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
    });

    if (!pollRes.ok) continue;

    const status = await pollRes.json();

    if (status.status === 'succeeded') {
      const outputUrl = Array.isArray(status.output) ? status.output[0] : status.output;
      if (!outputUrl) {
        return { success: false, provider: 'replicate', error: 'Replicate zwrócił pusty wynik' };
      }
      return { success: true, provider: 'replicate', imageUrl: outputUrl, costEstimate: '~$0.01', costUsd: 0.01 };
    }

    if (status.status === 'failed' || status.status === 'canceled') {
      return {
        success: false,
        provider: 'replicate',
        error: `Replicate ${status.status}: ${status.error || 'nieznany błąd'}`,
      };
    }
  }

  return { success: false, provider: 'replicate', error: 'Replicate timeout — generacja trwała za długo' };
}

// ─── fal.ai (NanoBananaPro / FluxContextPro) ───
async function generateFal(
  prompt: string,
  modelSlug: string,
  mode: ImageGenMode,
  sourceImageUrl?: string,
): Promise<ImageGenResult> {
  if (!FAL_KEY) {
    return { success: false, provider: 'nanobananapro', error: 'FAL_KEY nie jest ustawiony' };
  }

  const providerName: ImageGenProvider = modelSlug.includes('flux') ? 'fluxcontextpro' : 'nanobananapro';

  if (mode === 'edit' && !sourceImageUrl) {
    return { success: false, provider: providerName, error: 'Tryb edycji wymaga zdjęcia źródłowego' };
  }

  const body: Record<string, unknown> = {
    prompt,
    image_size: 'landscape_4_3',
    num_images: 1,
  };

  // Gdy mamy source image, ZAWSZE używamy edit-endpointa (image-to-image) —
  // niezależnie od trybu generate/edit. Tryb tylko zmienia jak Claude pisze prompt
  // (reuse vs preserve), ale technicznie obie ścieżki to image-to-image w FAL.
  // Tylko bez source w trybie generate idziemy text-to-image.
  let effectiveSlug = modelSlug;
  if (sourceImageUrl) {
    if (modelSlug === 'fal-ai/nano-banana-pro') {
      effectiveSlug = 'fal-ai/nano-banana-pro/edit';
      body.image_urls = [sourceImageUrl];
    } else {
      body.image_url = sourceImageUrl;
      body.strength = 0.75;
    }
  }

  const response = await fetch(`https://fal.run/${effectiveSlug}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    return { success: false, provider: providerName, error: `fal.ai error (${response.status}): ${err}` };
  }

  const data = await response.json();
  const imageUrl = data.images?.[0]?.url || data.output?.url;

  if (!imageUrl) {
    return { success: false, provider: providerName, error: 'fal.ai zwrócił pusty wynik' };
  }

  const costUsd = providerName === 'fluxcontextpro' ? 0.05 : 0.03;
  const cost = `~$${costUsd.toFixed(2)}`;
  return { success: true, provider: providerName, imageUrl, costEstimate: cost, costUsd };
}

// Pobiera wygenerowane zdjęcie (URL lub data:base64) i upload-uje na nasz storage.
// Reuse: uploadImage z cloud-storage.ts ma już logikę 'auto' (R2 → Cloudinary fallback).
async function persistGeneratedImage(rawUrl: string, provider: ImageGenProvider): Promise<string> {
  let buffer: Buffer;
  let contentType = 'image/png';

  if (rawUrl.startsWith('data:')) {
    // data:image/png;base64,XXXX
    const match = rawUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error('Niepoprawny format data URI');
    contentType = match[1];
    buffer = Buffer.from(match[2], 'base64');
  } else {
    const res = await fetch(rawUrl);
    if (!res.ok) throw new Error(`Pobranie wyniku ${provider} nie powiodło się: ${res.status}`);
    contentType = res.headers.get('content-type') || 'image/png';
    buffer = Buffer.from(await res.arrayBuffer());
  }

  const ext = contentType.includes('png') ? 'png' : contentType.includes('jpeg') ? 'jpg' : contentType.includes('webp') ? 'webp' : 'png';
  const upload = await uploadImage(buffer, `ai-${provider}-${Date.now()}.${ext}`, contentType, 'auto');
  return upload.url;
}

// ─── Main handler ───
export async function POST(req: Request) {
  try {
    const { prompt, sourceImageUrl, provider, mode } = (await req.json()) as RequestBody;

    if (!prompt?.trim() && provider !== 'removebg') {
      return NextResponse.json(
        { success: false, provider, error: 'Brak promptu' } satisfies ImageGenResult,
        { status: 400 },
      );
    }

    if (!mode) {
      return NextResponse.json(
        { success: false, provider, error: 'Brak trybu (generate/edit)' } satisfies ImageGenResult,
        { status: 400 },
      );
    }

    const effectiveMode: ImageGenMode = provider === 'removebg' ? 'edit' : mode;
    let result: ImageGenResult;

    switch (provider) {
      case 'removebg':
        result = await generateRemoveBg(sourceImageUrl || '');
        break;

      case 'replicate':
        result = await generateReplicate(prompt, sourceImageUrl);
        break;

      case 'nanobananapro':
        result = await generateFal(prompt, FAL_MODEL_NANOBANANAPRO, effectiveMode, sourceImageUrl);
        break;

      case 'fluxcontextpro':
        result = await generateFal(prompt, FAL_MODEL_FLUXCONTEXTPRO, effectiveMode, sourceImageUrl);
        break;

      default:
        result = { success: false, provider: provider || 'nanobananapro', error: `Nieznany provider: ${provider}` };
    }

    // Persist wynik na nasz storage (R2 → Cloudinary fallback) — FAL.media wygasa po godzinach,
    // base64 jest długi i niewygodny do wysyłki BL. Po uploadzie zwracamy trwały URL.
    if (result.success && result.imageUrl) {
      try {
        const persistent = await persistGeneratedImage(result.imageUrl, provider);
        result = { ...result, imageUrl: persistent };
      } catch (err) {
        console.error('[generate] Persist upload failed, returning original URL:', err);
        // Nie blokujemy — user dostaje surowy URL z FAL/etc, lepsze to niż nic
      }
    }

    return NextResponse.json(result, { status: result.success ? 200 : 500 });
  } catch (err) {
    console.error('Image generation failed:', err);
    return NextResponse.json(
      {
        success: false,
        provider: 'nanobananapro' as ImageGenProvider,
        error: err instanceof Error ? err.message : 'Błąd generacji obrazu',
      } satisfies ImageGenResult,
      { status: 500 },
    );
  }
}
