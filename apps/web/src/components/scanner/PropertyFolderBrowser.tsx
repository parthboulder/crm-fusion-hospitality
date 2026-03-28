/**
 * Smart property folder categorization browser.
 *
 * Layout:
 *   Top date-tab bar → property folder cards below.
 *   Each card auto-shows matched property, categorized file tags, ADR values,
 *   and an expandable file list. Status chips show categorization health at a glance.
 */

import { useState, useMemo } from 'react';
import { clsx } from 'clsx';
import {
  FolderIcon,
  FolderOpenIcon,
  ChevronRightIcon,
  DocumentTextIcon,
  TableCellsIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  BuildingOffice2Icon,
  CurrencyDollarIcon,
} from '@heroicons/react/24/outline';
import type { ScanSummary, PropertyFolder, ScannedFile } from './types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const CATEGORY_DOT: Record<string, string> = {
  Operations:    'bg-blue-500',
  Revenue:       'bg-emerald-500',
  Accounting:    'bg-amber-500',
  Uncategorized: 'bg-neutral-300',
  Other:         'bg-neutral-300',
};

// ─── File row ────────────────────────────────────────────────────────────────

function FileRow({ file }: { file: ScannedFile }) {
  return (
    <tr className="hover:bg-neutral-50/50 transition-colors group">
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-2">
          {file.extension === '.pdf'
            ? <DocumentTextIcon className="w-3.5 h-3.5 shrink-0 text-red-400" />
            : <TableCellsIcon className="w-3.5 h-3.5 shrink-0 text-green-500" />
          }
          <span className="truncate text-neutral-700 text-xs" title={file.fileName}>{file.fileName}</span>
        </div>
      </td>
      <td className="px-3 py-1.5">
        {file.reportType ? (
          <span className={clsx(
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium',
            file.confidence >= 0.85 ? 'bg-success-50 text-success-700' :
            file.confidence >= 0.6 ? 'bg-warning-50 text-warning-700' :
            'bg-danger-50 text-danger-700',
          )}>
            {file.reportType}
          </span>
        ) : (
          <span className="text-[10px] text-neutral-300 italic">not classified</span>
        )}
      </td>
      <td className="px-3 py-1.5">
        <span className="flex items-center gap-1 text-[10px] text-neutral-500">
          <span className={clsx('w-1.5 h-1.5 rounded-full', CATEGORY_DOT[file.reportTypeCategory] ?? 'bg-neutral-300')} />
          {file.reportTypeCategory}
        </span>
      </td>
      <td className="px-3 py-1.5 tabular-nums text-xs font-semibold text-neutral-800">
        {file.adrNumber ? `$${file.adrNumber}` : ''}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums text-[10px] text-neutral-400">{fmtFileSize(file.fileSizeBytes)}</td>
    </tr>
  );
}

// ─── Property folder card ────────────────────────────────────────────────────

interface FolderCardProps {
  folder: PropertyFolder;
  isExpanded: boolean;
  onToggle: () => void;
}

