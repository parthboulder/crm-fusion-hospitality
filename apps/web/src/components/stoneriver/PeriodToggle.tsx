/**
 * Day / MTD / YTD toggle for the Stoneriver dashboard.
 */

import { clsx } from 'clsx';
import type { Period } from './types';

interface PeriodToggleProps {
  value: Period;
  onChange: (period: Period) => void;
}

const OPTIONS: { label: string; value: Period }[] = [
  { label: 'Day', value: 'day' },
  { label: 'MTD', value: 'mtd' },
  { label: 'YTD', value: 'ytd' },
];

export function PeriodToggle({ value, onChange }: PeriodToggleProps) {
  return (
    <div className="inline-flex border border-[#e5e5e5] rounded overflow-hidden text-xs font-medium">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={clsx(
            'px-3 py-1.5 transition-colors',
            value === opt.value
              ? 'bg-[#1a1a1a] text-white'
              : 'bg-white text-[#6b7280] hover:bg-[#f5f5f5]',
            'border-r border-[#e5e5e5] last:border-r-0',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
