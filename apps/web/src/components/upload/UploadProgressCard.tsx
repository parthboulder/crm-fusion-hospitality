/**
 * Renders progress for an in-flight upload batch. Used in two places:
 *   1. Inline in OcrUploadsPage (above the jobs table)
 *   2. As a floating Gmail-style card pinned to the bottom-right via
 *      GlobalUploadCard so progress stays visible across page navigation.
 *
 * Pure presentation — reads `batch` and calls `onAbort` from props. The store
 * lives in store/upload.store.ts.
 */

import { clsx } from 'clsx';
import {
  CheckCircleIcon,
  ArrowPathIcon,
  StopCircleIcon,
  DocumentTextIcon,
  TableCellsIcon,
  PhotoIcon,
} from '@heroicons/react/24/outline';
import type { BatchState } from '../../store/upload.store';

function FileTypeGlyph({ filename }: { filename: string }) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return <DocumentTextIcon className="w-3.5 h-3.5 text-red-400 shrink-0" />;
  if (['xlsx', 'xls', 'ods', 'csv', 'tsv'].includes(ext)) {
    return <TableCellsIcon className="w-3.5 h-3.5 text-green-500 shrink-0" />;
  }
  if (['png', 'jpg', 'jpeg', 'webp', 'tiff', 'tif', 'bmp'].includes(ext)) {
    return <PhotoIcon className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
  }
  return <DocumentTextIcon className="w-3.5 h-3.5 text-neutral-400 shrink-0" />;
}

export function UploadProgressCard({
  batch,
  onAbort,
  className,
}: {
  batch: BatchState;
  onAbort: () => void;
  className?: string;
}) {
  const total = batch.files.length;
  const done = batch.files.filter((f) => f.status === 'done').length;
  const failed = batch.files.filter((f) => f.status === 'error').length;
  const cancelled = batch.files.filter((f) => f.status === 'cancelled').length;
  const skipped = batch.files.filter((f) => f.status === 'skipped').length;
  const finished = done + failed + cancelled + skipped;
  const inflight = batch.files.filter((f) => f.status === 'uploading');

  const aggFraction =
    batch.totalBytes > 0
      ? Math.min(1, batch.bytesSent / batch.totalBytes)
      : finished / total;
  const aggPct = Math.round(aggFraction * 100);
  const allDone = finished === total;

  const visibleFiles = [
    ...inflight,
    ...batch.files
      .filter((f) => f.status !== 'uploading' && f.status !== 'pending')
      .slice(-4),
  ].slice(0, 6);

  return (
    <div className={clsx('bg-white border border-neutral-200 rounded-lg overflow-hidden shadow-sm', className)}>
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

        <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
          <div
            className={clsx(
              'h-full rounded-full transition-[width] duration-200',
              allDone && failed === 0
                ? 'bg-success-500'
                : failed > 0
                  ? 'bg-warning-500'
                  : 'bg-brand-500',
            )}
            style={{ width: `${aggPct}%` }}
          />
        </div>
      </div>

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
