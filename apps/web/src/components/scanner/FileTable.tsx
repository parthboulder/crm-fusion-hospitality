/**
 * Sortable, filterable table of scanned files with inline dropdown filters.
 */

import { useState, useMemo } from 'react';
import { clsx } from 'clsx';
import {
  ChevronUpIcon,
  ChevronDownIcon,
  MagnifyingGlassIcon,
  DocumentTextIcon,
  TableCellsIcon,
  XMarkIcon,
  FunnelIcon,
} from '@heroicons/react/24/outline';
import type { FlatResult } from './types';

function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function confidenceBadge(confidence: number): string {
  if (confidence >= 0.85) return 'text-success-600 bg-success-50';
  if (confidence >= 0.6) return 'text-warning-600 bg-warning-50';
  return 'text-danger-600 bg-danger-50';
}

function extIcon(ext: string): string {
  if (ext === '.pdf') return 'text-red-500';
  if (['.xlsx', '.xls', '.csv'].includes(ext)) return 'text-green-600';
  return 'text-neutral-400';
}

const CATEGORY_DOT: Record<string, string> = {
  Operations:    'bg-blue-500',
  Revenue:       'bg-emerald-500',
  Accounting:    'bg-amber-500',
  Uncategorized: 'bg-neutral-300',
  Other:         'bg-neutral-300',
};

type SortField = 'fileName' | 'reportTypeCategory' | 'reportType' | 'property' | 'adrNumber' | 'confidence' | 'fileSizeBytes';
type SortDir = 'asc' | 'desc';

interface FileTableProps {
  results: FlatResult[];
  onSelectFile: (file: FlatResult) => void;
  selectedFile: FlatResult | null;
}

const PAGE_SIZE = 50;

