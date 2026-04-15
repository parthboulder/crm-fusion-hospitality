/**
 * OCR routes — direct file upload + job polling for the dashboard.
 *
 * These routes bypass the Prisma-based auth plugin and use supabase-js
 * throughout. That lets the OCR pipeline work even when the project's
 * Postgres pooler is unreachable from this machine — as long as the
 * Supabase REST/Storage APIs are reachable (they are).
 *
 * Flow:
 *   POST /upload            → validates, uploads to Supabase Storage, creates job (pending)
 *   GET  /jobs              → list jobs (paginated)
 *   GET  /jobs/:id          → single job detail incl. extracted_data
 *   POST /jobs/:id/cancel   → cancel a pending job
 *   GET  /jobs/:id/url      → signed URL for the original file
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../../config/env.js';

// Keep in sync with apps/api/src/workers/ocr-bucket-init.ts and the UI's
// isAcceptedFile() in OcrUploadsPage.tsx. The OCR engine's spreadsheet
// handler supports every format in the SPREADSHEET group.
const ALLOWED_MIME = [
  // Documents
  'application/pdf',
  // Images
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/tiff',
  'image/bmp',
  // Spreadsheets (Microsoft + LibreOffice/OpenDocument + delimited)
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel',                                           // .xls
  'application/vnd.oasis.opendocument.spreadsheet',                     // .ods
  'text/csv',                                                           // .csv
  'text/tab-separated-values',                                          // .tsv
  // Some browsers/OSes send generic types for .csv/.tsv — accept them too.
  'application/csv',
  'text/plain',
] as const;

// Extension fallback — folder picks and some browsers send empty/generic
// MIME. We check the extension when the MIME isn't in the allow-list.
const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'webp', 'tiff', 'tif', 'bmp',
  'xlsx', 'xls', 'ods', 'csv', 'tsv',
]);

function isAllowedUpload(mimetype: string, filename: string): boolean {
  if ((ALLOWED_MIME as readonly string[]).includes(mimetype)) return true;
  const ext = getSafeExtension(filename);
  return !!ext && ALLOWED_EXTENSIONS.has(ext);
}

/**
 * Returns the lowercased extension of a filename, or null if it isn't in the
 * allow-list. Guards against path-traversal style inputs like
 * `ok.png/../../etc/passwd` by first stripping directory segments via
 * `path.basename()`, then validating the remaining suffix against the
 * allow-list (never echoes user-controlled bytes back into the storage path).
 */
function getSafeExtension(filename: string): string | null {
  const base = path.basename(filename);
  const dot = base.lastIndexOf('.');
  if (dot < 0 || dot === base.length - 1) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  // Extension must be short, alphanumeric, and in the allow-list — anything
  // else is a malformed or crafted filename.
  if (!/^[a-z0-9]{1,8}$/.test(ext)) return null;
  return ALLOWED_EXTENSIONS.has(ext) ? ext : null;
}

/**
 * Sanitizes a user-supplied filename for storage in the `original_name`
 * column. Keeps it human-readable but strips path separators, control chars,
 * and caps the length so downstream UIs/exports can't be abused.
 */
function sanitizeDisplayName(filename: string): string {
  const base = path.basename(filename);
  // Remove control characters (including NUL) and collapse whitespace.
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 255) || 'unnamed';
}

let _supabase: SupabaseClient | null = null;
function supabaseAdmin(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _supabase;
}

