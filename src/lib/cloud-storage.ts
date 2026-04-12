import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v2 as cloudinary } from 'cloudinary';
import path from 'path';

// ─── Types ───

export type CloudProvider = 'r2' | 'cloudinary';

export interface UploadResult {
  url: string;
  provider: CloudProvider;
  key: string;
  bytes: number;
}

// ─── Lazy-initialized clients ───

let _s3: S3Client | null = null;
let _cloudinaryConfigured = false;

function getS3(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return _s3;
}

function ensureCloudinary() {
  if (!_cloudinaryConfigured) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    _cloudinaryConfigured = true;
  }
}

// ─── Helpers ───

export function isConfigured(provider: CloudProvider): boolean {
  if (provider === 'r2') {
    return !!(
      process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME &&
      process.env.R2_PUBLIC_URL
    );
  }
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

function generateKey(originalName: string): string {
  const ext = path.extname(originalName) || '.jpg';
  const base = path
    .basename(originalName, ext)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 60);
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  return `products/${ts}_${rand}_${base}${ext}`;
}

// ─── Provider uploads ───

async function uploadToR2(
  buffer: Buffer,
  key: string,
  contentType: string,
): Promise<UploadResult> {
  const s3 = getS3();
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );

  const publicUrl = process.env.R2_PUBLIC_URL!.replace(/\/+$/, '');
  return {
    url: `${publicUrl}/${key}`,
    provider: 'r2',
    key,
    bytes: buffer.length,
  };
}

async function uploadToCloudinary(
  buffer: Buffer,
  originalName: string,
): Promise<UploadResult> {
  ensureCloudinary();

  const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'products', use_filename: true, unique_filename: true },
      (error, result) => {
        if (error) reject(error);
        else resolve(result as Record<string, unknown>);
      },
    );
    stream.end(buffer);
  });

  return {
    url: result.secure_url as string,
    provider: 'cloudinary',
    key: result.public_id as string,
    bytes: result.bytes as number,
  };
}

// ─── Main upload function ───

export async function uploadImage(
  buffer: Buffer,
  originalName: string,
  contentType: string,
  provider?: CloudProvider | 'auto',
): Promise<UploadResult> {
  const resolvedProvider = provider && provider !== 'auto' ? provider : undefined;

  // Explicit provider
  if (resolvedProvider === 'r2') {
    const key = generateKey(originalName);
    return uploadToR2(buffer, key, contentType);
  }
  if (resolvedProvider === 'cloudinary') {
    return uploadToCloudinary(buffer, originalName);
  }

  // Auto: R2 first, then Cloudinary fallback
  if (isConfigured('r2')) {
    try {
      const key = generateKey(originalName);
      return await uploadToR2(buffer, key, contentType);
    } catch (err) {
      console.warn('[cloud-storage] R2 upload failed, trying Cloudinary:', err);
    }
  }

  if (isConfigured('cloudinary')) {
    return uploadToCloudinary(buffer, originalName);
  }

  throw new Error(
    'Żaden provider chmurowy nie jest skonfigurowany. Ustaw zmienne R2_* lub CLOUDINARY_* w .env.local',
  );
}
