import { NextResponse } from 'next/server';
import { uploadImage, type CloudProvider } from '@/lib/cloud-storage';

const MAX_FILES = 16;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const files = formData.getAll('files') as File[];
    const provider = (formData.get('provider') as string) || 'auto';

    if (!files.length) {
      return NextResponse.json({ error: 'Brak plików do przesłania' }, { status: 400 });
    }

    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `Maksymalnie ${MAX_FILES} plików na raz` },
        { status: 400 },
      );
    }

    const uploads: Array<{
      url: string;
      provider: CloudProvider;
      key: string;
      bytes: number;
      originalName: string;
    }> = [];
    const errors: string[] = [];

    for (const file of files) {
      // Validate MIME type
      if (!file.type.startsWith('image/')) {
        errors.push(`${file.name}: nieprawidłowy typ pliku (${file.type})`);
        continue;
      }

      // Validate size
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name}: plik za duży (${(file.size / 1024 / 1024).toFixed(1)} MB, max 10 MB)`);
        continue;
      }

      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const result = await uploadImage(
          buffer,
          file.name,
          file.type,
          provider as CloudProvider | 'auto',
        );
        uploads.push({ ...result, originalName: file.name });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Nieznany błąd';
        errors.push(`${file.name}: ${msg}`);
      }
    }

    if (uploads.length === 0 && errors.length > 0) {
      return NextResponse.json({ error: 'Wszystkie pliki nie powiodły się', errors }, { status: 500 });
    }

    return NextResponse.json({ uploads, errors });
  } catch (err) {
    console.error('[images/upload] Error:', err);
    return NextResponse.json(
      { error: 'Błąd przesyłania plików' },
      { status: 500 },
    );
  }
}
