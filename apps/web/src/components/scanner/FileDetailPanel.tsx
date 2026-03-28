/**
 * Right-side detail panel for a selected scanned file.
 */

import { clsx } from 'clsx';
import {
  XMarkIcon,
  DocumentTextIcon,
  TableCellsIcon,
} from '@heroicons/react/24/outline';
import type { FlatResult } from './types';

function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface FileDetailPanelProps {
  file: FlatResult;
  onClose: () => void;
}

export function FileDetailPanel({ file, onClose }: FileDetailPanelProps) {
  const isPdf = file.extension === '.pdf';
  const confidencePct = (file.confidence * 100).toFixed(0);
  const confidenceColor =
    file.confidence >= 0.85 ? 'text-success-600' :
    file.confidence >= 0.6 ? 'text-warning-600' : 'text-danger-600';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start gap-2 px-4 py-3 border-b border-neutral-200 shrink-0">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{file.fileName}</p>
          <p className="text-xs text-neutral-400 mt-0.5">{file.reportTypeCategory} {file.reportType ? `/ ${file.reportType}` : ''}</p>
        </div>
        <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 mt-0.5 shrink-0">
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* File icon preview */}
        <div className="mx-4 mt-4 h-32 bg-neutral-50 rounded-lg border border-neutral-200 flex items-center justify-center">
          {isPdf
            ? <DocumentTextIcon className="w-12 h-12 text-red-300" />
            : <TableCellsIcon className="w-12 h-12 text-green-300" />
          }
        </div>

        {/* Confidence + category strip */}
        <div className="mx-4 mt-3 flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-brand-50 text-brand-700">
            {file.reportTypeCategory}
          </span>
          {file.reportType && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
              {file.reportType}
            </span>
          )}
          <span className={clsx('text-xs font-medium tabular-nums', confidenceColor)}>
            {confidencePct}% confidence
          </span>
        </div>

        {/* Metadata */}
        <div className="card mx-4 mt-3 p-3">
          <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-2">Details</p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-neutral-400">File size</dt>
            <dd className="tabular-nums text-neutral-700">{fmtFileSize(file.fileSizeBytes)}</dd>

            <dt className="text-neutral-400">Extension</dt>
            <dd className="text-neutral-700 uppercase">{file.extension.replace('.', '')}</dd>

            {file.property && (
              <>
                <dt className="text-neutral-400">Property</dt>
                <dd className="text-neutral-800 font-medium truncate">{file.property}</dd>
              </>
            )}

            {file.dateFolder && (
              <>
                <dt className="text-neutral-400">Report date</dt>
                <dd className="tabular-nums text-neutral-700">{file.dateFolder}</dd>
              </>
            )}

            <dt className="text-neutral-400">Parent folder</dt>
            <dd className="text-neutral-700 truncate">{file.propertyFolder}</dd>
          </dl>
        </div>

        {/* Extracted KPIs */}
        {(file.adrNumber || file.kpis) && (
          <div className="card mx-4 mt-3 p-3">
            <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-2">Extracted KPIs</p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              {file.kpis?.occupancyPct != null && (
                <><dt className="text-neutral-400">Occupancy</dt><dd className="tabular-nums font-medium text-neutral-800">{file.kpis.occupancyPct.toFixed(1)}%</dd></>
              )}
              {(file.adrNumber || file.kpis?.adr != null) && (
                <><dt className="text-neutral-400">ADR</dt><dd className="tabular-nums font-bold text-neutral-900">${file.adrNumber ?? file.kpis?.adr?.toFixed(2)}</dd></>
              )}
              {file.kpis?.revpar != null && (
                <><dt className="text-neutral-400">RevPAR</dt><dd className="tabular-nums font-medium text-neutral-800">${file.kpis.revpar.toFixed(2)}</dd></>
              )}
              {file.kpis?.roomsSold != null && (
                <><dt className="text-neutral-400">Rooms Sold</dt><dd className="tabular-nums text-neutral-700">{file.kpis.roomsSold}</dd></>
              )}
              {file.kpis?.oooRooms != null && (
                <><dt className="text-neutral-400">OOO Rooms</dt><dd className="tabular-nums text-neutral-700">{file.kpis.oooRooms}</dd></>
              )}
            </dl>
          </div>
        )}

        {/* Data patterns detected */}
        {file.dataPatterns && file.dataPatterns.length > 0 && (
          <div className="card mx-4 mt-3 p-3">
            <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-2">Data Patterns Detected</p>
            <div className="flex flex-wrap gap-1">
              {file.dataPatterns.map((p) => (
                <span key={p} className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700">{p}</span>
              ))}
            </div>
          </div>
        )}

        {/* Content preview */}
        {file.contentPreview && (
          <div className="card mx-4 mt-3 p-3">
            <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-2">OCR Content Preview</p>
            <p className="text-[10px] text-neutral-500 leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto font-mono">{file.contentPreview}</p>
          </div>
        )}

        {/* Error */}
        {file.error && (
          <div className="mx-4 mt-3 p-3 bg-danger-50 rounded-md border border-danger-200">
            <p className="text-[10px] font-semibold text-danger-600 uppercase tracking-widest mb-1">Parse Error</p>
            <p className="text-xs text-danger-700">{file.error}</p>
          </div>
        )}

        {/* Full path */}
        <div className="card mx-4 mt-3 mb-4 p-3">
          <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-2">File Path</p>
          <p className="text-xs text-neutral-600 break-all font-mono">{file.relativePath}</p>
        </div>
      </div>
    </div>
  );
}
