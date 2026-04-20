/**
 * In-process OCR worker. Polls ocr_jobs via supabase-js, claims pending rows,
 * downloads from Supabase Storage, runs OCR + financial extraction, persists.
 *
 * Uses supabase-js (not Prisma) so the worker survives even when the Postgres
 * pooler isn't reachable — the REST API path still works. Claim safety is
 * achieved via a conditional `UPDATE ... WHERE status='pending'` which is
 * race-safe at the row level (Postgres takes a row lock during the update).
 */

import type { FastifyBaseLogger } from 'fastify';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { processFile, extractFinancialData, TesseractWorkerPool } from '../lib/ocr/index.js';
import { ingestOcrResult } from '../lib/report-parsers.js';
import { classifyFromContent } from '../lib/report-classifier.js';
import { reconcileDates, extractUniqueDates } from '../lib/date-reconciler.js';
import { env } from '../config/env.js';

interface WorkerHandle {
  stop: () => Promise<void>;
}

interface ClaimedJob {
  id: string;
  storagePath: string;
  originalName: string;
  fileType: string;
  retryCount: number;
}

/**
 * Reclaim jobs that were orphaned by a previous API crash.
 *
 * If the process died mid-OCR (e.g. pdfjs threw from an internal async
 * stream that our try/catch couldn't wrap), the corresponding row is stuck
 * in `status='processing'` forever. On startup we sweep those rows:
 *   - `started_at` older than STALE_MS → retry or fail based on retry count
 *
 * We only target rows older than STALE_MS so we don't clobber jobs that
 * are legitimately running on another worker instance in a multi-node setup.
 */
const STALE_PROCESSING_MS = 5 * 60 * 1000; // 5 minutes

async function reclaimStaleJobs(
  supabase: SupabaseClient,
  log: FastifyBaseLogger,
): Promise<void> {
  const staleCutoff = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();

  const { data: stuck, error: selErr } = await supabase
    .from('ocr_jobs')
    .select('id, retry_count')
    .eq('status', 'processing')
    .lt('started_at', staleCutoff);

  if (selErr) {
    log.error({ err: selErr.message }, 'ocr_worker.reclaim.select_error');
    return;
  }
  if (!stuck || stuck.length === 0) return;

  log.warn({ count: stuck.length }, 'ocr_worker.reclaim.found_stuck_jobs');

  for (const row of stuck) {
    const shouldRetry = row.retry_count < env.OCR_WORKER_MAX_RETRIES;
    const { error: updErr } = await supabase
      .from('ocr_jobs')
      .update(
        shouldRetry
          ? {
              status: 'pending',
              retry_count: row.retry_count + 1,
              error_message: 'Worker crashed mid-job; requeued.',
              started_at: null,
            }
          : {
              status: 'failed',
              error_message: 'Worker crashed mid-job; max retries exhausted.',
              completed_at: new Date().toISOString(),
            },
      )
      .eq('id', row.id)
      .eq('status', 'processing'); // only if still stuck

    if (updErr) {
      log.error({ err: updErr.message, jobId: row.id }, 'ocr_worker.reclaim.update_error');
    } else {
      log.info(
        { jobId: row.id, action: shouldRetry ? 'requeued' : 'failed' },
        'ocr_worker.reclaim.reset',
      );
    }
  }
}

