import { NextRequest, NextResponse } from 'next/server';
import archiver from 'archiver';
import { Readable } from 'stream';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { images, filename } = body as { images: string[]; filename: string };

        if (!images || !Array.isArray(images) || images.length === 0) {
            return NextResponse.json(
                { error: 'No images provided' },
                { status: 400 }
            );
        }

        const safeName = (filename || 'product_images')
            .replace(/[^a-zA-Z0-9_-]/g, '_')
            .substring(0, 60);

        // Create a ZIP archive in memory
        const archive = archiver('zip', { zlib: { level: 5 } });
        const chunks: Buffer[] = [];

        archive.on('data', (chunk: Buffer) => chunks.push(chunk));

        const archiveFinished = new Promise<void>((resolve, reject) => {
            archive.on('end', resolve);
            archive.on('error', reject);
        });

        // Download and append each image
        let imageCount = 0;
        for (const url of images) {
            try {
                const response = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                        'Accept': 'image/*',
                    },
                });

                if (!response.ok) continue;

                const buffer = Buffer.from(await response.arrayBuffer());
                const ext = getImageExtension(url, response.headers.get('content-type') || '');
                imageCount++;
                archive.append(buffer, { name: `${safeName}_${String(imageCount).padStart(2, '0')}.${ext}` });
            } catch {
                console.warn(`Failed to download image: ${url}`);
            }
        }

        archive.finalize();
        await archiveFinished;

        if (imageCount === 0) {
            return NextResponse.json(
                { error: 'No images could be downloaded' },
                { status: 500 }
            );
        }

        const zipBuffer = Buffer.concat(chunks);

        return new NextResponse(zipBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': `attachment; filename="${safeName}.zip"`,
                'Content-Length': String(zipBuffer.length),
            },
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to create ZIP';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

function getImageExtension(url: string, contentType: string): string {
    // Try from content-type
    if (contentType.includes('png')) return 'png';
    if (contentType.includes('webp')) return 'webp';
    if (contentType.includes('gif')) return 'gif';
    if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';

    // Try from URL
    const urlPath = new URL(url).pathname.toLowerCase();
    if (urlPath.endsWith('.png')) return 'png';
    if (urlPath.endsWith('.webp')) return 'webp';
    if (urlPath.endsWith('.gif')) return 'gif';

    return 'jpg';
}
