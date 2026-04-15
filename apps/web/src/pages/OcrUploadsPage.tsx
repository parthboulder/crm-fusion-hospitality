/**
 * OCR uploads dashboard — drop files, poll job status, inspect extracted data.
 * Independent from DocumentsPage (which reads pre-scanned OneDrive output).
 */

import { useState, useCallback, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import { clsx } from 'clsx';
import {
  CloudArrowUpIcon,
  DocumentTextIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ArrowPathIcon,
  XMarkIcon,
  FolderPlusIcon,
  NoSymbolIcon,
  StopCircleIcon,
  TableCellsIcon,
  PhotoIcon,
  TrashIcon,
  ArrowUturnLeftIcon,
} from '@heroicons/react/24/outline';
import { api } from '../lib/api-client';
import { xhrUpload, UploadError } from '../lib/xhr-upload';

type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface OcrJob {
  id: string;
  originalName: string;
  fileType: string;
  fileSizeBytes: number;
  status: JobStatus;
  priority: number;
  retryCount: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface OcrJobDetail extends OcrJob {
  extractedData: {
    ocr: {
      method: string;
      totalConfidence: number;
      processingTimeMs: number;
      pageCount: number;
      pages: Array<{ pageNumber: number; text: string; confidence: number }>;
    };
    financial: {
      revenue: Array<{ label: string; amount: number; raw: string }>;
      expenses: Array<{ label: string; amount: number; raw: string }>;
      dates: string[];
      categories: string[];
      totals: {
        totalRevenue: number | null;
        totalExpenses: number | null;
        netIncome: number | null;
      };
      confidence: number;
    };
    fullTextPreview: string;
  } | null;
}

const ACTIVE_STATUSES: JobStatus[] = ['pending', 'processing'];
const MAX_SIZE = 20 * 1024 * 1024;

// Keep in sync with apps/api/src/routes/ocr/index.ts.
const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'webp', 'tiff', 'tif', 'bmp',
  'xlsx', 'xls', 'ods', 'csv', 'tsv',
]);
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/tiff',
  'image/bmp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/csv',
  'text/tab-separated-values',
  'application/csv',
]);