export function FileTable({ results, onSelectFile, selectedFile }: FileTableProps) {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('fileName');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(0);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterProperty, setFilterProperty] = useState('');
  const [filterReportType, setFilterReportType] = useState('');
  const [filterFileName, setFilterFileName] = useState('');
  const [filterDate, setFilterDate] = useState('');

  // Build unique filter options from the data
  const filterOptions = useMemo(() => {
    const categories = new Map<string, number>();
    const properties = new Map<string, number>();
    const reportTypes = new Map<string, number>();
    const fileNames = new Map<string, number>();
    const dates = new Map<string, number>();

    for (const r of results) {
      categories.set(r.reportTypeCategory, (categories.get(r.reportTypeCategory) ?? 0) + 1);
      if (r.property) properties.set(r.property, (properties.get(r.property) ?? 0) + 1);
      if (r.reportType) reportTypes.set(r.reportType, (reportTypes.get(r.reportType) ?? 0) + 1);
      dates.set(r.dateFolder, (dates.get(r.dateFolder) ?? 0) + 1);

      // Use displayName for the file name filter
      const baseName = r.displayName || r.fileName.replace(/\.[^.]+$/, '');
      if (baseName) fileNames.set(baseName, (fileNames.get(baseName) ?? 0) + 1);
    }

    return {
      categories: [...categories.entries()].sort((a, b) => b[1] - a[1]),
      properties: [...properties.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      reportTypes: [...reportTypes.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      fileNames: [...fileNames.entries()].sort((a, b) => b[1] - a[1]),
      dates: [...dates.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    };
  }, [results]);

  function handleSort(field: SortField): void {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
    setPage(0);
  }

  // Apply all filters: search + dropdowns
  const filtered = useMemo(() => {
    return results.filter((r) => {
      if (filterCategory && r.reportTypeCategory !== filterCategory) return false;
      if (filterProperty && r.property !== filterProperty) return false;
      if (filterReportType && r.reportType !== filterReportType) return false;
      if (filterFileName && !r.displayName.includes(filterFileName) && !r.fileName.includes(filterFileName)) return false;
      if (filterDate && r.dateFolder !== filterDate) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !r.fileName.toLowerCase().includes(q) &&
          !r.reportTypeCategory.toLowerCase().includes(q) &&
          !(r.reportType?.toLowerCase().includes(q) ?? false) &&
          !(r.property?.toLowerCase().includes(q) ?? false) &&
          !(r.adrNumber?.includes(q) ?? false)
        ) return false;
      }
      return true;
    });
  }, [results, search, filterCategory, filterProperty, filterReportType, filterFileName, filterDate]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      const aVal = av ?? '';
      const bVal = bv ?? '';
      const cmp = typeof aVal === 'number' && typeof bVal === 'number'
        ? aVal - bVal
        : String(aVal).localeCompare(String(bVal));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageData = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const activeFilterCount = [filterCategory, filterProperty, filterReportType, filterFileName, filterDate].filter(Boolean).length;

  function clearAllFilters(): void {
    setFilterCategory('');
    setFilterProperty('');
    setFilterReportType('');
    setFilterFileName('');
    setFilterDate('');
    setSearch('');
    setPage(0);
  }

  function SortHeader({ field, label }: { field: SortField; label: string }) {
    return (
      <th
        className="px-3 py-2 text-left text-xs font-semibold text-neutral-500 cursor-pointer select-none hover:text-neutral-800 transition-colors"
        onClick={() => handleSort(field)}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {sortField === field && (
            sortDir === 'asc'
              ? <ChevronUpIcon className="w-3 h-3" />
              : <ChevronDownIcon className="w-3 h-3" />
          )}
        </span>
      </th>
    );
  }

  return (
    <div className="card overflow-hidden">
      {/* Toolbar: search + filters */}
      <div className="px-4 py-3 border-b border-neutral-100 space-y-2">
        {/* Row 1: search + file count */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <input
              type="text"
              placeholder="Search files..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
            />
          </div>
          <span className="text-xs text-neutral-400 tabular-nums shrink-0 ml-auto">
            {filtered.length.toLocaleString()} file{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Row 2: filter dropdowns */}
        <div className="flex items-center gap-2 flex-wrap">
          <FunnelIcon className="w-3.5 h-3.5 text-neutral-400 shrink-0" />

          {/* Date */}
          <select
            value={filterDate}
            onChange={(e) => { setFilterDate(e.target.value); setPage(0); }}
            className={clsx(
              'text-xs border rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500/20',
              filterDate ? 'border-brand-300 bg-brand-50 text-brand-700 font-medium' : 'border-neutral-200 text-neutral-600',
            )}
          >
            <option value="">All Dates</option>
            {filterOptions.dates.map(([date, count]) => (
              <option key={date} value={date}>{date} ({count})</option>
            ))}
          </select>

          {/* File Name */}
          <select
            value={filterFileName}
            onChange={(e) => { setFilterFileName(e.target.value); setPage(0); }}
            className={clsx(
              'text-xs border rounded-md px-2 py-1.5 max-w-[200px] focus:outline-none focus:ring-2 focus:ring-brand-500/20',
              filterFileName ? 'border-brand-300 bg-brand-50 text-brand-700 font-medium' : 'border-neutral-200 text-neutral-600',
            )}
          >
            <option value="">All File Names</option>
            {filterOptions.fileNames.map(([name, count]) => (
              <option key={name} value={name}>{name} ({count})</option>
            ))}
          </select>

          {/* Category */}
          <select
            value={filterCategory}
            onChange={(e) => { setFilterCategory(e.target.value); setPage(0); }}
            className={clsx(
              'text-xs border rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500/20',
              filterCategory ? 'border-brand-300 bg-brand-50 text-brand-700 font-medium' : 'border-neutral-200 text-neutral-600',
            )}
          >
            <option value="">All Categories</option>
            {filterOptions.categories.map(([cat, count]) => (
              <option key={cat} value={cat}>{cat} ({count})</option>
            ))}
          </select>

          {/* Property */}
          <select
            value={filterProperty}
            onChange={(e) => { setFilterProperty(e.target.value); setPage(0); }}
            className={clsx(
              'text-xs border rounded-md px-2 py-1.5 max-w-[200px] focus:outline-none focus:ring-2 focus:ring-brand-500/20',
              filterProperty ? 'border-brand-300 bg-brand-50 text-brand-700 font-medium' : 'border-neutral-200 text-neutral-600',
            )}
          >
            <option value="">All Properties</option>
            {filterOptions.properties.map(([prop, count]) => (
              <option key={prop} value={prop}>{prop} ({count})</option>
            ))}
          </select>

          {/* Report Type */}
          <select
            value={filterReportType}
            onChange={(e) => { setFilterReportType(e.target.value); setPage(0); }}
            className={clsx(
              'text-xs border rounded-md px-2 py-1.5 max-w-[200px] focus:outline-none focus:ring-2 focus:ring-brand-500/20',
              filterReportType ? 'border-brand-300 bg-brand-50 text-brand-700 font-medium' : 'border-neutral-200 text-neutral-600',
            )}
          >
            <option value="">All Report Types</option>
          {filterOptions.reportTypes.map(([type, count]) => (
              <option key={type} value={type}>{type} ({count})</option>
            ))}
          </select>

          {/* Clear */}
          {activeFilterCount > 0 && (
            <button
              onClick={clearAllFilters}
              className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700 transition-colors"
            >
              <XMarkIcon className="w-3.5 h-3.5" />
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* Active filter chips */}
      {activeFilterCount > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-neutral-50/50 border-b border-neutral-100">
          {filterDate && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700">
              {filterDate}
              <button onClick={() => setFilterDate('')} className="hover:text-amber-900"><XMarkIcon className="w-3 h-3" /></button>
            </span>
          )}
          {filterFileName && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-50 text-indigo-700">
              {filterFileName}
              <button onClick={() => setFilterFileName('')} className="hover:text-indigo-900"><XMarkIcon className="w-3 h-3" /></button>
            </span>
          )}
          {filterCategory && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-brand-50 text-brand-700">
              <span className={clsx('w-1.5 h-1.5 rounded-full', CATEGORY_DOT[filterCategory] ?? 'bg-neutral-300')} />
              {filterCategory}
              <button onClick={() => setFilterCategory('')} className="hover:text-brand-900"><XMarkIcon className="w-3 h-3" /></button>
            </span>
          )}
          {filterProperty && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-50 text-purple-700">
              {filterProperty.split(' - ')[0]}
              <button onClick={() => setFilterProperty('')} className="hover:text-purple-900"><XMarkIcon className="w-3 h-3" /></button>
            </span>
          )}
          {filterReportType && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-700">
              {filterReportType}
              <button onClick={() => setFilterReportType('')} className="hover:text-blue-900"><XMarkIcon className="w-3 h-3" /></button>
            </span>
          )}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-25 border-b border-neutral-100">
            <tr>
              <SortHeader field="fileName" label="File Name" />
              <SortHeader field="reportTypeCategory" label="Category" />
              <SortHeader field="reportType" label="Report Type" />
              <SortHeader field="property" label="Property" />
              <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-500">Date</th>
              <SortHeader field="adrNumber" label="ADR" />
              <SortHeader field="confidence" label="Confidence" />
              <SortHeader field="fileSizeBytes" label="Size" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {pageData.map((file, i) => (
              <tr
                key={`${file.relativePath}-${i}`}
                onClick={() => onSelectFile(file)}
                className={clsx(
                  'cursor-pointer transition-colors',
                  selectedFile?.relativePath === file.relativePath
                    ? 'bg-brand-50'
                    : 'hover:bg-neutral-50',
                )}
              >
                <td className="px-3 py-2 max-w-[260px]">
                  <div className="flex items-center gap-2">
                    {file.extension === '.pdf'
                      ? <DocumentTextIcon className={clsx('w-4 h-4 shrink-0', extIcon(file.extension))} />
                      : <TableCellsIcon className={clsx('w-4 h-4 shrink-0', extIcon(file.extension))} />
                    }
                    <span className="truncate text-neutral-800" title={file.fileName}>
                      {file.displayName || file.fileName}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5 text-neutral-600">
                    <span className={clsx('w-2 h-2 rounded-full shrink-0', CATEGORY_DOT[file.reportTypeCategory] ?? 'bg-neutral-300')} />
                    {file.reportTypeCategory}
                  </span>
                </td>
                <td className="px-3 py-2 text-neutral-600">{file.reportType ?? <span className="text-neutral-300">—</span>}</td>
                <td className="px-3 py-2 text-neutral-600 truncate max-w-[160px]">{file.property ?? <span className="text-neutral-300">—</span>}</td>
                <td className="px-3 py-2 tabular-nums text-xs text-neutral-500">{file.dateFolder}</td>
                <td className="px-3 py-2 tabular-nums font-medium text-neutral-800">
                  {file.adrNumber ? `$${file.adrNumber}` : <span className="text-neutral-300">—</span>}
                </td>
                <td className="px-3 py-2">
                  <span className={clsx('inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium tabular-nums', confidenceBadge(file.confidence))}>
                    {(file.confidence * 100).toFixed(0)}%
                  </span>
                </td>
                <td className="px-3 py-2 tabular-nums text-neutral-500 text-xs">{fmtFileSize(file.fileSizeBytes)}</td>
              </tr>
            ))}
            {pageData.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center text-neutral-400 text-sm">
                  No files match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-neutral-100">
          <span className="text-xs text-neutral-400">
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="btn-secondary !px-2 !py-1 text-xs disabled:opacity-40"
            >
              Prev
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="btn-secondary !px-2 !py-1 text-xs disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
