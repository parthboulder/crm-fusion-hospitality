/**
 * Auto-snapshot trigger for the OCR pipeline.
 *
 * The OCR worker calls scheduleSnapshot() after each job completes. We coalesce
 * a burst of completions (e.g. 50 jobs in 30 seconds) into a single snapshot
 * by debouncing — set a timer on the first call, reset it on each subsequent
 * call, fire once when the burst quiets down. Cap the wait so a continuous
 * stream of jobs still produces snapshots periodically.
 */

import path from 'node:path';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import type { FastifyBaseLogger } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';

const SNAPSHOT_DIR = path.resolve(process.cwd(), 'data');
const SNAPSHOT_PATH = path.join(SNAPSHOT_DIR, 'ocr-snapshot.json');

// Debounce window — a burst of completions within this window collapses to
// one snapshot. Keep it short enough that the Documents page sees fresh data
// soon after a manual upload.
const DEBOUNCE_MS = 5_000;
// Max wait — even if completions keep arriving, snapshot at least this often.
const MAX_WAIT_MS = 60_000;

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
  archived: boolean;
}

interface SnapshotFile {
  generatedAt: string;
  totalJobs: number;
  jobs: SnapshotJob[];
}

let pendingTimer: NodeJS.Timeout | null = null;
let firstScheduledAt: number | null = null;
let inFlight = false;

async function readSnapshot(): Promise<SnapshotFile | null> {
  try {
    return JSON.parse(await readFile(SNAPSHOT_PATH, 'utf8')) as SnapshotFile;
  } catch {
    return null;
  }
}

async function writeSnapshot(snap: SnapshotFile): Promise<void> {
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  const tmp = `${SNAPSHOT_PATH}.tmp-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(snap), 'utf8');
  await rename(tmp, SNAPSHOT_PATH);
}

export async function runSnapshotNow(
  supabase: SupabaseClient,
  log: FastifyBaseLogger,
): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
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
        log.error({ err: error.message }, 'ocr_snapshot.auto.fetch_failed');
        return;
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

    // Preserve previously archived rows (deleted from DB but kept in snapshot).
    const prev = await readSnapshot();
    const liveIds = new Set(collected.map((j) => j.id));
    const archived = (prev?.jobs ?? [])
      .filter((j) => !liveIds.has(j.id))
      .map((j) => ({ ...j, archived: true }));

    await writeSnapshot({
      generatedAt: new Date().toISOString(),
      totalJobs: collected.length + archived.length,
      jobs: [...collected, ...archived],
    });

    log.info(
      { live: collected.length, archived: archived.length },
      'ocr_snapshot.auto.complete',
    );
  } finally {
    inFlight = false;
  }
}

/**
 * Debounced snapshot. Safe to call from hot paths (per-job completion) — a
 * single snapshot will run after the burst settles, or sooner if the burst
 * has been ongoing for MAX_WAIT_MS.
 */
export function scheduleSnapshot(
  supabase: SupabaseClient,
  log: FastifyBaseLogger,
): void {
  const now = Date.now();
  if (firstScheduledAt == null) firstScheduledAt = now;

  if (pendingTimer) clearTimeout(pendingTimer);

  const sinceFirst = now - firstScheduledAt;
  const wait = Math.min(DEBOUNCE_MS, Math.max(0, MAX_WAIT_MS - sinceFirst));

  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    firstScheduledAt = null;
    void runSnapshotNow(supabase, log).catch((e) =>
      log.error({ err: (e as Error).message }, 'ocr_snapshot.auto.uncaught'),
    );
  }, wait);
}