function isAcceptedFile(f: File): boolean {
  if (f.size > MAX_SIZE || f.size === 0) return false;
  if (ALLOWED_MIME.has(f.type)) return true;
  // Fallback to extension check — folder picks often have missing MIME types.
  const ext = f.name.split('.').pop()?.toLowerCase();
  return !!ext && ALLOWED_EXTENSIONS.has(ext);
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtCurrency(n: number | null): string {
  if (n === null) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function fmtRelative(iso: string): string {
  const delta = (Date.now() - new Date(iso).getTime()) / 1000;
  if (delta < 60) return `${Math.floor(delta)}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

function StatusBadge({ status }: { status: JobStatus }) {
  const styles: Record<JobStatus, string> = {
    pending:    'bg-neutral-100 text-neutral-600',
    processing: 'bg-blue-50 text-blue-700',
    completed:  'bg-success-50 text-success-700',
    failed:     'bg-danger-50 text-danger-700',
  };
  return (
    <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider', styles[status])}>
      {status === 'processing' && <ArrowPathIcon className="w-3 h-3 animate-spin" />}
      {status === 'completed' && <CheckCircleIcon className="w-3 h-3" />}
      {status === 'failed' && <ExclamationCircleIcon className="w-3 h-3" />}
      {status}
    </span>
  );
}

const UPLOAD_CONCURRENCY = 2;

type FileProgressStatus = 'pending' | 'uploading' | 'done' | 'error' | 'skipped' | 'cancelled';

interface FileProgress {
  id: number;           // local unique id — not the server jobId
  name: string;
  size: number;
  status: FileProgressStatus;
  bytesSent: number;    // for the current file
  errorMessage?: string;
}

interface BatchState {
  files: FileProgress[];
  /** Aggregate bytes sent across the whole batch (all accepted files). */
  totalBytes: number;
  /** Total aggregate bytes. */
  bytesSent: number;
}

type StatusFilter = 'all' | 'active' | 'completed' | 'failed';

export function OcrUploadsPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [batch, setBatch] = useState<BatchState | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const abortRef = useRef<AbortController | null>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Polling strategy:
  //   - 3s while any job is pending/processing (tight feedback loop)
  //   - 60s when the page is idle (still catches worker-side state changes)
  //   - paused entirely when the browser tab is hidden
  // The `refetchIntervalInBackground: false` default handles the tab-hidden case.
  const { data: listData, isLoading } = useQuery<{ data: OcrJob[]; total: number }>({
    queryKey: ['ocr-jobs'],
    queryFn: () => api.get('/ocr/jobs?limit=50'),
    refetchInterval: (q) => {
      const list = q.state.data?.data ?? [];
      return list.some((j) => ACTIVE_STATUSES.includes(j.status)) ? 3000 : 60_000;
    },
    refetchIntervalInBackground: false,
  });

  const { data: detailResp } = useQuery<{ data: OcrJobDetail }>({
    queryKey: ['ocr-job', selectedId],
    queryFn: () => api.get(`/ocr/jobs/${selectedId}`),
    enabled: !!selectedId,
    refetchInterval: (q) => {
      const job = q.state.data?.data;
      // Only poll the detail panel while its specific job is active.
      // Static (completed/failed) details don't change, so no polling.
      return job && ACTIVE_STATUSES.includes(job.status) ? 3000 : false;
    },
    refetchIntervalInBackground: false,
  });

  const cancelMutation = useMutation({
    mutationFn: (jobId: string) =>
      api.post<{ success: boolean }>(`/ocr/jobs/${jobId}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ocr-jobs'] });
      if (selectedId) qc.invalidateQueries({ queryKey: ['ocr-job', selectedId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (jobId: string) =>
      api.delete<{ success: boolean }>(`/ocr/jobs/${jobId}`),
    onSuccess: (_data, jobId) => {
      qc.invalidateQueries({ queryKey: ['ocr-jobs'] });
      if (selectedId === jobId) setSelectedId(null);
    },
  });

  const retryMutation = useMutation({
    mutationFn: (jobId: string) =>
      api.post<{ success: boolean }>(`/ocr/jobs/${jobId}/retry`),
    onSuccess: (_data, jobId) => {
      qc.invalidateQueries({ queryKey: ['ocr-jobs'] });
      qc.invalidateQueries({ queryKey: ['ocr-job', jobId] });
    },
  });

  /**
   * Uploads a batch with bounded concurrency (UPLOAD_CONCURRENCY parallel).
   * Tracks bytes sent per file via XHR progress events; the overall progress
   * bar is (sum bytesSent) / (sum totalBytes) across accepted files.
   *
   * Abortable: the user can hit Cancel to abort in-flight uploads and stop
   * the queue. Files already on the server continue processing normally.
   */
  const uploadBatch = useCallback(async (rawFiles: File[]) => {
    setUploadErrors([]);
    if (rawFiles.length === 0) return;

    // Split incoming into accepted + skipped, record skipped reasons.
    const accepted: File[] = [];
    const skipped: string[] = [];
    for (const f of rawFiles) {
      if (isAcceptedFile(f)) {
        accepted.push(f);
      } else {
        const name = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        skipped.push(`${name}: skipped (unsupported type or size)`);
      }
    }

    if (accepted.length === 0) {
      setUploadErrors(['No supported files found.', ...skipped.slice(0, 20)]);
      return;
    }

    // Init batch state.
    const initial: FileProgress[] = accepted.map((f, i) => ({
      id: i,
      name: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
      size: f.size,
      status: 'pending',
      bytesSent: 0,
    }));
    const totalBytes = accepted.reduce((s, f) => s + f.size, 0);
    setBatch({ files: initial, totalBytes, bytesSent: 0 });

    const controller = new AbortController();
    abortRef.current = controller;

    // Mutation helpers — update one file slice of the batch state.
    const patchFile = (id: number, patch: Partial<FileProgress>) => {
      setBatch((prev) => {
        if (!prev) return prev;
        const files = prev.files.map((f) => (f.id === id ? { ...f, ...patch } : f));
        const bytesSent = files.reduce((s, f) => s + f.bytesSent, 0);
        return { ...prev, files, bytesSent };
      });
    };

    // Worker pool: N promises pulling from a shared index.
    let nextIndex = 0;
    let completedCount = 0;
    const errs: string[] = [];

    const worker = async () => {
      while (true) {
        if (controller.signal.aborted) return;
        const i = nextIndex++;
        if (i >= accepted.length) return;

        const file = accepted[i]!;
        const id = initial[i]!.id;
        patchFile(id, { status: 'uploading', bytesSent: 0 });

        const fd = new FormData();
        fd.append('file', file);

        try {
          await xhrUpload<{ data: { jobId: string } }>('/api/v1/ocr/upload', fd, {
            signal: controller.signal,
            onProgress: (p) => {
              // When lengthComputable is false, loaded == 1 (our sentinel for 100%).
              const sent = p.total > 0 ? p.loaded : file.size;
              patchFile(id, { bytesSent: Math.min(sent, file.size) });
            },
          });
          patchFile(id, { status: 'done', bytesSent: file.size });
        } catch (e) {
          if (e instanceof UploadError && e.code === 'ABORTED') {
            patchFile(id, { status: 'cancelled', bytesSent: 0 });
            return; // stop this worker
          }
          if (e instanceof UploadError && e.code === 'DUPLICATE_FILE') {
            // Not an error — the file already exists server-side. Mark as
            // "skipped" so the user sees it didn't re-upload but also
            // doesn't panic.
            patchFile(id, { status: 'skipped', bytesSent: file.size });
            errs.push(`${file.name}: ${e.message}`);
            continue;
          }
          const msg =
            e instanceof UploadError
              ? `[${e.code}] ${e.message}`
              : e instanceof Error
                ? e.message
                : 'Upload failed';
          errs.push(`${file.name}: ${msg}`);
          patchFile(id, { status: 'error', errorMessage: msg });
          console.error('ocr upload failed', { file: file.name, error: e });
        }

        completedCount++;
        // Refresh the list every few uploads so jobs appear progressively.
        if (completedCount % 3 === 0) {
          qc.invalidateQueries({ queryKey: ['ocr-jobs'] });
        }
      }
    };

    const pool = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, accepted.length) }, () => worker());
    await Promise.all(pool);

    qc.invalidateQueries({ queryKey: ['ocr-jobs'] });

    if (skipped.length > 0) {
      errs.push(`${skipped.length} file(s) skipped (unsupported type or size).`);
    }
    setUploadErrors(errs);
    abortRef.current = null;

    // Auto-clear the batch card after a short delay if nothing errored.
    // Keep it visible if there were errors or duplicates so the user sees
    // what happened.
    const hardErrors = errs.some((e) => !/duplicate/i.test(e));
    if (!hardErrors && !controller.signal.aborted) {
      setTimeout(
        () =>
          setBatch((b) =>
            b && b.files.every((f) => f.status === 'done' || f.status === 'skipped')
              ? null
              : b,
          ),
        2500,
      );
    }
  }, [qc]);

  const abortBatch = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const onDrop = useCallback((accepted: File[]) => {
    void uploadBatch(accepted);
  }, [uploadBatch]);

  const onFolderPick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // reset so picking the same folder twice still fires
    void uploadBatch(files);
  }, [uploadBatch]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    // No `accept` filter — react-dropzone's accept check drops files with
    // missing MIME types (common when dropping folders). We filter ourselves
    // in `uploadBatch` using extension + MIME.
    maxSize: MAX_SIZE,
    multiple: true,
    useFsAccessApi: false, // required for directory drops to surface all files
  });

  const jobs = listData?.data ?? [];
  const totalJobs = listData?.total ?? jobs.length;
  const detail = detailResp?.data;

  // Attach a stable serial number computed from the full total: oldest upload
  // is #1, newest is #total. The API returns newest-first (DESC by created_at),
  // so the row at index `i` has serial number `total - i`. This keeps the
  // numbering consistent as pagination scrolls backwards.
  const jobsWithSerial = useMemo(
    () => jobs.map((j, i) => ({ job: j, serial: totalJobs - i })),
    [jobs, totalJobs],
  );

  const filteredJobs = useMemo(() => {
    if (statusFilter === 'all') return jobsWithSerial;
    if (statusFilter === 'active') {
      return jobsWithSerial.filter(({ job }) => ACTIVE_STATUSES.includes(job.status));
    }
    return jobsWithSerial.filter(({ job }) => job.status === statusFilter);
  }, [jobsWithSerial, statusFilter]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-neutral-200 bg-white shrink-0 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">OCR Uploads</h1>
            <p className="text-xs text-neutral-500 mt-0.5">
              Upload documents for automated text and data extraction. Processing happens in the background.
            </p>
          </div>
          <div className="hidden md:flex items-center gap-3 text-[11px] text-neutral-500">
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-success-500" />
              API connected
            </span>
          </div>
        </div>

        {/* Dropzone */}
        <div className="px-6 pt-5 shrink-0">
          <div
            {...getRootProps()}
            className={clsx(
              'relative border-2 border-dashed rounded-xl transition-all cursor-pointer',
              isDragActive
                ? 'border-brand-500 bg-brand-50/70 scale-[1.005]'
                : 'border-neutral-300 hover:border-neutral-400 hover:bg-neutral-50/50 bg-white',
            )}
          >
            <input {...getInputProps()} />
            <div className="flex items-center gap-4 px-5 py-5">
              <div className={clsx(
                'flex items-center justify-center w-12 h-12 rounded-lg shrink-0 transition-colors',
                isDragActive ? 'bg-brand-100 text-brand-600' : 'bg-neutral-100 text-neutral-500',
              )}>
                <CloudArrowUpIcon className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-neutral-800">
                  {isDragActive ? 'Drop to upload' : 'Drag files or folders, or click to browse'}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <FormatChip>PDF</FormatChip>
                  <FormatChip>Images</FormatChip>
                  <FormatChip>Spreadsheets</FormatChip>
                  <span className="text-[10px] text-neutral-400 ml-1 self-center">· max 20 MB</span>
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation(); // don't trigger the dropzone
                  folderInputRef.current?.click();
                }}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 bg-white border border-neutral-300 rounded-md hover:bg-neutral-50 hover:border-neutral-400 transition-colors"
              >
                <FolderPlusIcon className="w-3.5 h-3.5" />
                Folder
              </button>
            </div>
            <input
              ref={folderInputRef}
              type="file"
              multiple
              onChange={onFolderPick}
              className="hidden"
              {...({ webkitdirectory: '', directory: '', mozdirectory: '' } as Record<string, string>)}
            />
          </div>

          {batch && <UploadProgressCard batch={batch} onAbort={abortBatch} />}

          {uploadErrors.length > 0 && (
            <div className="mt-3 rounded-md bg-danger-50 border border-danger-200 text-xs text-danger-700 overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-danger-200/60 bg-danger-100/40">
                <span className="font-semibold flex items-center gap-1.5">
                  <ExclamationCircleIcon className="w-3.5 h-3.5" />
                  {uploadErrors.length} error{uploadErrors.length === 1 ? '' : 's'}
                </span>
                <button
                  onClick={() => setUploadErrors([])}
                  className="text-danger-500 hover:text-danger-700 shrink-0 p-0.5 hover:bg-danger-100 rounded transition-colors"
                  aria-label="Dismiss errors"
                >
                  <XMarkIcon className="w-3 h-3" />
                </button>
              </div>
              <div className="px-3 py-2 space-y-0.5 max-h-40 overflow-y-auto">
                {uploadErrors.map((e, i) => <div key={i} className="break-words">{e}</div>)}
              </div>
            </div>
          )}
        </div>

        {/* Jobs list */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-neutral-900">Jobs</h2>
              <span className="text-[10px] text-neutral-400 tabular-nums">
                {filteredJobs.length === jobs.length
                  ? `${jobs.length} total`
                  : `${filteredJobs.length} of ${jobs.length}`}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <FilterChip
                active={statusFilter === 'all'}
                onClick={() => setStatusFilter('all')}
                count={jobs.length}
              >
                All
              </FilterChip>
              <FilterChip
                active={statusFilter === 'active'}
                onClick={() => setStatusFilter('active')}
                count={jobs.filter((j) => ACTIVE_STATUSES.includes(j.status)).length}
                variant="active"
              >
                Active
              </FilterChip>
              <FilterChip
                active={statusFilter === 'completed'}
                onClick={() => setStatusFilter('completed')}
                count={jobs.filter((j) => j.status === 'completed').length}
                variant="success"
              >
                Completed
              </FilterChip>
              <FilterChip
                active={statusFilter === 'failed'}
                onClick={() => setStatusFilter('failed')}
                count={jobs.filter((j) => j.status === 'failed').length}
                variant="danger"
              >
                Failed
              </FilterChip>
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-14 bg-neutral-100 rounded animate-pulse" />
              ))}
            </div>
          ) : jobs.length === 0 ? (
            <div className="py-16 text-center border-2 border-dashed border-neutral-200 rounded-lg">
              <DocumentTextIcon className="w-10 h-10 text-neutral-300 mx-auto mb-2" />
              <p className="text-sm font-medium text-neutral-700">No uploads yet</p>
              <p className="text-xs text-neutral-500 mt-1">Drop a file above to get started.</p>
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="py-12 text-center text-sm text-neutral-500">
              No jobs match this filter.
            </div>
          ) : (
            <div className="bg-white border border-neutral-200 rounded-lg divide-y divide-neutral-100 overflow-hidden">
              {filteredJobs.map(({ job, serial }) => (
                <div
                  key={job.id}
                  className={clsx(
                    'flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 transition-colors',
                    selectedId === job.id && 'bg-brand-50/60 hover:bg-brand-50/60',
                  )}
                >
                  {/* Serial number — oldest upload = #1, newest = #total. */}
                  <span className="shrink-0 w-8 text-right text-[11px] font-medium text-neutral-400 tabular-nums">
                    {serial}
                  </span>
                  <button
                    onClick={() => setSelectedId(job.id)}
                    className="flex-1 flex items-center gap-3 min-w-0 text-left"
                  >
                    <FileIcon filename={job.originalName} status={job.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-neutral-800 truncate font-medium">{job.originalName}</p>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <StatusBadge status={job.status} />
                        <span className="text-[10px] text-neutral-400 tabular-nums">
                          {fmtSize(job.fileSizeBytes)}
                        </span>
                        <span className="text-[10px] text-neutral-300">·</span>
                        <span className="text-[10px] text-neutral-400">
                          {fmtRelative(job.createdAt)}
                        </span>
                        {job.retryCount > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning-50 text-warning-700 font-medium">
                            retry {job.retryCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                  <div className="shrink-0 flex items-center gap-1">
                    {job.status === 'pending' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          cancelMutation.mutate(job.id);
                        }}
                        disabled={cancelMutation.isPending}
                        title="Cancel job"
                        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-danger-700 hover:bg-danger-50 rounded transition-colors disabled:opacity-50"
                      >
                        <NoSymbolIcon className="w-3 h-3" />
                        Cancel
                      </button>
                    )}
                    {job.status === 'failed' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          retryMutation.mutate(job.id);
                        }}
                        disabled={retryMutation.isPending}
                        title="Retry OCR on this file"
                        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-brand-700 hover:bg-brand-50 rounded transition-colors disabled:opacity-50"
                      >
                        <ArrowUturnLeftIcon className="w-3 h-3" />
                        Retry
                      </button>
                    )}
                    {(job.status === 'completed' || job.status === 'failed') && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete "${job.originalName}"? This removes the file and job record.`)) {
                            deleteMutation.mutate(job.id);
                          }
                        }}
                        disabled={deleteMutation.isPending}
                        title="Delete job and file"
                        className="p-1.5 text-neutral-400 hover:text-danger-600 hover:bg-danger-50 rounded transition-colors disabled:opacity-50"
                      >
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selectedId && (
        <div className="w-[420px] shrink-0 border-l border-neutral-200 bg-white overflow-y-auto">
          <div className="p-5">
            <div className="flex items-start justify-between mb-4">
              <div className="min-w-0 flex-1 pr-2">
                <h3 className="text-sm font-semibold text-neutral-900 break-words">
                  {detail?.originalName ?? '…'}
                </h3>
                {detail && (
                  <div className="mt-1 flex items-center gap-2 flex-wrap">
                    <StatusBadge status={detail.status} />
                    {detail.status === 'pending' && (
                      <button
                        onClick={() => cancelMutation.mutate(detail.id)}
                        disabled={cancelMutation.isPending}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-danger-700 hover:bg-danger-50 rounded transition-colors disabled:opacity-50"
                      >
                        <NoSymbolIcon className="w-3 h-3" />
                        Cancel
                      </button>
                    )}
                    {detail.status === 'failed' && (
                      <button
                        onClick={() => retryMutation.mutate(detail.id)}
                        disabled={retryMutation.isPending}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-700 hover:bg-brand-50 rounded transition-colors disabled:opacity-50"
                      >
                        <ArrowUturnLeftIcon className="w-3 h-3" />
                        Retry
                      </button>
                    )}
                    {(detail.status === 'completed' || detail.status === 'failed') && (
                      <button
                        onClick={() => {
                          if (confirm(`Delete "${detail.originalName}"? This removes the file and job record.`)) {
                            deleteMutation.mutate(detail.id);
                          }
                        }}
                        disabled={deleteMutation.isPending}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-600 hover:bg-danger-50 hover:text-danger-700 rounded transition-colors disabled:opacity-50"
                      >
                        <TrashIcon className="w-3 h-3" />
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={() => setSelectedId(null)}
                className="text-neutral-400 hover:text-neutral-600 shrink-0"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>

            {detail && (
              <>
                <dl className="space-y-1.5 text-xs mb-4">
                  <Row label="Size" value={fmtSize(detail.fileSizeBytes)} />
                  <Row label="Type" value={detail.fileType} />
                  <Row label="Uploaded" value={fmtRelative(detail.createdAt)} />
                  {detail.completedAt && (
                    <Row label="Completed" value={fmtRelative(detail.completedAt)} />
                  )}
                </dl>

                {detail.status === 'failed' && detail.errorMessage && (
                  <div className="p-2 bg-danger-50 rounded text-xs text-danger-700 mb-4">
                    {detail.errorMessage}
                  </div>
                )}

                {detail.extractedData && (
                  <>
                    <Section title="OCR">
                      <Row label="Method" value={detail.extractedData.ocr.method} />
                      <Row label="Pages" value={String(detail.extractedData.ocr.pageCount)} />
                      <Row label="Confidence" value={`${detail.extractedData.ocr.totalConfidence.toFixed(1)}%`} />
                      <Row label="Duration" value={`${detail.extractedData.ocr.processingTimeMs} ms`} />
                    </Section>

                    {(detail.extractedData.financial.totals.totalRevenue !== null ||
                      detail.extractedData.financial.totals.totalExpenses !== null ||
                      detail.extractedData.financial.totals.netIncome !== null) && (
                      <Section title="Totals">
                        {detail.extractedData.financial.totals.totalRevenue !== null && (
                          <Row label="Total revenue" value={fmtCurrency(detail.extractedData.financial.totals.totalRevenue)} />
                        )}
                        {detail.extractedData.financial.totals.totalExpenses !== null && (
                          <Row label="Total expenses" value={fmtCurrency(detail.extractedData.financial.totals.totalExpenses)} />
                        )}
                        {detail.extractedData.financial.totals.netIncome !== null && (
                          <Row label="Net income" value={fmtCurrency(detail.extractedData.financial.totals.netIncome)} />
                        )}
                      </Section>
                    )}

                    {detail.extractedData.financial.revenue.length > 0 && (
                      <Section title="Revenue lines">
                        {detail.extractedData.financial.revenue.slice(0, 8).map((l, i) => (
                          <div key={i} className="flex justify-between text-xs py-0.5">
                            <span className="text-neutral-600 truncate pr-2">{l.label}</span>
                            <span className="text-neutral-800 tabular-nums">{fmtCurrency(l.amount)}</span>
                          </div>
                        ))}
                      </Section>
                    )}

                    {detail.extractedData.financial.expenses.length > 0 && (
                      <Section title="Expense lines">
                        {detail.extractedData.financial.expenses.slice(0, 8).map((l, i) => (
                          <div key={i} className="flex justify-between text-xs py-0.5">
                            <span className="text-neutral-600 truncate pr-2">{l.label}</span>
                            <span className="text-neutral-800 tabular-nums">{fmtCurrency(l.amount)}</span>
                          </div>
                        ))}
                      </Section>
                    )}

                    {detail.extractedData.financial.dates.length > 0 && (
                      <Section title="Dates found">
                        <div className="flex flex-wrap gap-1">
                          {detail.extractedData.financial.dates.slice(0, 10).map((d, i) => (
                            <span key={i} className="text-[10px] px-1.5 py-0.5 bg-neutral-100 rounded text-neutral-700">
                              {d}
                            </span>
                          ))}
                        </div>
                      </Section>
                    )}

                    {detail.extractedData.fullTextPreview && (
                      <Section title="Text preview">
                        <pre className="text-[10px] text-neutral-600 bg-neutral-50 rounded p-2 max-h-60 overflow-auto whitespace-pre-wrap font-mono">
                          {detail.extractedData.fullTextPreview.slice(0, 1200)}
                          {detail.extractedData.fullTextPreview.length > 1200 && '\n…'}
                        </pre>
                      </Section>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-[10px] font-medium text-neutral-400 uppercase tracking-wider shrink-0">{label}</dt>
      <dd className="text-xs text-neutral-700 text-right">{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-2">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

/**
 * Shows a two-level progress view for an in-flight upload batch:
 *   1. Aggregate bar (bytes-weighted) + overall counter
 *   2. Per-file mini-bars — capped at 6 visible rows to keep the card compact
 */
function UploadProgressCard({
  batch,
  onAbort,
}: {
  batch: BatchState;
  onAbort: () => void;
}) {
  const total = batch.files.length;
  const done = batch.files.filter((f) => f.status === 'done').length;
  const failed = batch.files.filter((f) => f.status === 'error').length;
  const cancelled = batch.files.filter((f) => f.status === 'cancelled').length;
  const skipped = batch.files.filter((f) => f.status === 'skipped').length;
  const finished = done + failed + cancelled + skipped;
  const inflight = batch.files.filter((f) => f.status === 'uploading');

  const aggFraction = batch.totalBytes > 0
    ? Math.min(1, batch.bytesSent / batch.totalBytes)
    : finished / total;
  const aggPct = Math.round(aggFraction * 100);
  const allDone = finished === total;

  // Show in-flight first, then the most recent N finished. Keeps the list
  // bounded so 500-file folder uploads don't tank the DOM.
  const visibleFiles = [
    ...inflight,
    ...batch.files.filter((f) => f.status !== 'uploading' && f.status !== 'pending').slice(-4),
  ].slice(0, 6);

  return (
    <div className="mt-3 bg-white border border-neutral-200 rounded-lg overflow-hidden shadow-sm">
      <div className="px-4 pt-3 pb-2.5">
        <div className="flex items-center justify-between mb-2.5 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {allDone ? (
              <CheckCircleIcon className="w-4 h-4 text-success-600 shrink-0" />
            ) : (
              <ArrowPathIcon className="w-4 h-4 text-brand-600 animate-spin shrink-0" />
            )}
            <span className="text-sm font-semibold text-neutral-900">
              {allDone ? 'Upload complete' : 'Uploading files'}
            </span>
            <span className="text-[11px] text-neutral-500 tabular-nums">
              {finished}/{total}
              {failed > 0 && <span className="text-danger-600 font-medium"> · {failed} failed</span>}
              {skipped > 0 && <span className="text-warning-700"> · {skipped} duplicate</span>}
              {cancelled > 0 && <span className="text-neutral-500"> · {cancelled} cancelled</span>}
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-sm font-semibold text-neutral-800 tabular-nums">{aggPct}%</span>
            {!allDone && (
              <button
                onClick={onAbort}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-danger-700 hover:bg-danger-50 rounded transition-colors"
                title="Cancel remaining uploads"
              >
                <StopCircleIcon className="w-3.5 h-3.5" />
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* Aggregate bar */}
        <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
          <div
            className={clsx(
              'h-full rounded-full transition-[width] duration-200',
              allDone && failed === 0 ? 'bg-success-500' : failed > 0 ? 'bg-warning-500' : 'bg-brand-500',
            )}
            style={{ width: `${aggPct}%` }}
          />
        </div>
      </div>

      {/* Per-file rows */}
      {visibleFiles.length > 0 && (
        <div className="border-t border-neutral-100 bg-neutral-50/40 px-4 py-2.5 space-y-1.5">
          {visibleFiles.map((f) => {
            const frac = f.size > 0 ? f.bytesSent / f.size : f.status === 'done' ? 1 : 0;
            const pct = Math.round(Math.min(1, frac) * 100);
            return (
              <div key={f.id} className="flex items-center gap-2.5 text-[11px]">
                <FileTypeGlyph filename={f.name} />
                <span className="flex-1 min-w-0 truncate text-neutral-700" title={f.name}>
                  {f.name}
                </span>
                <div className="w-24 h-1.5 bg-neutral-200 rounded-full overflow-hidden shrink-0">
                  <div
                    className={clsx(
                      'h-full rounded-full transition-[width] duration-150',
                      f.status === 'done' && 'bg-success-500',
                      f.status === 'error' && 'bg-danger-500',
                      f.status === 'cancelled' && 'bg-neutral-400',
                      f.status === 'skipped' && 'bg-warning-400',
                      f.status === 'uploading' && 'bg-brand-500',
                      f.status === 'pending' && 'bg-transparent',
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span
                  className={clsx(
                    'shrink-0 w-20 text-right tabular-nums text-[10px] font-medium',
                    f.status === 'done' && 'text-success-600',
                    f.status === 'error' && 'text-danger-600',
                    f.status === 'cancelled' && 'text-neutral-500',
                    f.status === 'skipped' && 'text-warning-700',
                    f.status === 'uploading' && 'text-brand-600',
                    f.status === 'pending' && 'text-neutral-400',
                  )}
                >
                  {f.status === 'done' && 'Done'}
                  {f.status === 'error' && 'Failed'}
                  {f.status === 'cancelled' && 'Cancelled'}
                  {f.status === 'skipped' && 'Duplicate'}
                  {f.status === 'uploading' && `${pct}%`}
                  {f.status === 'pending' && 'Queued'}
                </span>
              </div>
            );
          })}
          {batch.files.length > visibleFiles.length && (
            <p className="text-[10px] text-neutral-400 pt-1 pl-6">
              + {batch.files.length - visibleFiles.length} more queued
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Small icon derived from filename extension — used in job rows + progress rows. */
function FileTypeGlyph({ filename }: { filename: string }) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (['pdf'].includes(ext)) {
    return <DocumentTextIcon className="w-3.5 h-3.5 text-red-400 shrink-0" />;
  }
  if (['xlsx', 'xls', 'ods', 'csv', 'tsv'].includes(ext)) {
    return <TableCellsIcon className="w-3.5 h-3.5 text-green-500 shrink-0" />;
  }
  if (['png', 'jpg', 'jpeg', 'webp', 'tiff', 'tif', 'bmp'].includes(ext)) {
    return <PhotoIcon className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
  }
  return <DocumentTextIcon className="w-3.5 h-3.5 text-neutral-400 shrink-0" />;
}

/** Job-row icon — slightly larger, reflects status color at rest. */
function FileIcon({ filename, status }: { filename: string; status: JobStatus }) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const tint = clsx(
    'w-5 h-5 shrink-0',
    status === 'failed' && 'text-danger-400',
    status === 'completed' && (
      ['xlsx', 'xls', 'ods', 'csv', 'tsv'].includes(ext) ? 'text-green-500' :
      ['png', 'jpg', 'jpeg', 'webp', 'tiff', 'tif', 'bmp'].includes(ext) ? 'text-blue-500' :
      'text-red-400'
    ),
    (status === 'pending' || status === 'processing') && 'text-neutral-400',
  );
  if (['xlsx', 'xls', 'ods', 'csv', 'tsv'].includes(ext)) return <TableCellsIcon className={tint} />;
  if (['png', 'jpg', 'jpeg', 'webp', 'tiff', 'tif', 'bmp'].includes(ext)) return <PhotoIcon className={tint} />;
  return <DocumentTextIcon className={tint} />;
}

function FormatChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600 text-[10px] font-medium">
      {children}
    </span>
  );
}

function FilterChip({
  active,
  count,
  onClick,
  children,
  variant = 'neutral',
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
  variant?: 'neutral' | 'active' | 'success' | 'danger';
}) {
  const activeStyles: Record<typeof variant, string> = {
    neutral: 'bg-neutral-900 text-white',
    active:  'bg-blue-600 text-white',
    success: 'bg-success-600 text-white',
    danger:  'bg-danger-600 text-white',
  };
  return (
    <button
      onClick={onClick}
      className={clsx(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors',
        active
          ? activeStyles[variant]
          : 'bg-white border border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:text-neutral-800',
      )}
    >
      <span>{children}</span>
      <span className={clsx(
        'tabular-nums text-[10px] px-1 rounded',
        active ? 'bg-white/20' : 'bg-neutral-100 text-neutral-500',
      )}>
        {count}
      </span>
    </button>
  );
}
