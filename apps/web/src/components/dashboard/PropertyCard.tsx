/**
 * Property summary card in the portfolio grid.
 */

import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { ExclamationTriangleIcon, ArrowTrendingUpIcon, ArrowTrendingDownIcon } from '@heroicons/react/20/solid';
import { fmtCurrency, fmtPct, yoyChange } from '../../lib/formatters';

interface PropertyCardProps {
  id: string;
  name: string;
  brand?: string | null;
  city?: string | null;
  state?: string | null;
  latestMetrics?: {
    occupancyPct?: number | null;
    adr?: number | null;
    revpar?: number | null;
    totalRevenue?: number | null;
    pyTotalRevenue?: number | null;
    pyRevpar?: number | null;
  } | null | undefined;
  openAlerts: number;
}

export function PropertyCard({
  id, name, brand, city, state, latestMetrics, openAlerts,
}: PropertyCardProps) {
  const revChange = yoyChange(
    latestMetrics?.totalRevenue ?? null,
    latestMetrics?.pyTotalRevenue ?? null,
  );
  const revparChange = yoyChange(
    latestMetrics?.revpar ?? null,
    latestMetrics?.pyRevpar ?? null,
  );

  return (
    <Link
      to={`/properties/${id}`}
      className="card p-4 hover:bg-neutral-50 transition-colors block group"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-neutral-800 group-hover:text-neutral-900 transition-colors truncate">
            {name}
          </h3>
          <p className="text-xs text-neutral-400 mt-0.5">
            {[brand, city, state].filter(Boolean).join(' · ')}
          </p>
        </div>
        {openAlerts > 0 && (
          <span className="inline-flex items-center gap-1 shrink-0 px-1.5 py-0.5 text-xs font-medium text-danger-600 bg-danger-50 rounded border border-danger-200/60">
            <ExclamationTriangleIcon className="w-3 h-3" />
            {openAlerts}
          </span>
        )}
      </div>

      {/* Metrics grid */}
      <dl className="mt-3 grid grid-cols-3 gap-3">
        <MetricCell label="Occupancy" value={fmtPct(latestMetrics?.occupancyPct)} />
        <MetricCell label="ADR" value={fmtCurrency(latestMetrics?.adr)} />
        <MetricCell label="RevPAR" value={fmtCurrency(latestMetrics?.revpar)} />
      </dl>

      {/* Revenue + trend */}
      <div className="mt-3 pt-3 border-t border-neutral-100 flex items-center justify-between">
        <div>
          <p className="text-xs text-neutral-400">Revenue</p>
          <p className="text-sm font-semibold text-neutral-800 tabular-nums">
            {fmtCurrency(latestMetrics?.totalRevenue)}
          </p>
        </div>
        {revChange != null && (
          <div
            className={clsx(
              'inline-flex items-center gap-1 text-xs font-medium',
              revChange >= 0 ? 'text-success-600' : 'text-danger-600',
            )}
          >
            {revChange >= 0 ? (
              <ArrowTrendingUpIcon className="w-3.5 h-3.5" />
            ) : (
              <ArrowTrendingDownIcon className="w-3.5 h-3.5" />
            )}
            {revChange >= 0 ? '+' : ''}{revChange.toFixed(1)}% YoY
          </div>
        )}
      </div>
    </Link>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-neutral-400">{label}</dt>
      <dd className="text-sm font-medium text-neutral-800 tabular-nums mt-0.5">{value}</dd>
    </div>
  );
}