export function startOcrWorker(log: FastifyBaseLogger): WorkerHandle {
  if (!env.OCR_WORKER_ENABLED) {
    log.info('ocr_worker.disabled');
    return { stop: async () => {} };
  }

  const supabase: SupabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Sweep orphaned jobs left over from prior process crashes. Run async —
  // don't block worker startup on it.
  reclaimStaleJobs(supabase, log).catch((err) => {
    log.error({ err: err instanceof Error ? err.message : String(err) }, 'ocr_worker.reclaim.error');
  });

  let tesseractPool: TesseractWorkerPool | null = null;
  const getTesseractPool = async (): Promise<TesseractWorkerPool> => {
    if (!tesseractPool) {
      tesseractPool = new TesseractWorkerPool({
        numWorkers: Math.max(1, env.OCR_WORKER_CONCURRENCY),
      });
      await tesseractPool.initialize();
    }
    return tesseractPool;
  };

  let inFlight = 0;
  let stopping = false;
  let timer: NodeJS.Timeout | null = null;

  async function claimJob(): Promise<ClaimedJob | null> {
    // Find the oldest pending job. Because we can't use `FOR UPDATE SKIP LOCKED`
    // over the REST API, we rely on a conditional update: only one worker will
    // successfully flip 'pending' → 'processing' for a given row (Postgres row
    // lock serializes concurrent UPDATEs, and the WHERE status='pending'
    // predicate means the loser's update affects zero rows).
    const { data: candidates, error: selErr } = await supabase
      .from('ocr_jobs')
      .select('id, storage_path, original_name, file_type, retry_count')
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1);

    if (selErr) {
      log.error({ err: selErr.message }, 'ocr_worker.claim.select_error');
      return null;
    }
    const candidate = candidates?.[0];
    if (!candidate) return null;

    const { data: claimed, error: updErr } = await supabase
      .from('ocr_jobs')
      .update({
        status: 'processing',
        started_at: new Date().toISOString(),
      })
      .eq('id', candidate.id)
      .eq('status', 'pending') // only succeeds if still pending
      .select('id, storage_path, original_name, file_type, retry_count')
      .maybeSingle();

    if (updErr) {
      log.error({ err: updErr.message, jobId: candidate.id }, 'ocr_worker.claim.update_error');
      return null;
    }
    if (!claimed) return null; // lost the race — another worker took it

    return {
      id: claimed.id,
      storagePath: claimed.storage_path,
      originalName: claimed.original_name,
      fileType: claimed.file_type,
      retryCount: claimed.retry_count,
    };
  }

  async function runJob(job: ClaimedJob): Promise<void> {
    log.info({ jobId: job.id, name: job.originalName }, 'ocr_worker.job.start');

    try {
      // 1. Download from Supabase Storage.
      const { data: blob, error: dlError } = await supabase.storage
        .from(env.STORAGE_BUCKET_OCR)
        .download(job.storagePath);

      if (dlError || !blob) {
        throw new Error(`Download failed: ${dlError?.message ?? 'no data'}`);
      }

      const buffer = Buffer.from(await blob.arrayBuffer());

      // 2. Run OCR.
      const ocrResult = await processFile({
        originalName: job.originalName,
        buffer,
        mimeType: job.fileType,
        ...(env.NVIDIA_API_KEY
          ? { nvidiaApiKey: env.NVIDIA_API_KEY }
          : { tesseractPool: await getTesseractPool() }),
      });

      // 3. Extract financial data.
      const financial = extractFinancialData(ocrResult.fullText);

      // 4. Persist completed.
      const extractedData = {
        ocr: {
          method: ocrResult.method,
          totalConfidence: ocrResult.totalConfidence,
          processingTimeMs: ocrResult.processingTimeMs,
          pageCount: ocrResult.pages.length,
          pages: ocrResult.pages,
        },
        financial,
        // Every distinct ISO date found anywhere in the body, sorted
        // ascending. The UI renders this as the "Dates found" section —
        // deduped and normalized so "26-Mar-26" and "03/26/2026" collapse
        // into one chip.
        uniqueDates: extractUniqueDates(ocrResult.fullText),
        fullText: ocrResult.fullText,
        fullTextPreview: ocrResult.fullText.slice(0, 4000),
      };

      // Re-classify with the extracted text — far more accurate than the
      // filename-only guess made at upload time.
      const refined = classifyFromContent(job.originalName, ocrResult.fullText);

      // Reconcile the three date sources. Filename date (from the classifier)
      // is the weakest signal; business date lives in the PDF body and is
      // canonical. Any drift surfaces as a warning on the job.
      const dates = reconcileDates({
        filenameDate: refined.dateFolder,
        fullText: ocrResult.fullText,
        category: refined.category,
      });

      if (dates.warnings.length > 0) {
        log.info(
          { jobId: job.id, warnings: dates.warnings.map((w) => w.code) },
          'ocr_worker.job.date_warnings',
        );
      }

      const completePayload: Record<string, unknown> = {
        status: 'completed',
        completed_at: new Date().toISOString(),
        extracted_data: extractedData,
        property: refined.property,
        // date_folder stays as the filename-derived date for backwards
        // compat with the existing dropdown filter.
        date_folder: refined.dateFolder,
        report_type: refined.reportType,
        report_category: refined.category,
        business_date: dates.businessDate,
        report_generated_at: dates.reportGeneratedAt,
        filename_date: dates.filenameDate,
        warnings: dates.warnings,
      };

      let { error: completeErr } = await supabase
        .from('ocr_jobs')
        .update(completePayload)
        .eq('id', job.id);

      // Migration 015 not yet applied — retry without business-date fields.
      if (completeErr && /column.*(business_date|report_generated_at|filename_date|warnings).*does not exist|42703/i.test(completeErr.message)) {
        log.warn({ err: completeErr.message, jobId: job.id }, 'ocr_business_date_columns_missing_skipping');
        const {
          business_date: _b,
          report_generated_at: _r,
          filename_date: _f,
          warnings: _w,
          ...withoutBusinessDates
        } = completePayload;
        const retry = await supabase
          .from('ocr_jobs')
          .update(withoutBusinessDates)
          .eq('id', job.id);
        completeErr = retry.error;
      }

      // Migration 014 not yet applied — retry without classification fields
      // so the OCR pipeline still completes successfully.
      if (completeErr && /column.*(property|date_folder|report_type|report_category).*does not exist|42703/i.test(completeErr.message)) {
        log.warn({ err: completeErr.message, jobId: job.id }, 'ocr_classification_columns_missing_skipping');
        const retry = await supabase
          .from('ocr_jobs')
          .update({
            status: 'completed',
            completed_at: completePayload.completed_at,
            extracted_data: extractedData,
          })
          .eq('id', job.id);
        completeErr = retry.error;
      }

      if (completeErr) {
        throw new Error(`Persist failed: ${completeErr.message}`);
      }

      log.info(
        { jobId: job.id, method: ocrResult.method, ms: ocrResult.processingTimeMs },
        'ocr_worker.job.complete',
      );

      // 5. Post-OCR: parse and ingest into performance tables if applicable.
      try {
        await ingestOcrResult(job.id, job.originalName, ocrResult.fullText, log);
      } catch (ingestErr) {
        // Non-fatal — OCR succeeded, ingestion is best-effort.
        log.warn(
          { jobId: job.id, err: ingestErr instanceof Error ? ingestErr.message : String(ingestErr) },
          'ocr_worker.ingest.failed',
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ jobId: job.id, err: message }, 'ocr_worker.job.error');

      const shouldRetry = job.retryCount < env.OCR_WORKER_MAX_RETRIES;
      const { error: updateErr } = await supabase
        .from('ocr_jobs')
        .update(
          shouldRetry
            ? {
                status: 'pending',
                retry_count: job.retryCount + 1,
                error_message: message,
                started_at: null,
              }
            : {
                status: 'failed',
                error_message: message,
                completed_at: new Date().toISOString(),
              },
        )
        .eq('id', job.id);

      if (updateErr) {
        // The job row is now stuck in 'processing'. Log loudly — a human or
        // a reconciler sweep needs to unstick it. We don't throw because the
        // caller is the worker's fire-and-forget runJob(); rethrowing here
        // would surface as an unhandled rejection.
        log.error(
          { jobId: job.id, err: updateErr.message, wasRetrying: shouldRetry },
          'ocr_worker.job.error_persist_failed',
        );
      }
    }
  }

  async function tick(): Promise<void> {
    if (stopping) return;

    const slots = env.OCR_WORKER_CONCURRENCY - inFlight;
    if (slots <= 0) return;

    for (let i = 0; i < slots; i++) {
      const job = await claimJob();
      if (!job) break;

      inFlight++;
      // Guard against unhandled rejections: runJob swallows job-level errors
      // via its inner try/catch, but a bug outside that (e.g. in claimJob's
      // follow-up code) could still throw. An unhandled rejection in Node
      // 20+ crashes the process — log and continue instead.
      runJob(job)
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          log.error(
            { jobId: job.id, err: message },
            'ocr_worker.job.unhandled_error',
          );
        })
        .finally(() => {
          inFlight--;
        });
    }
  }

  tick().catch((err) => log.error({ err }, 'ocr_worker.tick.error'));
  timer = setInterval(() => {
    tick().catch((err) => log.error({ err }, 'ocr_worker.tick.error'));
  }, env.OCR_WORKER_INTERVAL_MS);

  log.info(
    {
      intervalMs: env.OCR_WORKER_INTERVAL_MS,
      concurrency: env.OCR_WORKER_CONCURRENCY,
      maxRetries: env.OCR_WORKER_MAX_RETRIES,
    },
    'ocr_worker.started',
  );

  return {
    stop: async () => {
      stopping = true;
      if (timer) clearInterval(timer);

      const deadline = Date.now() + 30_000;
      while (inFlight > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
      }

      if (tesseractPool) {
        await tesseractPool.terminate().catch(() => null);
      }

      log.info('ocr_worker.stopped');
    },
  };
}
