/**
 * OCR uploads dashboard — drop files, poll job status, inspect extracted data.
 * Independent from DocumentsPage (which reads pre-scanned OneDrive output).
 */

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
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
  ArrowDownTrayIcon,
  ClockIcon,
  CpuChipIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FunnelIcon,
  EyeIcon,
} from '@heroicons/react/24/outline';
import { api } from '../lib/api-client';
import { useUploadStore } from '../store/upload.store';
import { UploadProgressCard as SharedUploadProgressCard } from '../components/upload/UploadProgressCard';
import { SinglePdfViewer } from '../components/common/SinglePdfViewer';

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
  // Classification fields — populated at upload (filename) and refined by
  // the OCR worker (extracted text). May be null until migration 014 runs
  // or for files the classifier couldn't identify.
  property: string | null;
  dateFolder: string | null;
  reportType: string | null;
  reportCategory: string | null;
}

interface OcrFacets {
  properties: string[];
  dates: string[];
  reportTypes: string[];
  categories: string[];
}

type SortField = 'originalName' | 'reportType' | 'reportCategory' | 'property' | 'fileSizeBytes' | 'createdAt';
type SortDir = 'asc' | 'desc';

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

type StatusFilter = 'all' | 'active' | 'completed' | 'failed';
type ViewMode = 'list' | 'compact';

const JOBS_PER_PAGE = 20;

function buildPageRange(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | '…')[] = [1];
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);
  if (left > 2) pages.push('…');
  for (let i = left; i <= right; i++) pages.push(i);
  if (right < total - 1) pages.push('…');
  pages.push(total);
  return pages;
}

