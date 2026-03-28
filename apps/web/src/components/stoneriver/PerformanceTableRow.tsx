/**
 * Single property row in the Stoneriver performance table.
 * Expands on click to show full Day/MTD/YTD detail + last 7 days mini table.
 */

import { useState } from 'react';
import { clsx } from 'clsx';
import { fmtCurrency, fmtPct, fmtNumber, yoyChange, fmtYoy, fmtDate } from '../../lib/formatters';
import type { DailyHotelPerformance, Period, SparklinePoint } from './types';
import { getOcc, getAdr, getRevpar, getRevenue, getPyRevenue } from './types';
import type { Property } from '../../constants/stoneriver-properties';

interface PerformanceTableRowProps {
  property: Property;
  data: DailyHotelPerformance | null;
  period: Period;
  sparklinePoints: SparklinePoint[];
}

function occColor(occ: number | null): string {
  if (occ == null) return 'text-[#6b7280]';
  if (occ >= 70) return 'text-[#16a34a] font-semibold';
  if (occ >= 50) return 'text-[#ca8a04] font-semibold';
  return 'text-[#dc2626] font-semibold';
}

function MetricCol({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center min-w-[80px]">
      <p className="text-[10px] text-[#6b7280] uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-[#1a1a1a]">{value}</p>
    </div>
  );
}

function ExpandedDetail({ data, sparklinePoints }: { data: DailyHotelPerformance; sparklinePoints: SparklinePoint[] }) {
  const last7 = sparklinePoints.slice(-7);

  return (
    <tr>
      <td colSpan={10} className="px-3 pb-3 pt-0 bg-[#fafafa] border-b border-[#e5e5e5]">
        {/* Day / MTD / YTD side by side */}
        <div className="grid grid-cols-3 gap-4 py-3 border-b border-[#e5e5e5] mb-3">
          {(['day', 'mtd', 'ytd'] as Period[]).map((p) => (
            <div key={p} className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#6b7280]">
                {p === 'day' ? 'Day' : p === 'mtd' ? 'Month to Date' : 'Year to Date'}
              </p>
              <div className="flex flex-wrap gap-3">
                <MetricCol label="Occ %" value={getOcc(data, p) != null ? fmtPct(getOcc(data, p)) : '—'} />
                <MetricCol label="ADR" value={getAdr(data, p) != null ? fmtCurrency(getAdr(data, p)) : '—'} />
                <MetricCol label="RevPAR" value={getRevpar(data, p) != null ? fmtCurrency(getRevpar(data, p)) : '—'} />
                <MetricCol label="Revenue" value={getRevenue(data, p) != null ? fmtCurrency(getRevenue(data, p)) : '—'} />
                <MetricCol label="PY Rev" value={getPyRevenue(data, p) != null ? fmtCurrency(getPyRevenue(data, p)) : '—'} />
              </div>
            </div>
          ))}
        </div>

        {/* Last 7 days mini table */}
        {last7.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#6b7280] mb-2">Last 7 Days</p>
            <table className="text-xs w-auto">
              <thead>
                <tr className="text-[#6b7280]">
                  <th className="text-left pr-4 pb-1 font-medium">Date</th>
                  <th className="text-right pr-4 pb-1 font-medium tabular-nums">Occ %</th>
                  <th className="text-right pr-4 pb-1 font-medium tabular-nums">RevPAR</th>
                  <th className="text-right pb-1 font-medium tabular-nums">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {last7.map((pt) => (
                  <tr key={pt.report_date} className="border-t border-[#e5e5e5]">
                    <td className="pr-4 py-1 text-[#6b7280]">{fmtDate(pt.report_date)}</td>
                    <td className="pr-4 py-1 text-right tabular-nums">{pt.occupancy_day != null ? fmtPct(pt.occupancy_day) : '—'}</td>
                    <td className="pr-4 py-1 text-right tabular-nums">{pt.revpar_day != null ? fmtCurrency(pt.revpar_day) : '—'}</td>
                    <td className="py-1 text-right tabular-nums">{pt.revenue_day != null ? fmtCurrency(pt.revenue_day) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </td>
    </tr>
  );
}

export function PerformanceTableRow({ property, data, period, sparklinePoints }: PerformanceTableRowProps) {
  const [expanded, setExpanded] = useState(false);

  const occ = data ? getOcc(data, period) : null;
  const adr = data ? getAdr(data, period) : null;
  const revpar = data ? getRevpar(data, period) : null;
  const rev = data ? getRevenue(data, period) : null;
  const py = data ? getPyRevenue(data, period) : null;
  const delta = yoyChange(rev, py);

  const cellCls = 'px-3 py-2 text-right tabular-nums text-[#1a1a1a] text-xs';
  const deltaCls = delta == null ? 'text-[#6b7280]' : delta >= 0 ? 'text-[#16a34a]' : 'text-[#dc2626]';

  return (
    <>
      <tr
        onClick={() => data && setExpanded((v) => !v)}
        className={clsx(
          'border-b border-[#e5e5e5] text-xs transition-colors',
          data ? 'cursor-pointer hover:bg-[#f5f5f5]' : 'opacity-50 cursor-default',
          expanded && 'bg-[#f5f5f5]',
        )}
      >
        {/* Property name */}
        <td className="px-3 py-2">
          <p className="font-medium text-[#1a1a1a] truncate max-w-[180px]" title={property.name}>
            {property.name}
          </p>
        </td>

        {/* Group */}
        <td className="px-3 py-2">
          <span className="text-[#6b7280] text-[11px]">{property.group}</span>
        </td>

        {/* Occupancy */}
        <td className={`${cellCls} ${occColor(occ)}`}>
          {occ != null ? fmtPct(occ) : '—'}
        </td>

        {/* ADR */}
        <td className={cellCls}>{adr != null ? fmtCurrency(adr) : '—'}</td>

        {/* RevPAR */}
        <td className={cellCls}>{revpar != null ? fmtCurrency(revpar) : '—'}</td>

        {/* Rooms Sold (day only) */}
        <td className={cellCls}>
          {period === 'day' && data?.total_rooms_sold != null ? fmtNumber(data.total_rooms_sold) : '—'}
        </td>

        {/* OOO */}
        <td className={clsx(cellCls, data?.ooo_rooms && data.ooo_rooms > 0 ? 'text-[#dc2626] font-semibold' : '')}>
          {data?.ooo_rooms != null ? data.ooo_rooms : '—'}
        </td>

        {/* Revenue */}
        <td className={cellCls}>
          {rev != null ? fmtCurrency(rev) : <span className="text-[#6b7280]">No report</span>}
        </td>

        {/* PY Revenue */}
        <td className={`${cellCls} text-[#6b7280]`}>
          {py != null ? fmtCurrency(py) : '—'}
        </td>

        {/* Rev Δ % */}
        <td className={`${cellCls} ${deltaCls}`}>
          {delta != null ? fmtYoy(delta) : '—'}
        </td>
      </tr>

      {expanded && data && (
        <ExpandedDetail data={data} sparklinePoints={sparklinePoints} />
      )}
    </>
  );
}
