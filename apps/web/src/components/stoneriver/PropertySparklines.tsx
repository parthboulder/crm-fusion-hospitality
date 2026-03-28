/**
 * 30-day trend sparkline cards — one card per property, 3-4 across.
 * Each card shows inline SVG sparklines for Occupancy %, RevPAR, and Revenue.
 */

import { fmtCurrency, fmtPct } from '../../lib/formatters';
import type { SparklinePoint } from './types';
import { PROPERTIES } from '../../constants/stoneriver-properties';

interface PropertySparklinesProps {
  sparklineData: SparklinePoint[];
}

const SPARK_W = 72;
const SPARK_H = 22;

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const clean = values.filter((v) => v != null && !isNaN(v));
  if (clean.length < 2) {
    return <span className="text-[10px] text-[#e5e5e5]">—</span>;
  }

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = max - min || 1;

  const points = clean
    .map((v, i) => {
      const x = (i / (clean.length - 1)) * SPARK_W;
      const y = SPARK_H - ((v - min) / range) * (SPARK_H - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const last = clean[clean.length - 1];
  const first = clean[0];
  const trend = last >= first ? color : '#dc2626';

  return (
    <svg
      width={SPARK_W}
      height={SPARK_H}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      className="overflow-visible"
    >
      <polyline
        points={points}
        fill="none"
        stroke={trend}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SparkCard({ propertyName, points }: { propertyName: string; points: SparklinePoint[] }) {
  const occValues = points.map((p) => p.occupancy_day ?? NaN).filter((v) => !isNaN(v));
  const revparValues = points.map((p) => p.revpar_day ?? NaN).filter((v) => !isNaN(v));
  const revenueValues = points.map((p) => p.revenue_day ?? NaN).filter((v) => !isNaN(v));

  const lastOcc = occValues[occValues.length - 1];
  const lastRevpar = revparValues[revparValues.length - 1];
  const lastRev = revenueValues[revenueValues.length - 1];

  return (
    <div className="border border-[#e5e5e5] bg-white p-3">
      <p
        className="text-[11px] font-semibold text-[#1a1a1a] truncate mb-2"
        title={propertyName}
      >
        {propertyName}
      </p>

      <div className="space-y-2">
        {/* Occupancy */}
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="text-[9px] uppercase tracking-wide text-[#6b7280]">Occ %</p>
            <p className="text-xs font-semibold tabular-nums text-[#1a1a1a]">
              {lastOcc != null ? fmtPct(lastOcc) : '—'}
            </p>
          </div>
          <Sparkline values={occValues} color="#16a34a" />
        </div>

        {/* RevPAR */}
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="text-[9px] uppercase tracking-wide text-[#6b7280]">RevPAR</p>
            <p className="text-xs font-semibold tabular-nums text-[#1a1a1a]">
              {lastRevpar != null ? fmtCurrency(lastRevpar) : '—'}
            </p>
          </div>
          <Sparkline values={revparValues} color="#1a1a1a" />
        </div>

        {/* Revenue */}
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="text-[9px] uppercase tracking-wide text-[#6b7280]">Revenue</p>
            <p className="text-xs font-semibold tabular-nums text-[#1a1a1a]">
              {lastRev != null ? fmtCurrency(lastRev) : '—'}
            </p>
          </div>
          <Sparkline values={revenueValues} color="#6b7280" />
        </div>
      </div>
    </div>
  );
}

export function PropertySparklines({ sparklineData }: PropertySparklinesProps) {
  return (
    <div>
      <h2 className="text-xs font-bold uppercase tracking-widest text-[#6b7280] mb-3">
        30-Day Trends
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {PROPERTIES.map((prop) => (
          <SparkCard
            key={prop.name}
            propertyName={prop.name}
            points={sparklineData.filter((p) => p.property_name === prop.name)}
          />
        ))}
      </div>
    </div>
  );
}
