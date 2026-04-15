/**
 * Idempotently ensures the OCR uploads bucket exists with the correct
 * MIME/size limits. Runs once at server startup so ops don't have to
 * remember to apply migration 012 + bucket config separately.
 */

import type { FastifyBaseLogger } from 'fastify';
import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

// Keep in sync with apps/api/src/routes/ocr/index.ts.
const ALLOWED_MIME = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/tiff',
  'image/bmp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel',                                           // .xls
  'application/vnd.oasis.opendocument.spreadsheet',                     // .ods
  'text/csv',
  'text/tab-separated-values',
  'application/csv',
  'text/plain',
];

export async function ensureOcrBucket(log: FastifyBaseLogger): Promise<void> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: existing, error: getErr } = await supabase.storage.getBucket(
    env.STORAGE_BUCKET_OCR,
  );

  if (existing) {
    // Sync MIME allow-list in case we've added new supported types since
    // the bucket was first created (idempotent — only triggers PATCH if
    // the set differs).
    const current = new Set(existing.allowed_mime_types ?? []);
    const desired = new Set(ALLOWED_MIME);
    const equal = current.size === desired.size && [...current].every((m) => desired.has(m));

    if (!equal) {
      const { error: updErr } = await supabase.storage.updateBucket(
        env.STORAGE_BUCKET_OCR,
        {
          public: false,
          fileSizeLimit: env.OCR_MAX_FILE_SIZE_BYTES,
          allowedMimeTypes: ALLOWED_MIME,
        },
      );
      if (updErr) {
        log.warn({ err: updErr.message }, 'ocr_bucket.update_failed');
      } else {
        log.info(
          { bucket: env.STORAGE_BUCKET_OCR, mimeCount: ALLOWED_MIME.length },
          'ocr_bucket.updated',
        );
      }
    } else {
      log.info({ bucket: env.STORAGE_BUCKET_OCR }, 'ocr_bucket.exists');
    }
    return;
  }

  // "not found" is the happy path for creation; any other error is fatal.
  if (getErr && !/not.?found/i.test(getErr.message)) {
    log.error({ err: getErr.message }, 'ocr_bucket.get_failed');
    throw new Error(`Failed to check OCR bucket: ${getErr.message}`);
  }

  const { error: createErr } = await supabase.storage.createBucket(
    env.STORAGE_BUCKET_OCR,
    {
      public: false,
      fileSizeLimit: env.OCR_MAX_FILE_SIZE_BYTES,
      allowedMimeTypes: ALLOWED_MIME,
    },
  );

  if (createErr) {
    // Tolerate a concurrent-create race (another instance created it first).
    if (/already.?exists/i.test(createErr.message)) {
      log.info({ bucket: env.STORAGE_BUCKET_OCR }, 'ocr_bucket.exists_raced');
      return;
    }
    log.error({ err: createErr.message }, 'ocr_bucket.create_failed');
    throw new Error(`Failed to create OCR bucket: ${createErr.message}`);
  }

  log.info({ bucket: env.STORAGE_BUCKET_OCR }, 'ocr_bucket.created');
}
