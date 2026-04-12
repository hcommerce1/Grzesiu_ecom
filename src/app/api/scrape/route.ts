import { NextRequest, NextResponse } from 'next/server';
import { scrapeProduct } from '@/lib/scraper';
import { translateProductBasic, translateProduct } from '@/lib/translator';

export const maxDuration = 180; // Allow up to 180s for scraping + translation
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { url, systemPrompt } = body;

        if (!url || typeof url !== 'string') {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Please provide a valid URL.',
                    errorType: 'INVALID_URL',
                },
                { status: 400 }
            );
        }

        const result = await scrapeProduct(url);

        if (result.success) {
            // Translate product data to Polish
            try {
                // Nowy flow: tłumaczenie bez generowania opisu (opis generowany osobno, później)
                // Jeśli podano systemPrompt, użyj starego flow (fallback)
                const translatedData = systemPrompt
                    ? await translateProduct(result.data, systemPrompt)
                    : await translateProductBasic(result.data);
                return NextResponse.json({
                    success: true,
                    data: translatedData,
                    originalData: result.data
                }, { status: 200 });
            } catch (translateErr: any) {
                console.warn('Translation failed:', translateErr);
                return NextResponse.json({
                    success: false,
                    error: translateErr.message || 'The translation LLM failed. Please check your API key in .env.local.',
                    errorType: 'TRANSLATION_ERROR'
                }, { status: 500 });
            }
        }

        const statusCode =
            result.errorType === 'ACCESS_DENIED' ? 403 :
                result.errorType === 'INVALID_URL' ? 400 :
                    result.errorType === 'TIMEOUT' ? 504 : 500;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { _internalError, ...publicResult } = result as any;
        return NextResponse.json(publicResult, { status: statusCode });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Internal server error';
        return NextResponse.json(
            {
                success: false,
                error: message,
                errorType: 'UNKNOWN',
            },
            { status: 500 }
        );
    }
}