type OcrJobRow = {
  id: string;
  org_id: string | null;
  uploaded_by: string | null;
  original_name: string;
  storage_path: string;
  file_url: string | null;
  file_type: string;
  file_size_bytes: number | string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  priority: number;
  retry_count: number;
  extracted_data: unknown;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Parses a route `:id` param as a UUID. Returns the id on success, or null
 * after sending a 400. Centralizing this avoids three near-identical blocks.
 */
function parseJobId(req: { params: unknown }, reply: import('fastify').FastifyReply): string | null {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
  if (!parsed.success) {
    reply.code(400).send({
      success: false,
      error: { code: 'INVALID_ID', message: 'Invalid job id.' },
    });
    return null;
  }
  return parsed.data.id;
}

function toCamel(job: OcrJobRow) {
  return {
    id: job.id,
    orgId: job.org_id,
    uploadedBy: job.uploaded_by,
    originalName: job.original_name,
    storagePath: job.storage_path,
    fileUrl: job.file_url,
    fileType: job.file_type,
    fileSizeBytes: Number(job.file_size_bytes),
    status: job.status,
    priority: job.priority,
    retryCount: job.retry_count,
    extractedData: job.extracted_data,
    errorMessage: job.error_message,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

export async function ocrRoutes(app: FastifyInstance) {
  // ─── POST /upload ─────────────────────────────────────────────────────────
  app.post('/upload', async (req, reply) => {
    const data = await req.file();
    if (!data) {
      return reply.code(400).send({
        success: false,
        error: { code: 'NO_FILE', message: 'No file attached.' },
      });
    }

    // Validate the extension first (traversal-proof) before touching the buffer.
    const safeExt = getSafeExtension(data.filename);
    if (!isAllowedUpload(data.mimetype, data.filename) || !safeExt) {
      return reply.code(415).send({
        success: false,
        error: {
          code: 'INVALID_FILE_TYPE',
          message: `Unsupported file type: '${data.mimetype}' (${sanitizeDisplayName(data.filename)}). Allowed: PDF, images (PNG/JPG/WEBP/TIFF/BMP), spreadsheets (XLSX/XLS/ODS/CSV/TSV).`,
        },
      });
    }

    const buffer = await data.toBuffer();

    if (buffer.byteLength > env.OCR_MAX_FILE_SIZE_BYTES) {
      return reply.code(413).send({
        success: false,
        error: {
          code: 'FILE_TOO_LARGE',
          message: `Max file size is ${Math.floor(env.OCR_MAX_FILE_SIZE_BYTES / 1024 / 1024)} MB.`,
        },
      });
    }
    if (buffer.byteLength === 0) {
      return reply.code(400).send({
        success: false,
        error: { code: 'EMPTY_FILE', message: 'File is empty.' },
      });
    }

    const priorityParsed = z
      .object({ priority: z.coerce.number().int().min(0).max(10).default(0) })
      .safeParse(req.query);
    if (!priorityParsed.success) {
      return reply.code(400).send({
        success: false,
        error: {
          code: 'INVALID_QUERY',
          message: 'Invalid `priority` query parameter (must be an integer 0-10).',
        },
      });
    }
    const priority = priorityParsed.data.priority;

    // Content-addressed dedup: SHA-256 the bytes, check for an existing
    // non-failed job with the same hash. If found, return the existing
    // jobId with 409 so the UI can jump to it instead of creating a dupe.
    // Gracefully degrades if migration 013 hasn't been applied yet (the
    // checksum_sha256 column doesn't exist) — uploads continue, just
    // without dedup.
    const checksum = createHash('sha256').update(buffer).digest('hex');

    const supabase = supabaseAdmin();

    let checksumSupported = true;
    const { data: existing, error: dupErr } = await supabase
      .from('ocr_jobs')
      .select('id, status, original_name, created_at')
      .eq('checksum_sha256', checksum)
      .neq('status', 'failed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dupErr) {
      // Postgres 42703 = undefined_column — migration 013 not yet applied.
      if (/column.*checksum_sha256.*does not exist|42703/i.test(dupErr.message)) {
        checksumSupported = false;
        app.log.warn(
          { err: dupErr.message },
          'ocr_dedup_disabled_missing_column',
        );
      } else {
        app.log.warn({ err: dupErr.message }, 'ocr_dedup_lookup_failed');
      }
      // Fall through — don't block an upload on a dedup-check failure.
    } else if (existing) {
      return reply.code(409).send({
        success: false,
        error: {
          code: 'DUPLICATE_FILE',
          message: `This file was already uploaded as "${existing.original_name}".`,
          existingJobId: existing.id,
          existingStatus: existing.status,
        },
      });
    }

    // Storage path is fully server-generated: uuid + safe extension. No user
    // bytes ever touch the path — path traversal is structurally impossible.
    const storagePath = `anon/${Date.now()}-${randomUUID()}.${safeExt}`;
    const displayName = sanitizeDisplayName(data.filename);

    const { error: uploadError } = await supabase.storage
      .from(env.STORAGE_BUCKET_OCR)
      .upload(storagePath, buffer, {
        contentType: data.mimetype,
        upsert: false,
      });

    if (uploadError) {
      app.log.error(
        { uploadError, bucket: env.STORAGE_BUCKET_OCR, storagePath },
        'ocr_storage_upload_failed',
      );
      const msg = uploadError.message ?? 'Unknown storage error';
      const isBucketMissing = /bucket.*not.*found|not.*found.*bucket/i.test(msg);
      return reply.code(500).send({
        success: false,
        error: {
          code: isBucketMissing ? 'BUCKET_NOT_FOUND' : 'UPLOAD_FAILED',
          message: isBucketMissing
            ? `Supabase bucket '${env.STORAGE_BUCKET_OCR}' does not exist.`
            : `Storage upload failed: ${msg}`,
        },
      });
    }

    const insertPayload: Record<string, unknown> = {
      original_name: displayName,
      storage_path: storagePath,
      file_type: data.mimetype,
      file_size_bytes: buffer.byteLength,
      status: 'pending',
      priority,
    };
    if (checksumSupported) {
      insertPayload.checksum_sha256 = checksum;
    }

    const { data: inserted, error: insertError } = await supabase
      .from('ocr_jobs')
      .insert(insertPayload)
      .select('*')
      .single();

    if (insertError || !inserted) {
      app.log.error({ insertError }, 'ocr_job_insert_failed');
      // Best-effort cleanup — don't leave orphaned storage objects. If the
      // cleanup itself fails we log (don't throw); the operator can prune.
      const { error: cleanupErr } = await supabase.storage
        .from(env.STORAGE_BUCKET_OCR)
        .remove([storagePath]);
      if (cleanupErr) {
        app.log.warn(
          { cleanupErr: cleanupErr.message, storagePath },
          'ocr_storage_cleanup_failed',
        );
      }
      // If the unique index caught a duplicate race (both requests passed
      // the dedup check then raced to insert), translate the Postgres error
      // into a clean 409 for the UI.
      const msg = insertError?.message ?? '';
      if (/duplicate key|unique constraint/i.test(msg) && /checksum/i.test(msg)) {
        return reply.code(409).send({
          success: false,
          error: {
            code: 'DUPLICATE_FILE',
            message: 'This file was just uploaded by a concurrent request.',
          },
        });
      }
      return reply.code(500).send({
        success: false,
        error: {
          code: 'JOB_INSERT_FAILED',
          message: `Could not record job: ${insertError?.message ?? 'unknown'}`,
        },
      });
    }

    return reply.code(201).send({
      success: true,
      data: {
        jobId: inserted.id,
        status: inserted.status,
        createdAt: inserted.created_at,
      },
    });
  });

  // ─── GET /jobs ────────────────────────────────────────────────────────────
  app.get('/jobs', async (req, reply) => {
    const parsed = z
      .object({
        status: z.enum(['pending', 'processing', 'completed', 'failed']).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(25),
      })
      .safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { code: 'INVALID_QUERY', message: 'Invalid query parameters.' },
      });
    }
    const query = parsed.data;

    const supabase = supabaseAdmin();
    const from = (query.page - 1) * query.limit;
    const to = from + query.limit - 1;

    let q = supabase
      .from('ocr_jobs')
      .select(
        'id, original_name, file_type, file_size_bytes, status, priority, retry_count, error_message, started_at, completed_at, created_at, updated_at',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(from, to);

    if (query.status) q = q.eq('status', query.status);

    const { data, error, count } = await q;
    if (error) {
      app.log.error({ error }, 'ocr_jobs_list_failed');
      return reply.code(500).send({
        success: false,
        error: { code: 'DB_ERROR', message: error.message },
      });
    }

    const rows = (data ?? []).map((r) => ({
      id: r.id,
      originalName: r.original_name,
      fileType: r.file_type,
      fileSizeBytes: Number(r.file_size_bytes),
      status: r.status,
      priority: r.priority,
      retryCount: r.retry_count,
      errorMessage: r.error_message,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    const total = count ?? rows.length;
    return reply.send({
      success: true,
      data: rows,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    });
  });

  // ─── GET /jobs/:id ────────────────────────────────────────────────────────
  app.get('/jobs/:id', async (req, reply) => {
    const id = parseJobId(req, reply);
    if (!id) return;

    const supabase = supabaseAdmin();
    const { data, error } = await supabase
      .from('ocr_jobs')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      app.log.error({ err: error.message, id }, 'ocr_job_lookup_failed');
      return reply.code(500).send({
        success: false,
        error: { code: 'DB_ERROR', message: error.message },
      });
    }
    if (!data) {
      return reply.code(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Job not found.' },
      });
    }

    return reply.send({ success: true, data: toCamel(data as OcrJobRow) });
  });

  // ─── POST /jobs/:id/cancel ────────────────────────────────────────────────
  app.post('/jobs/:id/cancel', async (req, reply) => {
    const id = parseJobId(req, reply);
    if (!id) return;

    const supabase = supabaseAdmin();
    // Conditional update — only flips if still pending.
    const { data, error } = await supabase
      .from('ocr_jobs')
      .update({
        status: 'failed',
        error_message: 'Cancelled by user',
        completed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id, status')
      .maybeSingle();

    if (error) {
      return reply.code(500).send({
        success: false,
        error: { code: 'DB_ERROR', message: error.message },
      });
    }

    if (!data) {
      return reply.code(409).send({
        success: false,
        error: {
          code: 'NOT_CANCELLABLE',
          message: 'Job is not pending (already processing, completed, or failed).',
        },
      });
    }

    return reply.send({ success: true, data });
  });

  // ─── POST /jobs/:id/retry ─────────────────────────────────────────────────
  // Re-queues a failed job for another OCR attempt. Resets retry_count to 0
  // so the user's manual retry gets the full retry budget back (the retry
  // count is meant for the automatic retry loop, not user actions). Only
  // operates on 'failed' rows — retrying completed or in-progress jobs is a
  // no-op.
  app.post('/jobs/:id/retry', async (req, reply) => {
    const id = parseJobId(req, reply);
    if (!id) return;

    const supabase = supabaseAdmin();
    const { data, error } = await supabase
      .from('ocr_jobs')
      .update({
        status: 'pending',
        retry_count: 0,
        error_message: null,
        started_at: null,
        completed_at: null,
      })
      .eq('id', id)
      .eq('status', 'failed') // only retry failed jobs
      .select('id, status')
      .maybeSingle();

    if (error) {
      app.log.error({ err: error.message, id }, 'ocr_job_retry_failed');
      return reply.code(500).send({
        success: false,
        error: { code: 'DB_ERROR', message: error.message },
      });
    }
    if (!data) {
      return reply.code(409).send({
        success: false,
        error: {
          code: 'NOT_RETRYABLE',
          message: 'Only failed jobs can be retried.',
        },
      });
    }

    return reply.send({ success: true, data });
  });

  // ─── DELETE /jobs/:id ────────────────────────────────────────────────────
  // Removes the DB row AND the storage object. Refuses to delete jobs that are
  // currently processing — cancel them first, then delete.
  app.delete('/jobs/:id', async (req, reply) => {
    const id = parseJobId(req, reply);
    if (!id) return;
    const supabase = supabaseAdmin();

    const { data: job, error: getErr } = await supabase
      .from('ocr_jobs')
      .select('id, status, storage_path')
      .eq('id', id)
      .maybeSingle();

    if (getErr) {
      return reply.code(500).send({
        success: false,
        error: { code: 'DB_ERROR', message: getErr.message },
      });
    }
    if (!job) {
      return reply.code(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Job not found.' },
      });
    }
    if (job.status === 'processing') {
      return reply.code(409).send({
        success: false,
        error: {
          code: 'JOB_ACTIVE',
          message: 'Cannot delete a job that is currently processing.',
        },
      });
    }

    // Delete storage object first. If it fails, don't orphan the DB row —
    // the user can retry. If the object is already gone (404), proceed anyway.
    const { error: delErr } = await supabase.storage
      .from(env.STORAGE_BUCKET_OCR)
      .remove([job.storage_path]);

    if (delErr && !/not.?found/i.test(delErr.message)) {
      app.log.error({ delErr, path: job.storage_path }, 'ocr_storage_delete_failed');
      return reply.code(500).send({
        success: false,
        error: {
          code: 'STORAGE_DELETE_FAILED',
          message: `Could not delete storage object: ${delErr.message}`,
        },
      });
    }

    const { error: rowErr } = await supabase.from('ocr_jobs').delete().eq('id', id);
    if (rowErr) {
      app.log.error({ rowErr, id }, 'ocr_job_row_delete_failed');
      return reply.code(500).send({
        success: false,
        error: { code: 'DB_ERROR', message: rowErr.message },
      });
    }

    return reply.send({ success: true, data: { id } });
  });

  // ─── GET /jobs/:id/url ────────────────────────────────────────────────────
  app.get('/jobs/:id/url', async (req, reply) => {
    const id = parseJobId(req, reply);
    if (!id) return;

    const supabase = supabaseAdmin();
    const { data: job, error } = await supabase
      .from('ocr_jobs')
      .select('storage_path')
      .eq('id', id)
      .maybeSingle();

    // Distinguish 500 (DB error) from 404 (no such job) — conflating them
    // hides server failures as missing resources, which breaks monitoring.
    if (error) {
      app.log.error({ err: error.message, id }, 'ocr_signed_url_lookup_failed');
      return reply.code(500).send({
        success: false,
        error: { code: 'DB_ERROR', message: error.message },
      });
    }
    if (!job) {
      return reply.code(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Job not found.' },
      });
    }

    const { data: signed, error: signErr } = await supabase.storage
      .from(env.STORAGE_BUCKET_OCR)
      .createSignedUrl(job.storage_path, env.SIGNED_URL_EXPIRY_SECONDS);

    if (signErr || !signed) {
      return reply.code(500).send({
        success: false,
        error: { code: 'SIGNED_URL_FAILED', message: signErr?.message ?? 'unknown' },
      });
    }

    return reply.send({
      success: true,
      data: { url: signed.signedUrl, expiresIn: env.SIGNED_URL_EXPIRY_SECONDS },
    });
  });
}
