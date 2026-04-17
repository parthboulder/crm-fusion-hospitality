/**
 * Document Library — browse processed OCR jobs.
 * Reads from /api/v1/ocr/jobs/persisted — a server-side JSON snapshot that
 * outlives DB row deletion, so the library remains usable even after the
 * operator runs a bulk-delete to free DB space.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import {
  MagnifyingGlassIcon,
  DocumentTextIcon,
  TableCellsIcon,
  PhotoIcon,
  FunnelIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { api } from '../lib/api-client';

interface OcrJob {
  id: string;
  originalName: string;
  fileType: string;
  fileSizeBytes: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  property: string | null;
  dateFolder: string | null;
  reportType: string | null;
  reportCategory: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  archived?: boolean; // true = served from snapshot, no longer in DB
}

interface JobsResponse {
  success: boolean;
  data: OcrJob[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  snapshotGeneratedAt?: string | null;
}


interface JobDetailResponse {
  success: boolean;
  data: OcrJob & {
    storagePath: string;
    extractedData: unknown;
    retryCount: number;
    startedAt: string | null;
  };
}

const PAGE_SIZE = 100;

function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function FileIcon({ name }: { name: string }) {
  const ext = getExt(name).slice(1);
  if (ext === 'pdf') return <DocumentTextIcon className="w-5 h-5 shrink-0 text-red-400" />;
  if (['xlsx', 'xls', 'ods', 'csv', 'tsv'].includes(ext)) {
    return <TableCellsIcon className="w-5 h-5 shrink-0 text-green-500" />;
  }
  if (['png', 'jpg', 'jpeg', 'webp', 'tiff', 'tif', 'bmp'].includes(ext)) {
    return <PhotoIcon className="w-5 h-5 shrink-0 text-blue-400" />;
  }
  return <DocumentTextIcon className="w-5 h-5 shrink-0 text-neutral-400" />;
}

export function DocumentsPage() {
  const [selectedProperty, setSelectedProperty] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedReportType, setSelectedReportType] = useState('');
  const [search, setSearch] = useState('');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  // Pull a wide unfiltered slice once to derive the dropdown options. The
  // snapshot is small JSON metadata (no extracted_data), so 5000 rows is
  // cheap. The visible page is loaded by jobsQuery below with filters applied.
  const allJobsQuery = useQuery<JobsResponse>({
    queryKey: ['ocr-jobs-documents-all'],
    queryFn: () => api.get<JobsResponse>('/ocr/jobs/persisted?limit=5000&page=1'),
    staleTime: 5 * 60_000,
  });

  const facets = useMemo(() => {
    const all = allJobsQuery.data?.data ?? [];
    const props = new Set<string>();
    const dates = new Set<string>();
    const types = new Set<string>();
    const cats = new Set<string>();
    for (const j of all) {
      if (j.property) props.add(j.property);
      if (j.dateFolder) dates.add(j.dateFolder);
      if (j.reportType) types.add(j.reportType);
      if (j.reportCategory) cats.add(j.reportCategory);
    }
    return {
      properties: [...props].sort(),
      dates: [...dates].sort().reverse(),
      reportTypes: [...types].sort(),
      categories: [...cats].sort(),
    };
  }, [allJobsQuery.data]);

  // Jobs list — server-side filtered. The OCR jobs endpoint accepts
  // property/dateFolder/reportType/category/search params directly, which
  // means the dropdowns drive the API instead of post-filtering in the
  // browser. Lets us paginate and keep the page snappy with thousands of rows.
  const jobsParams = (() => {
    const p = new URLSearchParams({ limit: String(PAGE_SIZE), page: '1' });
    if (selectedProperty) p.set('property', selectedProperty);
    if (selectedCategory) p.set('category', selectedCategory);
    if (selectedDate) p.set('dateFolder', selectedDate);
    if (selectedReportType) p.set('reportType', selectedReportType);
    if (search) p.set('search', search);
    return p.toString();
  })();

  const jobsQuery = useQuery<JobsResponse>({
    queryKey: ['ocr-jobs-documents', jobsParams],
    queryFn: () => api.get<JobsResponse>(`/ocr/jobs/persisted?${jobsParams}`),
    staleTime: 30_000,
  });

  const jobs = jobsQuery.data?.data ?? [];
  const total = jobsQuery.data?.total ?? 0;
  const snapshotGeneratedAt = jobsQuery.data?.snapshotGeneratedAt ?? null;

  // Archived rows have no DB row to fetch — we render the summary we already
  // have from the snapshot. The detail fetch is skipped for them.
  const selectedFromSnapshot = useMemo(
    () => jobs.find((j) => j.id === selectedJobId) ?? null,
    [jobs, selectedJobId],
  );
  const isSelectedArchived = !!selectedFromSnapshot?.archived;
  const detailQuery = useQuery<JobDetailResponse>({
    queryKey: ['ocr-job', selectedJobId],
    queryFn: () => api.get<JobDetailResponse>(`/ocr/jobs/${selectedJobId}`),
    enabled: !!selectedJobId && !isSelectedArchived,
    staleTime: 30_000,
  });

  // Local report-type tally — uses the loaded page only. The full-DB type
  // counts would need another endpoint; the visible page is enough to surface
  // the most common types in the current filter context.
  const reportTypesPreview = useMemo(() => {
    const counts = new Map<string, number>();
    for (const j of jobs) {
      if (!j.reportType) continue;
      counts.set(j.reportType, (counts.get(j.reportType) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);
  }, [jobs]);

  const hasFilters =
    selectedProperty || selectedCategory || selectedDate || selectedReportType || search;

  const clearFilters = () => {
    setSelectedProperty('');
    setSelectedCategory('');
    setSelectedDate('');
    setSelectedReportType('');
    setSearch('');
  };

  // For live rows: detail from API. For archived: synthesize a minimal
  // detail object from the snapshot row (no extractedData available).
  const selected = isSelectedArchived && selectedFromSnapshot
    ? {
        ...selectedFromSnapshot,
        storagePath: '',
        extractedData: null,
        retryCount: 0,
        startedAt: null,
      }
    : detailQuery.data?.data;

  if (jobsQuery.isError) {
    return (
      <div className="flex items-center justify-center h-full p-12">
        <div className="text-center">
          <DocumentTextIcon className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-neutral-700">Could not load documents</p>
          <p className="text-xs text-neutral-400 mt-1">
            {(jobsQuery.error as Error)?.message ?? 'Unknown error'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar — filters */}
      <div className="w-56 shrink-0 border-r border-neutral-200 bg-white overflow-y-auto">
        <div className="p-4">
          <h2 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-3">Filters</h2>

          <div className="mb-4">
            <label className="text-[10px] font-semibold text-neutral-500 uppercase tracking-widest mb-1.5 block">Date</label>
            <select
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full px-2 py-1.5 text-xs border border-neutral-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            >
              <option value="">All dates ({facets?.dates.length ?? 0})</option>
              {facets?.dates.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          <div className="mb-4">
            <label className="text-[10px] font-semibold text-neutral-500 uppercase tracking-widest mb-1.5 block">Property</label>
            <select
              value={selectedProperty}
              onChange={(e) => setSelectedProperty(e.target.value)}
              className="w-full px-2 py-1.5 text-xs border border-neutral-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            >
              <option value="">All properties ({facets?.properties.length ?? 0})</option>
              {facets?.properties.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div className="mb-4">
            <label className="text-[10px] font-semibold text-neutral-500 uppercase tracking-widest mb-1.5 block">Category</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-2 py-1.5 text-xs border border-neutral-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            >
              <option value="">All categories ({facets?.categories.length ?? 0})</option>
              {facets?.categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="mb-4">
            <label className="text-[10px] font-semibold text-neutral-500 uppercase tracking-widest mb-1.5 block">Report Type</label>
            <select
              value={selectedReportType}
              onChange={(e) => setSelectedReportType(e.target.value)}
              className="w-full px-2 py-1.5 text-xs border border-neutral-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            >
              <option value="">All types ({facets?.reportTypes.length ?? 0})</option>
              {facets?.reportTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {reportTypesPreview.length > 0 && (
            <div className="mb-4">
              <label className="text-[10px] font-semibold text-neutral-500 uppercase tracking-widest mb-2 block">Top Types (page)</label>
              <div className="space-y-1">
                {reportTypesPreview.map(([type, count]) => (
                  <button
                    key={type}
                    onClick={() => setSelectedReportType(type)}
                    className={clsx(
                      'w-full flex items-center justify-between px-2 py-1 rounded text-left transition-colors',
                      selectedReportType === type ? 'bg-brand-50' : 'hover:bg-neutral-50',
                    )}
                  >
                    <span className="text-[11px] text-neutral-600 truncate">{type}</span>
                    <span className="text-[10px] text-neutral-400 tabular-nums ml-1">{count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasFilters && (
            <button
              onClick={clearFilters}
              className="w-full flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-medium text-danger-600 bg-danger-50 rounded hover:bg-danger-100 transition-colors"
            >
              <XMarkIcon className="w-3 h-3" />
              Clear all filters
            </button>
          )}
        </div>
      </div>

      {/* Middle — file list */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200 bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <input
                type="text"
                placeholder="Search filenames..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <span className="text-xs text-neutral-400 tabular-nums shrink-0">
              {jobs.length} of {total} files
            </span>
          </div>
          {snapshotGeneratedAt && (
            <p className="text-[10px] text-neutral-400 mt-1">
              Snapshot generated {new Date(snapshotGeneratedAt).toLocaleString()}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {jobsQuery.isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-14 bg-neutral-100 rounded animate-pulse" />
              ))}
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <FunnelIcon className="w-10 h-10 text-neutral-300 mb-2" />
              <p className="text-sm text-neutral-500">No files match your filters</p>
            </div>
          ) : (
            <div className="divide-y divide-neutral-100">
              {jobs.map((j) => (
                <button
                  key={j.id}
                  onClick={() => setSelectedJobId(j.id)}
                  className={clsx(
                    'w-full text-left px-4 py-3 hover:bg-neutral-50 transition-colors flex items-center gap-3',
                    selectedJobId === j.id && 'bg-brand-50 hover:bg-brand-50',
                  )}
                >
                  <FileIcon name={j.originalName} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-neutral-800 truncate">{j.originalName}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {j.property && (
                        <span className="text-[10px] text-brand-600 font-medium">{j.property}</span>
                      )}
                      {j.dateFolder && (
                        <span className="text-[10px] text-neutral-400">{j.dateFolder}</span>
                      )}
                      {j.reportType && (
                        <span className="text-[10px] px-1 py-0.5 rounded font-medium bg-neutral-100 text-neutral-600">
                          {j.reportType}
                        </span>
                      )}
                      <span
                        className={clsx(
                          'text-[10px] px-1 py-0.5 rounded font-medium',
                          j.status === 'completed' && 'bg-success-50 text-success-700',
                          j.status === 'processing' && 'bg-brand-50 text-brand-700',
                          j.status === 'pending' && 'bg-neutral-100 text-neutral-500',
                          j.status === 'failed' && 'bg-danger-50 text-danger-700',
                        )}
                      >
                        {j.status}
                      </span>
                      {j.archived && (
                        <span
                          className="text-[10px] px-1 py-0.5 rounded font-medium bg-neutral-100 text-neutral-500"
                          title="Removed from DB to free space — served from snapshot"
                        >
                          archived
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] text-neutral-400 tabular-nums shrink-0">
                    {fmtFileSize(j.fileSizeBytes)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right panel — file detail */}
      {selectedJobId && (
        <div className="w-80 shrink-0 border-l border-neutral-200 bg-white overflow-y-auto">
          <div className="p-4">
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-sm font-semibold text-neutral-800 break-words pr-2">
                {selected?.originalName ?? 'Loading…'}
              </h3>
              <button
                onClick={() => setSelectedJobId(null)}
                className="shrink-0 text-neutral-400 hover:text-neutral-600"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>

            {detailQuery.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-4 bg-neutral-100 rounded animate-pulse" />
                ))}
              </div>
            ) : selected ? (
              <>
                <div className="space-y-3">
                  <DetailRow label="Status" value={selected.status} />
                  <DetailRow label="Report Type" value={selected.reportType ?? 'Unknown'} />
                  <DetailRow label="Category" value={selected.reportCategory ?? '—'} />
                  <DetailRow label="Date" value={selected.dateFolder ?? '—'} />
                  <DetailRow label="Property" value={selected.property ?? '—'} />
                  <DetailRow label="File Type" value={selected.fileType} />
                  <DetailRow label="Size" value={fmtFileSize(selected.fileSizeBytes)} />
                  <DetailRow
                    label="Created"
                    value={new Date(selected.createdAt).toLocaleString()}
                  />
                  {selected.completedAt && (
                    <DetailRow
                      label="Completed"
                      value={new Date(selected.completedAt).toLocaleString()}
                    />
                  )}
                  {selected.errorMessage && (
                    <div className="p-2 bg-danger-50 rounded text-xs text-danger-700">
                      {selected.errorMessage}
                    </div>
                  )}
                </div>

                {selected.extractedData != null && (
                  <div className="mt-4">
                    <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-2">
                      Extracted Data
                    </p>
                    <pre className="text-[10px] text-neutral-600 bg-neutral-50 rounded p-3 overflow-auto max-h-96 whitespace-pre-wrap font-mono">
                      {JSON.stringify(selected.extractedData, null, 2).slice(0, 4000)}
                      {JSON.stringify(selected.extractedData).length > 4000 && '\n\n... (truncated)'}
                    </pre>
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-[10px] font-medium text-neutral-400 uppercase tracking-wider shrink-0">{label}</span>
      <span className="text-xs text-neutral-700 text-right break-words">{value}</span>
    </div>
  );
}
