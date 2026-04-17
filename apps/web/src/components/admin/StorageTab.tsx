/**
 * Storage tab — operator controls for OCR DB usage.
 *
 * Two actions:
 *   1. Snapshot — dumps current ocr_jobs metadata to a server-side JSON file
 *      so the Documents library survives bulk-delete.
 *   2. Bulk Delete — frees DB rows + storage objects matching status + age.
 *      Snapshots first by default so nothing disappears from Documents.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import {
  ArrowPathIcon,
  CircleStackIcon,
  TrashIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  CameraIcon,
} from '@heroicons/react/24/outline';
import { api } from '../../lib/api-client';

interface StorageStats {
  success: boolean;
  data: {
    dbJobs: number;
    dbBytes: number;
    statusCounts: Record<string, number>;
    snapshotBytes: number;
    snapshotJobs: number;
    snapshotGeneratedAt: string | null;
  };
}

interface SnapshotResult {
  success: boolean;
  data: {
    generatedAt: string;
    liveJobs: number;
    archivedJobs: number;
    totalJobs: number;
    snapshotBytes: number;
  };
}

interface BulkDeleteResult {
  success: boolean;
  data: {
    deleted: number;
    freedBytes: number;
    message?: string;
  };
}

type DeleteStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'any';

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function StorageTab() {
  const qc = useQueryClient();
  const [deleteStatus, setDeleteStatus] = useState<DeleteStatus>('completed');
  const [olderThanDays, setOlderThanDays] = useState(30);
  const [snapshotFirst, setSnapshotFirst] = useState(true);
  const [confirmText, setConfirmText] = useState('');
  const [lastResult, setLastResult] = useState<string | null>(null);

  const statsQuery = useQuery<StorageStats>({
    queryKey: ['ocr-storage-stats'],
    queryFn: () => api.get<StorageStats>('/ocr/jobs/storage-stats'),
    staleTime: 10_000,
  });

  const snapshotMut = useMutation<SnapshotResult>({
    mutationFn: () => api.post<SnapshotResult>('/ocr/jobs/snapshot'),
    onSuccess: (r) => {
      setLastResult(
        `Snapshot saved: ${r.data.totalJobs} total (${r.data.liveJobs} live + ${r.data.archivedJobs} archived) • ${fmtBytes(r.data.snapshotBytes)} on disk`,
      );
      qc.invalidateQueries({ queryKey: ['ocr-storage-stats'] });
      qc.invalidateQueries({ queryKey: ['ocr-jobs-documents-all'] });
      qc.invalidateQueries({ queryKey: ['ocr-jobs-documents'] });
    },
    onError: (e: Error) => setLastResult(`Snapshot failed: ${e.message}`),
  });

  const deleteMut = useMutation<BulkDeleteResult>({
    mutationFn: () =>
      api.post<BulkDeleteResult>('/ocr/jobs/bulk-delete', {
        status: deleteStatus,
        olderThanDays,
        snapshotFirst,
      }),
    onSuccess: (r) => {
      setLastResult(
        r.data.deleted === 0
          ? r.data.message ?? 'Nothing matched the criteria.'
          : `Deleted ${r.data.deleted} jobs, freed ${fmtBytes(r.data.freedBytes)} of storage.`,
      );
      setConfirmText('');
      qc.invalidateQueries({ queryKey: ['ocr-storage-stats'] });
      qc.invalidateQueries({ queryKey: ['ocr-jobs'] });
      qc.invalidateQueries({ queryKey: ['ocr-jobs-documents'] });
      qc.invalidateQueries({ queryKey: ['ocr-jobs-documents-all'] });
    },
    onError: (e: Error) => setLastResult(`Delete failed: ${e.message}`),
  });

  const stats = statsQuery.data?.data;
  const canDelete = confirmText === 'DELETE' && !deleteMut.isPending;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Stats */}
      <section className="bg-white border border-gray-200 rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <CircleStackIcon className="w-4 h-4 text-gray-500" />
            DB Storage Usage
          </h2>
          <button
            onClick={() => statsQuery.refetch()}
            disabled={statsQuery.isFetching}
            className="text-xs text-gray-500 hover:text-gray-700 inline-flex items-center gap-1"
          >
            <ArrowPathIcon className={clsx('w-3.5 h-3.5', statsQuery.isFetching && 'animate-spin')} />
            Refresh
          </button>
        </div>

        {statsQuery.isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : stats ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <Stat label="Jobs in DB" value={stats.dbJobs.toLocaleString()} />
              <Stat label="DB Storage" value={fmtBytes(stats.dbBytes)} />
              <Stat
                label="Snapshot Jobs"
                value={stats.snapshotJobs.toLocaleString()}
                hint={
                  stats.snapshotGeneratedAt
                    ? new Date(stats.snapshotGeneratedAt).toLocaleString()
                    : 'No snapshot yet'
                }
              />
              <Stat label="Snapshot Size" value={fmtBytes(stats.snapshotBytes)} />
            </div>

            <div className="text-xs text-gray-500 grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(['pending', 'processing', 'completed', 'failed'] as DeleteStatus[]).map(
                (s) => (
                  <div key={s} className="flex justify-between">
                    <span className="capitalize">{s}</span>
                    <span className="font-medium tabular-nums text-gray-700">
                      {(stats.statusCounts[s] ?? 0).toLocaleString()}
                    </span>
                  </div>
                ),
              )}
            </div>
          </>
        ) : (
          <p className="text-xs text-danger-600">Could not load stats.</p>
        )}
      </section>

      {/* Snapshot */}
      <section className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-2">
          <CameraIcon className="w-4 h-4 text-gray-500" />
          Snapshot for Documents Library
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          Saves a JSON copy of all OCR job metadata to disk. The Documents page reads
          from this snapshot, so deleting jobs from the DB doesn't blank the library.
        </p>
        <button
          onClick={() => snapshotMut.mutate()}
          disabled={snapshotMut.isPending}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {snapshotMut.isPending ? (
            <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <CameraIcon className="w-3.5 h-3.5" />
          )}
          {snapshotMut.isPending ? 'Snapshotting…' : 'Take Snapshot Now'}
        </button>
      </section>

      {/* Bulk Delete */}
      <section className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-2">
          <TrashIcon className="w-4 h-4 text-danger-500" />
          Bulk Delete OCR Jobs
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          Removes matching rows from the DB and their storage objects. Snapshot first
          (default) keeps them visible in Documents as <em>archived</em>.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <label className="text-xs">
            <span className="block text-gray-600 mb-1 font-medium">Status</span>
            <select
              value={deleteStatus}
              onChange={(e) => setDeleteStatus(e.target.value as DeleteStatus)}
              className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded bg-white"
            >
              <option value="completed">completed</option>
              <option value="failed">failed</option>
              <option value="pending">pending</option>
              <option value="any">any (except processing)</option>
            </select>
          </label>

          <label className="text-xs">
            <span className="block text-gray-600 mb-1 font-medium">Older than (days)</span>
            <input
              type="number"
              min={0}
              max={3650}
              value={olderThanDays}
              onChange={(e) => setOlderThanDays(Number(e.target.value))}
              className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded bg-white"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-xs text-gray-700 mb-4">
          <input
            type="checkbox"
            checked={snapshotFirst}
            onChange={(e) => setSnapshotFirst(e.target.checked)}
          />
          Snapshot before delete (recommended)
        </label>

        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-center gap-2 text-xs text-gray-700 mb-2">
            <ExclamationTriangleIcon className="w-3.5 h-3.5 text-warning-500" />
            Type <code className="px-1.5 py-0.5 bg-gray-100 rounded font-mono text-[11px]">DELETE</code> to confirm
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded bg-white"
            />
            <button
              onClick={() => deleteMut.mutate()}
              disabled={!canDelete}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-danger-600 text-white rounded hover:bg-danger-700 disabled:opacity-50 transition-colors shrink-0"
            >
              {deleteMut.isPending ? (
                <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <TrashIcon className="w-3.5 h-3.5" />
              )}
              Delete
            </button>
          </div>
        </div>
      </section>

      {/* Result toast */}
      {lastResult && (
        <div
          className={clsx(
            'rounded-md p-3 text-xs flex items-start gap-2',
            lastResult.toLowerCase().startsWith('snapshot failed') ||
              lastResult.toLowerCase().startsWith('delete failed')
              ? 'bg-danger-50 text-danger-700 border border-danger-200'
              : 'bg-success-50 text-success-700 border border-success-200',
          )}
        >
          <CheckCircleIcon className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{lastResult}</span>
          <button
            onClick={() => setLastResult(null)}
            className="text-current opacity-60 hover:opacity-100"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-gray-50 rounded p-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">
        {label}
      </div>
      <div className="text-lg font-semibold text-gray-900 tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-gray-400 mt-0.5 truncate" title={hint}>{hint}</div>}
    </div>
  );
}