function exportJobsCsv(jobs: OcrJob[]) {
  const header = 'Name,Status,Type,Size (bytes),Created,Completed\n';
  const rows = jobs.map((j) =>
    `"${j.originalName}","${j.status}","${j.fileType}",${j.fileSizeBytes},"${j.createdAt}","${j.completedAt ?? ''}"`,
  ).join('\n');
  const blob = new Blob([header + rows], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ocr-jobs-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function OcrUploadsPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [fileTypeFilter, setFileTypeFilter] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [reportTypeFilter, setReportTypeFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [page, setPage] = useState(1);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [previewJob, setPreviewJob] = useState<{ id: string; name: string; url: string } | null>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Shrink the sticky jobs header once the user scrolls past the dropzone.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setIsScrolled(el.scrollTop > 80);
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Live API connectivity check — lights up the status dot in the page header.
  const { data: apiHealth, isError: apiHealthError } = useQuery<{ status: string }>({
    queryKey: ['api-health'],
    queryFn: () => api.get<{ status: string }>('/health'),
    refetchInterval: 15_000,
    retry: 1,
    staleTime: 10_000,
  });
  const apiConnected = !apiHealthError && apiHealth?.status === 'ok';

  // Upload state lives in a global store so progress survives navigation.
  const batch = useUploadStore((s) => s.batch);
  const uploadErrors = useUploadStore((s) => s.errors);
  const startBatchInStore = useUploadStore((s) => s.startBatch);
  const abortBatch = useUploadStore((s) => s.abortBatch);
  const setUploadErrors = useUploadStore((s) => s.setErrors);

  // Build query params for the API
  const queryParams = (() => {
    const params = new URLSearchParams({ limit: String(JOBS_PER_PAGE), page: String(page) });
    if (statusFilter !== 'all' && statusFilter !== 'active') params.set('status', statusFilter);
    if (statusFilter === 'active') params.set('status', 'pending'); // active = pending + processing
    if (propertyFilter)   params.set('property', propertyFilter);
    if (dateFilter)       params.set('dateFolder', dateFilter);
    if (reportTypeFilter) params.set('reportType', reportTypeFilter);
    if (categoryFilter)   params.set('category', categoryFilter);
    if (searchQuery.trim()) params.set('search', searchQuery.trim());
    return params.toString();
  })();

  const { data: listData, isLoading } = useQuery<{ data: OcrJob[]; total: number; totalPages: number }>({
    queryKey: ['ocr-jobs', page, statusFilter, propertyFilter, dateFilter, reportTypeFilter, categoryFilter, searchQuery],
    queryFn: () => api.get(`/ocr/jobs?${queryParams}`),
    refetchInterval: (q) => {
      const list = q.state.data?.data ?? [];
      return list.some((j) => ACTIVE_STATUSES.includes(j.status)) ? 3000 : 30_000;
    },
    refetchIntervalInBackground: false,
  });

  // Facets — populated dropdown options across the WHOLE dataset (not just
  // the current page). Refetched alongside the list so newly classified
  // jobs appear in the dropdowns within ~30s.
  const { data: facetsResp } = useQuery<{ data: OcrFacets }>({
    queryKey: ['ocr-jobs-facets'],
    queryFn: () => api.get('/ocr/jobs/facets'),
    staleTime: 30_000,
  });
  const facets: OcrFacets = facetsResp?.data ?? { properties: [], dates: [], reportTypes: [], categories: [] };

  const hasAnyFilter = !!(propertyFilter || dateFilter || reportTypeFilter || categoryFilter || searchQuery || fileTypeFilter || statusFilter !== 'all');

  const clearAllFilters = () => {
    setPropertyFilter('');
    setDateFilter('');
    setReportTypeFilter('');
    setCategoryFilter('');
    setFileTypeFilter('');
    setSearchQuery('');
    setStatusFilter('all');
    setPage(1);
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

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

  const openPreview = useCallback((job: OcrJob) => {
    // Same-origin proxy — instant, no network round-trip to fetch a signed URL.
    setPreviewJob({
      id: job.id,
      name: job.originalName,
      url: `/api/v1/ocr/jobs/${job.id}/file`,
    });
  }, []);

  // Upload entry point — delegates to the global store so progress survives
  // navigation. The store handles concurrency, abort, and auto-clear.
  const uploadBatch = useCallback(
    (rawFiles: File[]) =>
      startBatchInStore(rawFiles, isAcceptedFile, () =>
        qc.invalidateQueries({ queryKey: ['ocr-jobs'] }),
      ),
    [qc, startBatchInStore],
  );

  // Stage files for preview instead of uploading immediately.
  const stageFiles = useCallback((files: File[]) => {
    const accepted = files.filter(isAcceptedFile);
    const skipped = files.filter((f) => !isAcceptedFile(f));
    if (skipped.length > 0) {
      setUploadErrors(skipped.slice(0, 10).map((f) => `${f.name}: skipped (unsupported type or size)`));
    }
    if (accepted.length > 0) {
      setStagedFiles((prev) => [...prev, ...accepted]);
    }
  }, []);

  const removeStagedFile = useCallback((index: number) => {
    setStagedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearStagedFiles = useCallback(() => {
    setStagedFiles([]);
    setUploadErrors([]);
  }, []);

  const uploadAllStaged = useCallback(() => {
    if (stagedFiles.length === 0) return;
    const files = [...stagedFiles];
    setStagedFiles([]);
    setUploadErrors([]);
    setPage(1); // go to page 1 to see new uploads
    void uploadBatch(files);
  }, [stagedFiles, uploadBatch]);

  const onDrop = useCallback((accepted: File[]) => {
    stageFiles(accepted);
  }, [stageFiles]);

  const onFolderPick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    stageFiles(files);
  }, [stageFiles]);

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

  // Serial number: oldest upload = #1, newest = #total.
  // Account for pagination offset: page 1 row 0 = total, page 2 row 0 = total - pageSize, etc.
  const pageOffset = (page - 1) * JOBS_PER_PAGE;
  const jobsWithSerial = useMemo(
    () => jobs.map((j, i) => ({ job: j, serial: totalJobs - pageOffset - i })),
    [jobs, totalJobs, pageOffset],
  );

  // Stats come from the server-wide /storage-stats endpoint, not the current
  // page. Otherwise "Completed: 20" would just count the visible page slice
  // while total said 294, which looked broken.
  const statsQuery = useQuery<{
    success: boolean;
    data: {
      dbJobs: number;
      dbBytes: number;
      statusCounts: Record<string, number>;
    };
  }>({
    queryKey: ['ocr-storage-stats'],
    queryFn: () => api.get('/ocr/jobs/storage-stats'),
    staleTime: 15_000,
  });

  const stats = useMemo(() => {
    const s = statsQuery.data?.data;
    if (!s) {
      return { total: 0, completed: 0, failed: 0, processing: 0, pending: 0, totalSize: 0 };
    }
    return {
      total: s.dbJobs,
      completed: s.statusCounts['completed'] ?? 0,
      failed: s.statusCounts['failed'] ?? 0,
      processing: s.statusCounts['processing'] ?? 0,
      pending: s.statusCounts['pending'] ?? 0,
      totalSize: s.dbBytes,
    };
  }, [statsQuery.data]);

  // Unique file types for the filter
  const fileTypes = useMemo(() => {
    const types = new Set(jobs.map((j) => {
      const ext = j.originalName.split('.').pop()?.toLowerCase() ?? '';
      return ext;
    }));
    return [...types].sort();
  }, [jobs]);

  // Server-side filters (search, status, property, date, reportType, category)
  // are already applied by the API. We layer client-side file-type filtering
  // and sorting on top, since file type isn't a server filter and sorting
  // operates only on the visible page anyway.
  const filteredJobs = useMemo(() => {
    let items = jobsWithSerial;
    if (fileTypeFilter) {
      items = items.filter(({ job }) => job.originalName.toLowerCase().endsWith(`.${fileTypeFilter}`));
    }
    if (sortField !== 'createdAt' || sortDir !== 'desc') {
      // Default order from the API is createdAt desc; only re-sort if the
      // user picked something else.
      const dir = sortDir === 'asc' ? 1 : -1;
      items = [...items].sort((a, b) => {
        const av = a.job[sortField] ?? '';
        const bv = b.job[sortField] ?? '';
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
        return String(av).localeCompare(String(bv)) * dir;
      });
    }
    return items;
  }, [jobsWithSerial, fileTypeFilter, sortField, sortDir]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Collapsed rail — visible only when sidebar is closed */}
      {!filtersOpen && (
        <div className="w-9 shrink-0 border-r border-neutral-200 bg-white hidden lg:flex flex-col items-center pt-3">
          <button
            onClick={() => setFiltersOpen(true)}
            className="p-1.5 rounded hover:bg-neutral-100 text-neutral-500 hover:text-neutral-700 transition-colors"
            title="Show filters"
          >
            <FunnelIcon className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Left sidebar — filters */}
      <div className={clsx(
        'w-52 shrink-0 border-r border-neutral-200 bg-white overflow-y-auto',
        filtersOpen ? 'hidden lg:block' : 'hidden',
      )}>
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Filters</h2>
            <button
              onClick={() => setFiltersOpen(false)}
              className="p-0.5 rounded hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors"
              title="Hide filters"
            >
              <ChevronLeftIcon className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* File type filter */}
          <div className="mb-3">
            <label className="text-[10px] font-semibold text-neutral-500 uppercase tracking-widest mb-1.5 block">File Type</label>
            <select
              value={fileTypeFilter}
              onChange={(e) => setFileTypeFilter(e.target.value)}
              className="w-full px-2 py-1.5 text-xs border border-neutral-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            >
              <option value="">All types ({fileTypes.length})</option>
              {fileTypes.map((t) => (
                <option key={t} value={t}>.{t}</option>
              ))}
            </select>
          </div>

          {/* Date filter */}
          <div className="mb-3">
            <label className="text-[10px] font-semibold text-neutral-500 uppercase tracking-widest mb-1.5 block">Date</label>
            <select
              value={dateFilter}
              onChange={(e) => { setDateFilter(e.target.value); setPage(1); }}
              className="w-full px-2 py-1.5 text-xs border border-neutral-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            >
              <option value="">All dates ({facets.dates.length})</option>
              {facets.dates.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          {/* Property filter */}
          <div className="mb-3">
            <label className="text-[10px] font-semibold text-neutral-500 uppercase tracking-widest mb-1.5 block">Property</label>
            <select
              value={propertyFilter}
              onChange={(e) => { setPropertyFilter(e.target.value); setPage(1); }}
              className="w-full px-2 py-1.5 text-xs border border-neutral-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            >
              <option value="">All properties ({facets.properties.length})</option>
              {facets.properties.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          {/* Category filter */}
          <div className="mb-3">
            <label className="text-[10px] font-semibold text-neutral-500 uppercase tracking-widest mb-1.5 block">Category</label>
            <select
              value={categoryFilter}
              onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
              className="w-full px-2 py-1.5 text-xs border border-neutral-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            >
              <option value="">All categories ({facets.categories.length})</option>
              {facets.categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Report Type filter */}
          <div className="mb-4">
            <label className="text-[10px] font-semibold text-neutral-500 uppercase tracking-widest mb-1.5 block">Report Type</label>
            <select
              value={reportTypeFilter}
              onChange={(e) => { setReportTypeFilter(e.target.value); setPage(1); }}
              className="w-full px-2 py-1.5 text-xs border border-neutral-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            >
              <option value="">All types ({facets.reportTypes.length})</option>
              {facets.reportTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Stats */}
          <div className="mb-4">
            <label className="text-[10px] font-semibold text-neutral-500 uppercase tracking-widest mb-2 block">Overview</label>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-2 py-1.5 bg-neutral-50 rounded">
                <span className="text-xs text-neutral-600">Total Jobs</span>
                <span className="text-xs font-semibold text-neutral-900 tabular-nums">{stats.total}</span>
              </div>
              <div className="flex items-center justify-between px-2 py-1.5 bg-success-50 rounded">
                <span className="text-xs text-success-700">Completed</span>
                <span className="text-xs font-semibold text-success-800 tabular-nums">{stats.completed}</span>
              </div>
              <div className="flex items-center justify-between px-2 py-1.5 bg-blue-50 rounded">
                <span className="text-xs text-blue-700">Processing</span>
                <span className="text-xs font-semibold text-blue-800 tabular-nums">{stats.processing}</span>
              </div>
              <div className="flex items-center justify-between px-2 py-1.5 bg-neutral-50 rounded">
                <span className="text-xs text-neutral-600">Pending</span>
                <span className="text-xs font-semibold text-neutral-800 tabular-nums">{stats.pending}</span>
              </div>
              {stats.failed > 0 && (
                <div className="flex items-center justify-between px-2 py-1.5 bg-danger-50 rounded">
                  <span className="text-xs text-danger-700">Failed</span>
                  <span className="text-xs font-semibold text-danger-800 tabular-nums">{stats.failed}</span>
                </div>
              )}
              <div className="flex items-center justify-between px-2 py-1.5 bg-neutral-50 rounded mt-2">
                <span className="text-xs text-neutral-500">Total Size</span>
                <span className="text-xs font-medium text-neutral-700 tabular-nums">{fmtSize(stats.totalSize)}</span>
              </div>
            </div>
          </div>

          {/* Export */}
          <button
            onClick={() => exportJobsCsv(jobs)}
            disabled={jobs.length === 0}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-neutral-700 bg-white border border-neutral-200 rounded-md hover:bg-neutral-50 disabled:opacity-40 transition-colors"
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" />
            Export CSV
          </button>

          {hasAnyFilter && (
            <button
              onClick={clearAllFilters}
              className="w-full flex items-center justify-center gap-1 px-2 py-1.5 mt-2 text-[10px] font-medium text-danger-600 bg-danger-50 rounded hover:bg-danger-100 transition-colors"
            >
              <XMarkIcon className="w-3 h-3" />
              Clear all filters
            </button>
          )}
        </div>
      </div>

      {/* Main panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-neutral-200 bg-white shrink-0 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">OCR Uploads</h1>
            <p className="text-xs text-neutral-500 mt-0.5">
              Upload documents for automated text and data extraction. Processing happens in the background.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* View toggle */}
            <div className="hidden md:flex rounded-md border border-neutral-200 overflow-hidden">
              <button
                onClick={() => setViewMode('list')}
                className={clsx(
                  'flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium transition-colors',
                  viewMode === 'list' ? 'bg-brand-50 text-brand-700' : 'bg-white text-neutral-500 hover:bg-neutral-50',
                )}
              >
                <DocumentTextIcon className="w-3.5 h-3.5" />
                List
              </button>
              <button
                onClick={() => setViewMode('compact')}
                className={clsx(
                  'flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium transition-colors border-l border-neutral-200',
                  viewMode === 'compact' ? 'bg-brand-50 text-brand-700' : 'bg-white text-neutral-500 hover:bg-neutral-50',
                )}
              >
                <TableCellsIcon className="w-3.5 h-3.5" />
                Compact
              </button>
            </div>
            <span
              className={clsx(
                'hidden md:inline-flex items-center gap-1.5 text-[11px]',
                apiConnected ? 'text-neutral-500' : 'text-danger-600',
              )}
              title={apiConnected ? 'API health check passing' : 'API health check failed — requests may not succeed'}
            >
              <span
                className={clsx(
                  'w-1.5 h-1.5 rounded-full',
                  apiConnected ? 'bg-success-500' : 'bg-danger-500 animate-pulse',
                )}
              />
              {apiConnected ? 'API connected' : 'API offline'}
            </span>
          </div>
        </div>

        {/* Stats strip — mobile (hidden on lg where sidebar shows) */}
        <div className="lg:hidden px-6 py-3 border-b border-neutral-100 bg-neutral-50 flex items-center gap-4 overflow-x-auto shrink-0">
          <StatPill icon={<DocumentTextIcon className="w-3.5 h-3.5" />} label="Total" value={stats.total} />
          <StatPill icon={<CheckCircleIcon className="w-3.5 h-3.5 text-success-600" />} label="Done" value={stats.completed} />
          <StatPill icon={<CpuChipIcon className="w-3.5 h-3.5 text-blue-600" />} label="Processing" value={stats.processing} />
          <StatPill icon={<ClockIcon className="w-3.5 h-3.5 text-neutral-500" />} label="Pending" value={stats.pending} />
          {stats.failed > 0 && <StatPill icon={<ExclamationCircleIcon className="w-3.5 h-3.5 text-danger-600" />} label="Failed" value={stats.failed} />}
        </div>

        {/* Scrollable content — dropzone, upload cards, and jobs list share one scroll */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {/* Dropzone */}
        <div className="px-6 pt-5">
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
            {/* Separate hidden input for folder picking — webkitdirectory
                makes the browser open a folder-select dialog instead of file-select. */}
            <input
              ref={folderInputRef}
              type="file"
              multiple
              onChange={onFolderPick}
              className="hidden"
              // @ts-expect-error — webkitdirectory is non-standard but supported in all major browsers
              webkitdirectory="true"
              directory="true"
            />
          </div>

          {/* Staged files preview — shows files before upload */}
          {stagedFiles.length > 0 && !batch && (
            <div className="mt-3 bg-white border border-neutral-200 rounded-lg overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between">
                <span className="text-base font-semibold text-neutral-900">
                  {stagedFiles.length} file{stagedFiles.length === 1 ? '' : 's'} selected
                  <span className="ml-2 text-sm text-neutral-400 font-normal">
                    {fmtSize(stagedFiles.reduce((s, f) => s + f.size, 0))} total
                  </span>
                </span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={clearStagedFiles}
                    className="px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 rounded-md border border-neutral-300 transition-colors"
                  >
                    Clear All
                  </button>
                  <button
                    onClick={uploadAllStaged}
                    className="px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors shadow-sm"
                  >
                    Upload All
                  </button>
                </div>
              </div>
              <div className="max-h-52 overflow-y-auto divide-y divide-neutral-50">
                {stagedFiles.map((f, i) => (
                  <div key={`${f.name}-${i}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-50">
                    <FileIcon filename={f.name} status="pending" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-neutral-800 truncate font-medium">{(f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name}</p>
                      <span className="text-xs text-neutral-400">{fmtSize(f.size)}</span>
                    </div>
                    <button
                      onClick={() => removeStagedFile(i)}
                      className="p-1.5 text-neutral-400 hover:text-danger-600 hover:bg-danger-50 rounded transition-colors"
                      title="Remove file"
                    >
                      <XMarkIcon className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {batch && <SharedUploadProgressCard batch={batch} onAbort={abortBatch} className="mt-3" />}

          {uploadErrors.length > 0 && (() => {
            const isDup = (e: string) => /duplicate|already uploaded/i.test(e);
            const duplicates = uploadErrors.filter(isDup);
            const hardErrors = uploadErrors.filter((e) => !isDup(e));
            const duplicateNames = duplicates.map((e) => {
              const idx = e.indexOf(':');
              return idx > -1 ? e.slice(0, idx) : e;
            });
            return (
              <div className="mt-3 space-y-2">
                {duplicates.length > 0 && (
                  <div className="rounded-md bg-warning-50 border border-warning-200 text-xs text-warning-800 overflow-hidden">
                    <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-warning-200/60 bg-warning-100/40">
                      <span className="font-semibold flex items-center gap-1.5">
                        <ExclamationCircleIcon className="w-3.5 h-3.5" />
                        {duplicates.length} duplicate{duplicates.length === 1 ? '' : 's'}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setDuplicatesOpen((v) => !v)}
                          className="text-warning-700 hover:text-warning-900 shrink-0 px-1.5 py-0.5 hover:bg-warning-100 rounded transition-colors inline-flex items-center gap-1"
                          aria-expanded={duplicatesOpen}
                          aria-label={duplicatesOpen ? 'Hide duplicate files' : 'Show duplicate files'}
                        >
                          {duplicatesOpen ? 'Hide' : 'Show files'}
                          {duplicatesOpen
                            ? <ChevronUpIcon className="w-3 h-3" />
                            : <ChevronDownIcon className="w-3 h-3" />}
                        </button>
                        <button
                          onClick={() => setUploadErrors(hardErrors)}
                          className="text-warning-600 hover:text-warning-800 shrink-0 p-0.5 hover:bg-warning-100 rounded transition-colors"
                          aria-label="Dismiss duplicates"
                        >
                          <XMarkIcon className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    {duplicatesOpen && (
                      <div className="px-3 py-2 space-y-0.5 max-h-40 overflow-y-auto">
                        {duplicateNames.map((name, i) => (
                          <div key={i} className="break-words flex items-center gap-1.5">
                            <DocumentTextIcon className="w-3 h-3 shrink-0 text-warning-600" />
                            <span className="truncate" title={name}>{name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {hardErrors.length > 0 && (
                  <div className="rounded-md bg-danger-50 border border-danger-200 text-xs text-danger-700 overflow-hidden">
                    <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-danger-200/60 bg-danger-100/40">
                      <span className="font-semibold flex items-center gap-1.5">
                        <ExclamationCircleIcon className="w-3.5 h-3.5" />
                        {hardErrors.length} error{hardErrors.length === 1 ? '' : 's'}
                      </span>
                      <button
                        onClick={() => setUploadErrors(duplicates)}
                        className="text-danger-500 hover:text-danger-700 shrink-0 p-0.5 hover:bg-danger-100 rounded transition-colors"
                        aria-label="Dismiss errors"
                      >
                        <XMarkIcon className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="px-3 py-2 space-y-0.5 max-h-40 overflow-y-auto">
                      {hardErrors.map((e, i) => <div key={i} className="break-words">{e}</div>)}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Jobs list */}
        <div className="px-6 pb-5 relative">
          <div className={clsx(
            'sticky top-0 z-10 bg-neutral-50 -mx-6 px-6 border-b border-neutral-200 transition-all',
            isScrolled
              ? 'mb-3 pt-2 pb-2 shadow-sm'
              : 'mb-4 space-y-3 pt-4 pb-3',
          )}>
            {/* Title + count — hidden once scrolled to save vertical space */}
            {!isScrolled && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-neutral-900">Jobs</h2>
                  <span className="text-sm text-neutral-400 tabular-nums">
                    {listData?.total ?? jobs.length} total
                  </span>
                </div>
              </div>
            )}

            {/* Search + status filters + pager — single row when scrolled */}
            <div className={clsx(
              'flex items-center gap-2',
              isScrolled ? 'flex-nowrap' : 'flex-wrap gap-3',
            )}>
              {/* Search bar */}
              <div className={clsx(
                'relative flex-1 min-w-0',
                isScrolled ? 'max-w-[240px]' : 'min-w-[200px] max-w-sm',
              )}>
                <input
                  type="text"
                  placeholder="Search by filename..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                  className={clsx(
                    'w-full pl-3 pr-8 border border-neutral-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 placeholder:text-neutral-400',
                    isScrolled ? 'py-1 text-xs' : 'py-2 text-sm',
                  )}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-neutral-400 hover:text-neutral-600"
                  >
                    <XMarkIcon className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Status filter chips — count shows for the active filter only */}
              <div className="flex items-center gap-1.5 shrink-0">
                <FilterChip
                  active={statusFilter === 'all'}
                  onClick={() => { setStatusFilter('all'); setPage(1); }}
                  count={statusFilter === 'all' ? (listData?.total ?? 0) : undefined}
                >
                  All
                </FilterChip>
                <FilterChip
                  active={statusFilter === 'active'}
                  onClick={() => { setStatusFilter('active'); setPage(1); }}
                  count={statusFilter === 'active' ? (listData?.total ?? 0) : undefined}
                  variant="active"
                >
                  Active
                </FilterChip>
                <FilterChip
                  active={statusFilter === 'completed'}
                  onClick={() => { setStatusFilter('completed'); setPage(1); }}
                  count={statusFilter === 'completed' ? (listData?.total ?? 0) : undefined}
                  variant="success"
                >
                  Completed
                </FilterChip>
                <FilterChip
                  active={statusFilter === 'failed'}
                  onClick={() => { setStatusFilter('failed'); setPage(1); }}
                  count={statusFilter === 'failed' ? (listData?.total ?? 0) : undefined}
                  variant="danger"
                >
                  Failed
                </FilterChip>
              </div>

              {/* Pager — always on same row as search/filters when scrolled */}
              {isScrolled && (listData?.totalPages ?? 1) > 1 && (
                <div className="ml-auto flex items-center gap-1.5 shrink-0">
                  <span className="text-[11px] text-neutral-500 tabular-nums hidden sm:inline">
                    {(() => {
                      const total = listData?.total ?? 0;
                      const top = total === 0 ? 0 : total - (page - 1) * JOBS_PER_PAGE;
                      const bottom = Math.max(1, total - page * JOBS_PER_PAGE + 1);
                      return `${top}–${bottom} of ${total}`;
                    })()}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="inline-flex items-center gap-0.5 px-1.5 py-1 text-xs font-medium text-neutral-700 bg-white border border-neutral-300 rounded hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    aria-label="Previous page"
                  >
                    <ChevronLeftIcon className="w-3.5 h-3.5" />
                    Prev
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(listData?.totalPages ?? 1, p + 1))}
                    disabled={page >= (listData?.totalPages ?? 1)}
                    className="inline-flex items-center gap-0.5 px-1.5 py-1 text-xs font-medium text-neutral-700 bg-white border border-neutral-300 rounded hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    aria-label="Next page"
                  >
                    Next
                    <ChevronRightIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Active filter chips — clickable to clear individually (hidden when scrolled) */}
            {!isScrolled && (propertyFilter || dateFilter || reportTypeFilter || categoryFilter || fileTypeFilter) && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Active:</span>
                {propertyFilter && (
                  <ActiveChip label={`Property: ${propertyFilter}`} onClear={() => { setPropertyFilter(''); setPage(1); }} />
                )}
                {dateFilter && (
                  <ActiveChip label={`Date: ${dateFilter}`} onClear={() => { setDateFilter(''); setPage(1); }} />
                )}
                {categoryFilter && (
                  <ActiveChip label={`Category: ${categoryFilter}`} onClear={() => { setCategoryFilter(''); setPage(1); }} />
                )}
                {reportTypeFilter && (
                  <ActiveChip label={`Report: ${reportTypeFilter}`} onClear={() => { setReportTypeFilter(''); setPage(1); }} />
                )}
                {fileTypeFilter && (
                  <ActiveChip label={`Type: .${fileTypeFilter}`} onClear={() => setFileTypeFilter('')} />
                )}
              </div>
            )}

            {/* Sort row + pager (full, unscrolled state only) */}
            {!isScrolled && (
              <div className="flex items-center gap-2 text-[11px] text-neutral-500">
                <span className="font-semibold uppercase tracking-widest">Sort by:</span>
                <SortBtn label="Uploaded"  active={sortField === 'createdAt'}      dir={sortDir} onClick={() => toggleSort('createdAt')} />
                <SortBtn label="Name"       active={sortField === 'originalName'}   dir={sortDir} onClick={() => toggleSort('originalName')} />
                <SortBtn label="Property"   active={sortField === 'property'}       dir={sortDir} onClick={() => toggleSort('property')} />
                <SortBtn label="Report"     active={sortField === 'reportType'}     dir={sortDir} onClick={() => toggleSort('reportType')} />
                <SortBtn label="Category"   active={sortField === 'reportCategory'} dir={sortDir} onClick={() => toggleSort('reportCategory')} />
                <SortBtn label="Size"       active={sortField === 'fileSizeBytes'}  dir={sortDir} onClick={() => toggleSort('fileSizeBytes')} />

                {(listData?.totalPages ?? 1) > 1 && (
                  <div className="ml-auto flex items-center gap-1.5">
                    <span className="text-[11px] text-neutral-500 tabular-nums">
                      {(() => {
                        const total = listData?.total ?? 0;
                        const top = total === 0 ? 0 : total - (page - 1) * JOBS_PER_PAGE;
                        const bottom = Math.max(1, total - page * JOBS_PER_PAGE + 1);
                        return `${top}–${bottom} of ${total}`;
                      })()}
                    </span>
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-neutral-700 bg-white border border-neutral-300 rounded-md hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      aria-label="Previous page"
                    >
                      <ChevronLeftIcon className="w-3.5 h-3.5" />
                      Prev
                    </button>
                    <button
                      onClick={() => setPage((p) => Math.min(listData?.totalPages ?? 1, p + 1))}
                      disabled={page >= (listData?.totalPages ?? 1)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-neutral-700 bg-white border border-neutral-300 rounded-md hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      aria-label="Next page"
                    >
                      Next
                      <ChevronRightIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}
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
            <div className={clsx(
              'bg-white border border-neutral-200 rounded-lg overflow-hidden',
              viewMode === 'list' ? 'divide-y divide-neutral-100' : '',
            )}>
              {viewMode === 'compact' ? (
                /* ── Compact grid view ── */
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-px bg-neutral-100">
                  {filteredJobs.map(({ job, serial }) => (
                    <button
                      key={job.id}
                      onClick={() => setSelectedId(job.id)}
                      className={clsx(
                        'bg-white p-3 text-left hover:bg-neutral-50 transition-colors',
                        selectedId === job.id && 'bg-brand-50 hover:bg-brand-50',
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <FileIcon filename={job.originalName} status={job.status} />
                        <span className="text-[10px] text-neutral-400 tabular-nums">#{serial}</span>
                      </div>
                      <p className="text-xs text-neutral-800 truncate font-medium">{job.originalName}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <StatusBadge status={job.status} />
                        <span className="text-[10px] text-neutral-400">{fmtSize(job.fileSizeBytes)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                /* ── List view ── */
                filteredJobs.map(({ job, serial }) => (
                <div
                  key={job.id}
                  className={clsx(
                    'flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 transition-colors border-b border-neutral-100 last:border-b-0',
                    selectedId === job.id && 'bg-brand-50/60 hover:bg-brand-50/60',
                  )}
                >
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
                        {job.property && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-medium">
                            {job.property}
                          </span>
                        )}
                        {job.reportType && job.reportType !== 'Unknown' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium">
                            {job.reportType}
                          </span>
                        )}
                        {job.reportCategory && job.reportCategory !== 'Uncategorized' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-700 font-medium">
                            {job.reportCategory}
                          </span>
                        )}
                        {job.dateFolder && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-medium tabular-nums">
                            {job.dateFolder}
                          </span>
                        )}
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
                    {job.status === 'completed' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openPreview(job);
                        }}
                        title="Preview PDF"
                        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-brand-700 hover:bg-brand-50 rounded transition-colors"
                      >
                        <EyeIcon className="w-3 h-3" />
                        Preview
                      </button>
                    )}
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
              ))
              )}
            </div>
          )}

          {/* Pagination */}
          {(listData?.totalPages ?? 1) > 1 && (() => {
            const totalPages = listData?.totalPages ?? 1;
            const total = listData?.total ?? 0;
            const top = total === 0 ? 0 : total - (page - 1) * JOBS_PER_PAGE;
            const bottom = Math.max(1, total - page * JOBS_PER_PAGE + 1);
            const pageNumbers = buildPageRange(page, totalPages);
            return (
              <nav className="mt-6 flex items-center justify-between" aria-label="Jobs pagination">
                <span className="text-sm text-neutral-600 tabular-nums">
                  Showing <span className="font-semibold text-neutral-900">{top}</span>–<span className="font-semibold text-neutral-900">{bottom}</span> of <span className="font-semibold text-neutral-900">{total.toLocaleString()}</span>
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-neutral-700 bg-white border border-neutral-300 rounded-md hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    aria-label="Previous page"
                  >
                    <ChevronLeftIcon className="w-4 h-4" />
                    Previous
                  </button>
                  <div className="flex items-center gap-1 mx-1">
                    {pageNumbers.map((p, i) =>
                      p === '…' ? (
                        <span key={`ellipsis-${i}`} className="px-2 text-neutral-400 select-none">…</span>
                      ) : (
                        <button
                          key={p}
                          onClick={() => setPage(p)}
                          aria-current={p === page ? 'page' : undefined}
                          className={clsx(
                            'min-w-[34px] px-2 py-1.5 text-sm font-medium rounded-md transition-colors tabular-nums',
                            p === page
                              ? 'bg-neutral-900 text-white'
                              : 'text-neutral-700 bg-white border border-neutral-300 hover:bg-neutral-50',
                          )}
                        >
                          {p}
                        </button>
                      ),
                    )}
                  </div>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-neutral-700 bg-white border border-neutral-300 rounded-md hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    aria-label="Next page"
                  >
                    Next
                    <ChevronRightIcon className="w-4 h-4" />
                  </button>
                </div>
              </nav>
            );
          })()}
        </div>
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
                  {detail.property &&        <Row label="Property"    value={detail.property} />}
                  {detail.reportType &&      <Row label="Report Type" value={detail.reportType} />}
                  {detail.reportCategory &&  <Row label="Category"    value={detail.reportCategory} />}
                  {detail.dateFolder &&      <Row label="Date"        value={detail.dateFolder} />}
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

      {previewJob && (
        <SinglePdfViewer
          url={previewJob.url}
          title={previewJob.name}
          subtitle="OCR source file"
          downloadName={previewJob.name}
          onClose={() => setPreviewJob(null)}
        />
      )}
    </div>
  );
}

function StatPill({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-md border border-neutral-200 shrink-0">
      {icon}
      <span className="text-xs text-neutral-500">{label}</span>
      <span className="text-xs font-semibold text-neutral-900 tabular-nums">{value}</span>
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

function ActiveChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200 text-[11px] font-medium">
      {label}
      <button
        onClick={onClear}
        className="hover:bg-brand-100 rounded-full p-0.5 -mr-1 transition-colors"
        aria-label={`Clear ${label}`}
      >
        <XMarkIcon className="w-3 h-3" />
      </button>
    </span>
  );
}

function SortBtn({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
        active
          ? 'bg-neutral-900 text-white'
          : 'bg-white border border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:text-neutral-800',
      )}
    >
      {label}
      {active && (dir === 'asc'
        ? <ChevronUpIcon className="w-3 h-3" />
        : <ChevronDownIcon className="w-3 h-3" />)}
    </button>
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
  count?: number | undefined;
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
      {count != null && (
        <span className={clsx(
          'tabular-nums text-[10px] px-1 rounded',
          active ? 'bg-white/20' : 'bg-neutral-100 text-neutral-500',
        )}>
          {count}
        </span>
      )}
    </button>
  );
}
