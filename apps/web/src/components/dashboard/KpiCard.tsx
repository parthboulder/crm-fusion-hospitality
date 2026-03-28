/**
 * Single KPI tile used in the portfolio overview strip.
 */

import { clsx } from 'clsx';
import { ArrowTrendingUpIcon, ArrowTrendingDownIcon } from '@heroicons/react/20/solid';

interface KpiCardProps {
  label: string;
  value: string;
  subValue?: string | undefined;
  change?: number | null | undefined;
  changeLabel?: string | undefined;
  loading?: boolean | undefined;
}

export function KpiCard({ label, value, subValue, change, changeLabel, loading }: KpiCardProps) {
  const isPositive = change != null && change >= 0;

  return (
    <div className="card px-4 py-3">
      <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider">{label}</p>

      {loading ? (
        <div className="mt-2 h-6 w-24 bg-neutral-100 rounded animate-pulse" />
      ) : (
        <p className="mt-1 text-xl font-semibold text-neutral-900 tabular-nums">{value}</p>
      )}

      {subValue && (
        <p className="text-xs text-neutral-500 mt-0.5">{subValue}</p>
      )}

      {change != null && (
        <div
          className={clsx(
            'inline-flex items-center gap-1 mt-2 text-xs font-medium',
            isPositive ? 'text-success-600' : 'text-danger-600',
          )}
        >
          {isPositive ? (
            <ArrowTrendingUpIcon className="w-3.5 h-3.5" />
          ) : (
            <ArrowTrendingDownIcon className="w-3.5 h-3.5" />
          )}
          <span>{isPositive ? '+' : ''}{change.toFixed(1)}% {changeLabel ?? 'vs PY'}</span>
        </div>
      )}
    </div>
  );
}
