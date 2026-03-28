/**
 * Category and property breakdown panels.
 */

import { clsx } from 'clsx';
import type { ScanSummary } from './types';

const CATEGORY_COLORS: Record<string, string> = {
  'Operations':    'bg-blue-500',
  'Revenue':       'bg-emerald-500',
  'Accounting':    'bg-amber-500',
  'Uncategorized': 'bg-neutral-400',
};

interface CategoryBreakdownProps {
  summary: ScanSummary;
  selectedCategory: string;
  onSelectCategory: (cat: string) => void;
}

export function CategoryBreakdown({ summary, selectedCategory, onSelectCategory }: CategoryBreakdownProps) {
  const sorted = Object.entries(summary.categoryCounts).sort((a, b) => b[1] - a[1]);
  const total = summary.totalFiles;

  return (
    <div className="card p-4">
      <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-3">Categories</p>

      {/* Bar chart */}
      <div className="flex h-2 rounded-full overflow-hidden bg-neutral-100 mb-4">
        {sorted.map(([cat, count]) => (
          <div
            key={cat}
            className={clsx(CATEGORY_COLORS[cat] ?? 'bg-neutral-300', 'transition-all')}
            style={{ width: `${(count / total) * 100}%` }}
            title={`${cat}: ${count}`}
          />
        ))}
      </div>

      {/* List */}
      <div className="space-y-1">
        <button
          onClick={() => onSelectCategory('')}
          className={clsx(
            'w-full flex items-center justify-between px-2 py-1.5 rounded text-sm transition-colors',
            selectedCategory === '' ? 'bg-brand-50 text-brand-700 font-medium' : 'text-neutral-600 hover:bg-neutral-50',
          )}
        >
          <span>All Categories</span>
          <span className="text-xs tabular-nums text-neutral-400">{total}</span>
        </button>
        {sorted.map(([cat, count]) => (
          <button
            key={cat}
            onClick={() => onSelectCategory(cat)}
            className={clsx(
              'w-full flex items-center justify-between px-2 py-1.5 rounded text-sm transition-colors',
              selectedCategory === cat ? 'bg-brand-50 text-brand-700 font-medium' : 'text-neutral-600 hover:bg-neutral-50',
            )}
          >
            <span className="flex items-center gap-2">
              <span className={clsx('w-2 h-2 rounded-full shrink-0', CATEGORY_COLORS[cat] ?? 'bg-neutral-300')} />
              {cat}
            </span>
            <span className="text-xs tabular-nums text-neutral-400">{count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

interface PropertyBreakdownProps {
  summary: ScanSummary;
  selectedProperty: string;
  onSelectProperty: (prop: string) => void;
}

export function PropertyBreakdown({ summary, selectedProperty, onSelectProperty }: PropertyBreakdownProps) {
  const sorted = Object.entries(summary.propertyCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="card p-4">
      <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-3">Properties</p>
      <div className="space-y-1 max-h-[320px] overflow-y-auto">
        <button
          onClick={() => onSelectProperty('')}
          className={clsx(
            'w-full flex items-center justify-between px-2 py-1.5 rounded text-sm transition-colors',
            selectedProperty === '' ? 'bg-brand-50 text-brand-700 font-medium' : 'text-neutral-600 hover:bg-neutral-50',
          )}
        >
          <span>All Properties</span>
          <span className="text-xs tabular-nums text-neutral-400">{summary.totalFiles}</span>
        </button>
        {sorted.map(([prop, count]) => (
          <button
            key={prop}
            onClick={() => onSelectProperty(prop)}
            className={clsx(
              'w-full flex items-center justify-between px-2 py-1.5 rounded text-sm transition-colors',
              selectedProperty === prop ? 'bg-brand-50 text-brand-700 font-medium' : 'text-neutral-600 hover:bg-neutral-50',
            )}
          >
            <span className="truncate text-left">{prop}</span>
            <span className="text-xs tabular-nums text-neutral-400 shrink-0 ml-2">{count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
