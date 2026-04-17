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
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../../config/env.js';
import { classifyFromFilename } from '../../lib/report-classifier.js';

// Server-side snapshot file. Documents page reads this so the UI keeps
// showing data even after rows are bulk-deleted from ocr_jobs.
const SNAPSHOT_DIR = path.resolve(process.cwd(), 'data');
const SNAPSHOT_PATH = path.join(SNAPSHOT_DIR, 'ocr-snapshot.json');

interface SnapshotJob {
  id: string;
  originalName: string;
  fileType: string;
  fileSizeBytes: number;
  status: string;
  property: string | null;
  dateFolder: string | null;
  reportType: string | null;
  reportCategory: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  archived: boolean; // true = no longer in DB, served from snapshot only
}

interface SnapshotFile {
  generatedAt: string;
  totalJobs: number;
  jobs: SnapshotJob[];
}

async function readSnapshot(): Promise<SnapshotFile | null> {
  try {
    const raw = await readFile(SNAPSHOT_PATH, 'utf8');
    return JSON.parse(raw) as SnapshotFile;
  } catch {
    return null;
  }
}

async function writeSnapshot(snap: SnapshotFile): Promise<void> {
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  // Atomic write — temp file + rename — so a crash mid-write can't leave a
  // truncated snapshot that breaks the read path.
  const tmp = `${SNAPSHOT_PATH}.tmp-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(snap), 'utf8');
  const { rename } = await import('node:fs/promises');
  await rename(tmp, SNAPSHOT_PATH);
}

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

    // Initial classification from filename only — the OCR worker re-runs
    // this against the extracted text once available, which is far more
    // accurate. Filename-based guesses give the UI something to filter on
    // immediately even before OCR completes.
    const initialClass = classifyFromFilename(displayName);

    const insertPayload: Record<string, unknown> = {
      original_name: displayName,
      storage_path: storagePath,
      file_type: data.mimetype,
      file_size_bytes: buffer.byteLength,
      status: 'pending',
      priority,
      property: initialClass.property,
      date_folder: initialClass.dateFolder,
      report_type: initialClass.reportType,
      report_category: initialClass.category,
    };
    if (checksumSupported) {
      insertPayload.checksum_sha256 = checksum;
    }

    let inserted: { id: string; status: string; created_at: string } | null = null;
    let insertError: { message: string } | null = null;
    {
      const res = await supabase
        .from('ocr_jobs')
        .insert(insertPayload)
        .select('*')
        .single();
      inserted = res.data as { id: string; status: string; created_at: string } | null;
      insertError = res.error;

      // Migration 014 not yet applied — retry without classification fields.
      if (insertError && /column.*(property|date_folder|report_type|report_category).*does not exist|42703/i.test(insertError.message)) {
        app.log.warn({ err: insertError.message }, 'ocr_classification_columns_missing_skipping');
        delete insertPayload.property;
        delete insertPayload.date_folder;
        delete insertPayload.report_type;
        delete insertPayload.report_category;
        const retry = await supabase
          .from('ocr_jobs')
          .insert(insertPayload)
          .select('*')
          .single();
        inserted = retry.data as { id: string; status: string; created_at: string } | null;
        insertError = retry.error;
      }
    }

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
        property: z.string().min(1).max(120).optional(),
        dateFolder: z.string().min(1).max(20).optional(),
        reportType: z.string().min(1).max(120).optional(),
        category: z.string().min(1).max(120).optional(),
        search: z.string().min(1).max(200).optional(),
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

    // Try the wide select first. If the classification columns aren't
    // present yet (migration 014 not applied), fall back to the narrow set
    // and synthesize nulls. Same self-healing pattern as the upload route.
    const wideCols =
      'id, original_name, file_type, file_size_bytes, status, priority, retry_count, error_message, started_at, completed_at, created_at, updated_at, property, date_folder, report_type, report_category';
    const narrowCols =
      'id, original_name, file_type, file_size_bytes, status, priority, retry_count, error_message, started_at, completed_at, created_at, updated_at';

    const buildQuery = (cols: string) => {
      let q = supabase
        .from('ocr_jobs')
        .select(cols, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);
      if (query.status) q = q.eq('status', query.status);
      if (query.property)   q = q.eq('property', query.property);
      if (query.dateFolder) q = q.eq('date_folder', query.dateFolder);
      if (query.reportType) q = q.eq('report_type', query.reportType);
      if (query.category)   q = q.eq('report_category', query.category);
      if (query.search)     q = q.ilike('original_name', `%${query.search}%`);
      return q;
    };

    let { data, error, count } = await buildQuery(wideCols);
    let classificationColumnsAvailable = true;
    if (error && /column.*(property|date_folder|report_type|report_category).*does not exist|42703/i.test(error.message)) {
      app.log.warn({ err: error.message }, 'ocr_jobs_list_falling_back_no_classification_cols');
      classificationColumnsAvailable = false;
      const retry = await buildQuery(narrowCols);
      data = retry.data;
      error = retry.error;
      count = retry.count;
    }

    if (error) {
      app.log.error({ error }, 'ocr_jobs_list_failed');
      return reply.code(500).send({
        success: false,
        error: { code: 'DB_ERROR', message: error.message },
      });
    }

    const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      originalName: r.original_name as string,
      fileType: r.file_type as string,
      fileSizeBytes: Number(r.file_size_bytes),
      status: r.status as 'pending' | 'processing' | 'completed' | 'failed',
      priority: r.priority as number,
      retryCount: r.retry_count as number,
      errorMessage: r.error_message as string | null,
      startedAt: r.started_at as string | null,
      completedAt: r.completed_at as string | null,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      property: classificationColumnsAvailable ? (r.property as string | null) ?? null : null,
      dateFolder: classificationColumnsAvailable ? (r.date_folder as string | null) ?? null : null,
      reportType: classificationColumnsAvailable ? (r.report_type as string | null) ?? null : null,
      reportCategory: classificationColumnsAvailable ? (r.report_category as string | null) ?? null : null,
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

  // ─── GET /jobs/facets ────────────────────────────────────────────────────
  // Returns the unique values for the four classification dropdowns. The UI
  // calls this once to populate dropdowns; doing it client-side would only
  // see the current page of jobs, which gives wrong filter options when
  // there are >limit total jobs.
  app.get('/jobs/facets', async (_req, reply) => {
    const supabase = supabaseAdmin();
    const { data, error } = await supabase
      .from('ocr_jobs')
      .select('property, date_folder, report_type, report_category')
      .limit(5000); // cap — huge tables don't need every value

    if (error) {
      // Migration not applied yet — return empty facets so the UI still loads.
      if (/column.*(property|date_folder|report_type|report_category).*does not exist|42703/i.test(error.message)) {
        return reply.send({ success: true, data: { properties: [], dates: [], reportTypes: [], categories: [] } });
      }
      app.log.error({ error }, 'ocr_jobs_facets_failed');
      return reply.code(500).send({
        success: false,
        error: { code: 'DB_ERROR', message: error.message },
      });
    }

    const props = new Set<string>();
    const dates = new Set<string>();
    const types = new Set<string>();
    const cats  = new Set<string>();
    for (const r of data ?? []) {
      const row = r as { property: string | null; date_folder: string | null; report_type: string | null; report_category: string | null };
      if (row.property) props.add(row.property);
      if (row.date_folder) dates.add(row.date_folder);
      if (row.report_type) types.add(row.report_type);
      if (row.report_category) cats.add(row.report_category);
    }

    return reply.send({
      success: true,
      data: {
        properties:  [...props].sort(),
        dates:       [...dates].sort().reverse(), // newest first
        reportTypes: [...types].sort(),
        categories:  [...cats].sort(),
      },
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

  // ─── POST /jobs/snapshot ─────────────────────────────────────────────────
  // Dump the current ocr_jobs table to a server-side JSON file. The
  // Documents page reads from /jobs/persisted (below) so even after
  // bulk-delete frees DB space, the UI keeps rendering the snapshot.
  app.post('/jobs/snapshot', async (_req, reply) => {
    const supabase = supabaseAdmin();

    // Page through the table — Supabase caps select() at 1000 rows by default.
    const PAGE = 1000;
    const collected: SnapshotJob[] = [];
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from('ocr_jobs')
        .select(
          'id, original_name, file_type, file_size_bytes, status, property, date_folder, report_type, report_category, error_message, created_at, completed_at',
        )
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (error) {
        app.log.error({ err: error.message }, 'ocr_snapshot.fetch_failed');
        return reply.code(500).send({
          success: false,
          error: { code: 'DB_ERROR', message: error.message },
        });
      }
      if (!data || data.length === 0) break;
      for (const r of data as Record<string, unknown>[]) {
        collected.push({
          id: r['id'] as string,
          originalName: r['original_name'] as string,
          fileType: r['file_type'] as string,
          fileSizeBytes: Number(r['file_size_bytes']),
          status: r['status'] as string,
          property: (r['property'] as string | null) ?? null,
          dateFolder: (r['date_folder'] as string | null) ?? null,
          reportType: (r['report_type'] as string | null) ?? null,
          reportCategory: (r['report_category'] as string | null) ?? null,
          errorMessage: (r['error_message'] as string | null) ?? null,
          createdAt: r['created_at'] as string,
          completedAt: (r['completed_at'] as string | null) ?? null,
          archived: false,
        });
      }
      if (data.length < PAGE) break;
      offset += PAGE;
    }

    // Merge with existing snapshot — anything in the old snapshot that's
    // missing from the live DB is marked archived:true so it stays visible.
    const prev = await readSnapshot();
    const liveIds = new Set(collected.map((j) => j.id));
    const archivedFromPrev = (prev?.jobs ?? [])
      .filter((j) => !liveIds.has(j.id))
      .map((j) => ({ ...j, archived: true }));

    const merged: SnapshotFile = {
      generatedAt: new Date().toISOString(),
      totalJobs: collected.length + archivedFromPrev.length,
      jobs: [...collected, ...archivedFromPrev],
    };

    await writeSnapshot(merged);

    let bytes = 0;
    try {
      const s = await stat(SNAPSHOT_PATH);
      bytes = s.size;
    } catch {
      /* ignore */
    }

    return reply.send({
      success: true,
      data: {
        generatedAt: merged.generatedAt,
        liveJobs: collected.length,
        archivedJobs: archivedFromPrev.length,
        totalJobs: merged.totalJobs,
        snapshotBytes: bytes,
      },
    });
  });

  // ─── GET /jobs/persisted ─────────────────────────────────────────────────
  // Server-side persisted view. Same query params as /jobs but reads from
  // the snapshot file. Use this on Documents page to keep showing data
  // after bulk delete frees DB space.
  app.get('/jobs/persisted', async (req, reply) => {
    const parsed = z
      .object({
        property: z.string().min(1).max(120).optional(),
        dateFolder: z.string().min(1).max(20).optional(),
        reportType: z.string().min(1).max(120).optional(),
        category: z.string().min(1).max(120).optional(),
        search: z.string().min(1).max(200).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(10000).default(100),
      })
      .safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { code: 'INVALID_QUERY', message: 'Invalid query parameters.' },
      });
    }
    const q = parsed.data;

    let snap = await readSnapshot();
    // First-run convenience: if no snapshot exists yet, generate one on the
    // fly so the Documents page has something to render. Operators can still
    // explicitly snapshot later from Settings → Storage.
    if (!snap) {
      try {
        const res = await app.inject({ method: 'POST', url: '/api/v1/ocr/jobs/snapshot' });
        if (res.statusCode < 400) {
          snap = await readSnapshot();
        }
      } catch (e) {
        app.log.warn({ err: (e as Error).message }, 'ocr_persisted.auto_snapshot_failed');
      }
    }
    if (!snap) {
      return reply.send({
        success: true,
        data: [],
        total: 0,
        page: q.page,
        limit: q.limit,
        totalPages: 1,
        snapshotGeneratedAt: null,
      });
    }

    let items = snap.jobs;
    if (q.property)   items = items.filter((j) => j.property === q.property);
    if (q.dateFolder) items = items.filter((j) => j.dateFolder === q.dateFolder);
    if (q.reportType) items = items.filter((j) => j.reportType === q.reportType);
    if (q.category)   items = items.filter((j) => j.reportCategory === q.category);
    if (q.search) {
      const needle = q.search.toLowerCase();
      items = items.filter((j) => j.originalName.toLowerCase().includes(needle));
    }

    const total = items.length;
    const from = (q.page - 1) * q.limit;
    const slice = items.slice(from, from + q.limit);

    return reply.send({
      success: true,
      data: slice,
      total,
      page: q.page,
      limit: q.limit,
      totalPages: Math.max(1, Math.ceil(total / q.limit)),
      snapshotGeneratedAt: snap.generatedAt,
    });
  });

  // ─── POST /jobs/bulk-delete ──────────────────────────────────────────────
  // Delete OCR jobs by status + age criteria. Snapshot first so Documents
  // page keeps showing them. Returns the deleted count + freed bytes.
  app.post('/jobs/bulk-delete', async (req, reply) => {
    const parsed = z
      .object({
        status: z
          .enum(['pending', 'processing', 'completed', 'failed', 'any'])
          .default('completed'),
        olderThanDays: z.coerce.number().int().min(0).max(3650).default(0),
        snapshotFirst: z.coerce.boolean().default(true),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { code: 'INVALID_BODY', message: 'Invalid request body.' },
      });
    }
    const { status, olderThanDays, snapshotFirst } = parsed.data;

    const supabase = supabaseAdmin();

    // Build the matching query so we can preview affected rows before delete.
    let q = supabase.from('ocr_jobs').select('id, storage_path, file_size_bytes, status, created_at');
    if (status !== 'any') q = q.eq('status', status);
    if (olderThanDays > 0) {
      const cutoff = new Date(Date.now() - olderThanDays * 24 * 3600 * 1000).toISOString();
      q = q.lt('created_at', cutoff);
    }
    // Refuse to delete actively processing rows — they may finish writing
    // results while we delete underneath them.
    if (status === 'any') q = q.neq('status', 'processing');

    const { data: matches, error: selErr } = await q;
    if (selErr) {
      app.log.error({ err: selErr.message }, 'ocr_bulk_delete.select_failed');
      return reply.code(500).send({
        success: false,
        error: { code: 'DB_ERROR', message: selErr.message },
      });
    }
    if (!matches || matches.length === 0) {
      return reply.send({
        success: true,
        data: { deleted: 0, freedBytes: 0, message: 'No matching jobs.' },
      });
    }

    // Snapshot first (default) so Documents page keeps the rows visible.
    if (snapshotFirst) {
      try {
        const res = await app.inject({ method: 'POST', url: '/api/v1/ocr/jobs/snapshot' });
        if (res.statusCode >= 400) {
          app.log.warn({ status: res.statusCode, body: res.body }, 'ocr_bulk_delete.snapshot_failed');
        }
      } catch (e) {
        app.log.warn({ err: (e as Error).message }, 'ocr_bulk_delete.snapshot_failed');
        // Don't block the delete — operator explicitly asked for it.
      }
    }

    const ids = matches.map((m) => m.id as string);
    const paths = matches
      .map((m) => m.storage_path as string)
      .filter((p): p is string => !!p);
    const totalBytes = matches.reduce((s, m) => s + Number(m.file_size_bytes ?? 0), 0);

    // Best-effort storage cleanup. If it fails, still proceed with DB delete
    // so the user gets DB space back; orphaned objects can be pruned later.
    if (paths.length > 0) {
      const { error: stErr } = await supabase.storage
        .from(env.STORAGE_BUCKET_OCR)
        .remove(paths);
      if (stErr) {
        app.log.warn({ err: stErr.message }, 'ocr_bulk_delete.storage_cleanup_failed');
      }
    }

    const { error: delErr } = await supabase.from('ocr_jobs').delete().in('id', ids);
    if (delErr) {
      app.log.error({ err: delErr.message }, 'ocr_bulk_delete.db_delete_failed');
      return reply.code(500).send({
        success: false,
        error: { code: 'DB_ERROR', message: delErr.message },
      });
    }

    return reply.send({
      success: true,
      data: { deleted: ids.length, freedBytes: totalBytes },
    });
  });

  // ─── GET /jobs/storage-stats ─────────────────────────────────────────────
  // Surfaces how much DB space ocr_jobs is using + snapshot info, so the
  // Settings page can show the operator what to clean.
  app.get('/jobs/storage-stats', async (_req, reply) => {
    const supabase = supabaseAdmin();
    const counts: Record<string, number> = {
      pending: 0, processing: 0, completed: 0, failed: 0,
    };
    let totalBytes = 0;

    const PAGE = 1000;
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from('ocr_jobs')
        .select('status, file_size_bytes')
        .range(offset, offset + PAGE - 1);
      if (error) {
        return reply.code(500).send({
          success: false,
          error: { code: 'DB_ERROR', message: error.message },
        });
      }
      if (!data || data.length === 0) break;
      for (const r of data as { status: string; file_size_bytes: number | string }[]) {
        counts[r.status] = (counts[r.status] ?? 0) + 1;
        totalBytes += Number(r.file_size_bytes ?? 0);
      }
      if (data.length < PAGE) break;
      offset += PAGE;
    }

    let snapshotBytes = 0;
    let snapshotGeneratedAt: string | null = null;
    let snapshotJobs = 0;
    try {
      const s = await stat(SNAPSHOT_PATH);
      snapshotBytes = s.size;
      const snap = await readSnapshot();
      snapshotGeneratedAt = snap?.generatedAt ?? null;
      snapshotJobs = snap?.totalJobs ?? 0;
    } catch {
      /* no snapshot yet */
    }

    return reply.send({
      success: true,
      data: {
        dbJobs: Object.values(counts).reduce((a, b) => a + b, 0),
        dbBytes: totalBytes,
        statusCounts: counts,
        snapshotBytes,
        snapshotJobs,
        snapshotGeneratedAt,
      },
    });
  });
}