function FolderCard({ folder, isExpanded, onToggle }: FolderCardProps) {
  const categorized = folder.files.filter((f) => f.reportType !== null).length;
  const uncategorized = folder.fileCount - categorized;
  const withAdr = folder.files.filter((f) => f.adrNumber !== null).length;
  const errors = folder.files.filter((f) => f.error !== null).length;
  const pct = folder.fileCount > 0 ? Math.round((categorized / folder.fileCount) * 100) : 0;

  // Group files by category for summary chips
  const categoryGroups = useMemo(() => {
    const groups: Record<string, number> = {};
    for (const f of folder.files) {
      groups[f.reportTypeCategory] = (groups[f.reportTypeCategory] ?? 0) + 1;
    }
    return Object.entries(groups).sort((a, b) => b[1] - a[1]);
  }, [folder.files]);

  // Health color
  const healthColor = pct === 100 ? 'border-l-success-500' : pct >= 60 ? 'border-l-warning-400' : 'border-l-danger-400';

  return (
    <div className={clsx(
      'card overflow-hidden border-l-[3px] transition-all',
      healthColor,
      isExpanded && 'ring-1 ring-brand-200 shadow-md',
    )}>
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 hover:bg-neutral-50/50 transition-colors"
      >
        <div className="flex items-start gap-3">
          <ChevronRightIcon className={clsx('w-4 h-4 mt-0.5 shrink-0 text-neutral-400 transition-transform', isExpanded && 'rotate-90')} />

          {isExpanded
            ? <FolderOpenIcon className="w-5 h-5 mt-0.5 shrink-0 text-amber-500" />
            : <FolderIcon className="w-5 h-5 mt-0.5 shrink-0 text-amber-500" />
          }

          <div className="flex-1 min-w-0">
            {/* Folder name */}
            <p className="text-sm font-medium text-neutral-800 truncate leading-tight">{folder.folderName}</p>

            {/* Property match row */}
            <div className="flex items-center gap-2 mt-1">
              {folder.propertyCode ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded">
                  <BuildingOffice2Icon className="w-3 h-3" />
                  {folder.propertyCode} — {folder.propertyName}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-neutral-400 bg-neutral-50 px-1.5 py-0.5 rounded">
                  <ExclamationTriangleIcon className="w-3 h-3" />
                  No property match
                </span>
              )}

              {withAdr > 0 && (
                <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                  <CurrencyDollarIcon className="w-3 h-3" />
                  {withAdr} ADR
                </span>
              )}
            </div>

            {/* Category summary chips */}
            <div className="flex flex-wrap gap-1 mt-1.5">
              {categoryGroups.map(([cat, count]) => (
                <span key={cat} className="inline-flex items-center gap-1 text-[10px] text-neutral-500">
                  <span className={clsx('w-1.5 h-1.5 rounded-full', CATEGORY_DOT[cat] ?? 'bg-neutral-300')} />
                  {cat} <span className="text-neutral-400">({count})</span>
                </span>
              ))}
            </div>
          </div>

          {/* Right side: status strip */}
          <div className="flex items-center gap-2 shrink-0 mt-0.5">
            {/* Categorization progress */}
            <div className="flex flex-col items-end gap-0.5">
              <div className="flex items-center gap-1">
                <CheckCircleIcon className={clsx('w-3.5 h-3.5', pct === 100 ? 'text-success-500' : 'text-neutral-300')} />
                <span className={clsx('text-xs tabular-nums font-semibold', pct === 100 ? 'text-success-600' : 'text-neutral-500')}>
                  {categorized}/{folder.fileCount}
                </span>
              </div>
              {/* Mini progress bar */}
              <div className="w-16 h-1 rounded-full bg-neutral-100 overflow-hidden">
                <div
                  className={clsx('h-full rounded-full transition-all', pct === 100 ? 'bg-success-500' : pct >= 60 ? 'bg-warning-400' : 'bg-danger-400')}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {errors > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] text-danger-500">
                <ExclamationTriangleIcon className="w-3 h-3" />
                {errors}
              </span>
            )}
          </div>
        </div>

        {/* Report type tags */}
        {Object.keys(folder.reportTypeCounts).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2 ml-12">
            {Object.entries(folder.reportTypeCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => (
                <span key={type} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600">
                  {type}
                  {count > 1 && <span className="ml-0.5 text-blue-400">x{count}</span>}
                </span>
              ))}
            {uncategorized > 0 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-100 text-neutral-400">
                {uncategorized} unclassified
              </span>
            )}
          </div>
        )}
      </button>

      {/* Expanded file list */}
      {isExpanded && (
        <div className="border-t border-neutral-100">
          <table className="w-full">
            <thead>
              <tr className="bg-neutral-50/80 border-b border-neutral-100">
                <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">File</th>
                <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">Report Type</th>
                <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">Category</th>
                <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">ADR</th>
                <th className="px-3 py-1.5 text-right text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">Size</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {folder.files.map((file, i) => (
                <FileRow key={`${file.relativePath}-${i}`} file={file} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

interface PropertyFolderBrowserProps {
  summary: ScanSummary;
  selectedDate: string;
}

export function PropertyFolderBrowser({ summary, selectedDate }: PropertyFolderBrowserProps) {
  const [expandedFolder, setExpandedFolder] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Filter by date
  const filteredDateFolders = useMemo(() => {
    if (!selectedDate) return summary.dateFolders;
    return summary.dateFolders.filter((df) => df.normalizedDate === selectedDate);
  }, [summary.dateFolders, selectedDate]);

  // Flatten all property folders (with their date context) for search
  const allPropertyFolders = useMemo(() => {
    const result: Array<{ dateLabel: string; folder: PropertyFolder; key: string }> = [];
    for (const df of filteredDateFolders) {
      for (const pf of df.propertyFolders) {
        result.push({
          dateLabel: df.normalizedDate,
          folder: pf,
          key: `${df.normalizedDate}/${pf.folderName}`,
        });
      }
    }
    return result;
  }, [filteredDateFolders]);

  // Apply search
  const searchedFolders = useMemo(() => {
    if (!search) return allPropertyFolders;
    const q = search.toLowerCase();
    return allPropertyFolders.filter((item) =>
      item.folder.folderName.toLowerCase().includes(q) ||
      (item.folder.propertyCode?.toLowerCase().includes(q) ?? false) ||
      (item.folder.propertyName?.toLowerCase().includes(q) ?? false) ||
      item.folder.files.some((f) => f.reportType?.toLowerCase().includes(q) ?? false)
    );
  }, [allPropertyFolders, search]);

  // Group by date for rendering
  const groupedByDate = useMemo(() => {
    const groups = new Map<string, typeof searchedFolders>();
    for (const item of searchedFolders) {
      const existing = groups.get(item.dateLabel);
      if (existing) {
        existing.push(item);
      } else {
        groups.set(item.dateLabel, [item]);
      }
    }
    return groups;
  }, [searchedFolders]);

  const handleToggle = (key: string): void => {
    setExpandedFolder((prev) => (prev === key ? null : key));
  };

  // Summary stats for the filtered view
  const totalFolders = searchedFolders.length;
  const totalCategorized = searchedFolders.reduce((s, item) =>
    s + item.folder.files.filter((f) => f.reportType !== null).length, 0);
  const totalFiles = searchedFolders.reduce((s, item) => s + item.folder.fileCount, 0);
  const fullyClassified = searchedFolders.filter((item) =>
    item.folder.files.every((f) => f.reportType !== null)).length;

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
          <input
            type="text"
            placeholder="Search folders, properties, report types..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
          />
        </div>
        <span className="text-xs text-neutral-400 tabular-nums">
          {totalFolders} folders &middot; {totalFiles} files &middot;
          <span className={clsx('ml-1', fullyClassified === totalFolders ? 'text-success-600 font-medium' : 'text-neutral-400')}>
            {fullyClassified}/{totalFolders} fully classified
          </span>
        </span>
      </div>

      {/* Date groups */}
      {[...groupedByDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, items]) => (
        <div key={date} className="mb-6">
          {/* Date header */}
          <div className="flex items-center gap-2 mb-3 px-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-neutral-800">{date}</span>
              <span className="text-xs text-neutral-400">
                {items.length} property folder{items.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex-1 border-t border-neutral-200 ml-2" />
          </div>

          {/* Folder cards */}
          <div className="space-y-2">
            {items
              .sort((a, b) => a.folder.folderName.localeCompare(b.folder.folderName))
              .map((item) => (
                <FolderCard
                  key={item.key}
                  folder={item.folder}
                  isExpanded={expandedFolder === item.key}
                  onToggle={() => handleToggle(item.key)}
                />
              ))}
          </div>
        </div>
      ))}

      {searchedFolders.length === 0 && (
        <div className="card flex flex-col items-center justify-center py-16">
          <FolderIcon className="w-10 h-10 text-neutral-300 mb-2" />
          <p className="text-sm text-neutral-500">No folders match your filters.</p>
        </div>
      )}
    </div>
  );
}
