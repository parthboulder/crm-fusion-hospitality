/**
 * Single property row in the Revenue Flash–style table.
 * Shows all Day / MTD / YTD values in one row (21 columns).
 */

import { useState } from 'react';
import { clsx } from 'clsx';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { fmtCurrency, fmtRate, fmtPct, fmtNumber, fmtVariance, fmtDate } from '../../lib/formatters';
import { usePdfSearch } from './PdfSearchContext';
import type { DailyHotelPerformance, SparklinePoint } from './types';
import type { Property } from '../../constants/stoneriver-properties';

interface RevenueFlashRowProps {
  property: Property;
  data: DailyHotelPerformance | null;
  sparklinePoints: SparklinePoint[];
  showDay?: boolean;
  showMtd?: boolean;
  showYtd?: boolean;
}

const cell = 'px-1.5 py-1 text-right tabular-nums text-[11px] text-[#1a1a1a]';
const cellMuted = `${cell} text-[#6b7280]`;

function occColor(occ: number | null): string {
  if (occ == null) return 'text-[#9ca3af]';
  if (occ >= 70) return 'text-[#1a1a1a] font-semibold';
  if (occ >= 50) return 'text-[#6b7280] font-semibold';
  return 'text-[#dc2626] font-semibold';
}

function adrColor(adr: number | null): string {
  if (adr == null) return 'text-[#9ca3af]';
  if (adr >= 130) return 'text-[#1a1a1a] font-semibold';
  if (adr >= 100) return 'text-[#1a1a1a] font-semibold';
  return 'text-[#1a1a1a]';
}

function revparColor(revpar: number | null): string {
  if (revpar == null) return 'text-[#9ca3af]';
  if (revpar >= 120) return 'text-[#1a1a1a] font-semibold';
  if (revpar >= 80) return 'text-[#1a1a1a]';
  return 'text-[#1a1a1a]';
}

function revenueColor(rev: number | null): string {
  if (rev == null) return 'text-[#9ca3af]';
  if (rev >= 15000) return 'text-[#1a1a1a] font-semibold';
  if (rev >= 10000) return 'text-[#1a1a1a] font-medium';
  return 'text-[#1a1a1a]';
}

function varianceColor(current: number | null, prior: number | null): string {
  if (current == null || prior == null) return 'text-[#9ca3af]';
  const diff = current - prior;
  if (diff >= 0) return 'text-[#1a1a1a]';
  return 'text-[#dc2626]';
}

function ExpandedDetail({ data, sparklinePoints }: { data: DailyHotelPerformance; sparklinePoints: SparklinePoint[] }) {
  const last7 = sparklinePoints.slice(-7);
  if (last7.length === 0) return null;

  return (
    <tr>
      <td colSpan={21} className="px-3 pb-3 pt-1 bg-[#fafafa] border-b border-[#e5e5e5]">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#6b7280] mb-1">Last 7 Days</p>
        <table className="text-[11px] w-auto">
          <thead>
            <tr className="text-[#6b7280]">
              <th className="text-left pr-4 pb-1 font-medium">Date</th>
              <th className="text-right pr-4 pb-1 font-medium">Occ%</th>
              <th className="text-right pr-4 pb-1 font-medium">RevPAR</th>
              <th className="text-right pb-1 font-medium">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {last7.map((pt) => (
              <tr key={pt.report_date} className="border-t border-[#e5e5e5]">
                <td className="pr-4 py-0.5 text-[#6b7280]">{fmtDate(pt.report_date)}</td>
                <td className="pr-4 py-0.5 text-right">
                  <ClickablePct value={pt.occupancy_day ?? null} />
                </td>
                <td className="pr-4 py-0.5 text-right">
                  <ClickableValue value={pt.revpar_day ?? null} formatted={pt.revpar_day != null ? fmtCurrency(pt.revpar_day) : '—'} />
                </td>
                <td className="py-0.5 text-right">
                  <ClickableValue value={pt.revenue_day ?? null} formatted={pt.revenue_day != null ? fmtCurrency(pt.revenue_day) : '—'} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </td>
    </tr>
  );
}

/** Wrapper that makes a cell value clickable → searches PDFs for that value */
function ClickableValue({ value, formatted, className }: { value: number | null; formatted: string; className?: string }) {
  const { searchAndOpen } = usePdfSearch();
  if (value == null) return <span className={className}>—</span>;
  return (
    <span
      className={clsx(className, 'cursor-pointer hover:underline hover:decoration-dotted')}
      onClick={(e) => { e.stopPropagation(); searchAndOpen(String(Math.round(value))); }}
      title="Click to find in source PDFs"
    >
      {formatted}
    </span>
  );
}

/**
 * Percent value → click searches PDFs using the raw percent number (e.g. 47.0),
 * which is how these values appear in the source documents.
 */
function ClickablePct({ value, className }: { value: number | null; className?: string }) {
  const { searchAndOpen } = usePdfSearch();
  if (value == null) return <span className={className}>—</span>;
  return (
    <span
      className={clsx(className, 'cursor-pointer hover:underline hover:decoration-dotted')}
      onClick={(e) => { e.stopPropagation(); searchAndOpen(value.toFixed(1)); }}
      title="Click to find in source PDFs"
    >
      {fmtPct(value)}
    </span>
  );
}

export function RevenueFlashRow({ property, data, sparklinePoints, showDay = true, showMtd = true, showYtd = true }: RevenueFlashRowProps) {
  const [expanded, setExpanded] = useState(false);
  const d = data;

  const canExpand = !!data;

  return (
    <>
      <tr
        className={clsx(
          'border-b border-[#e5e5e5] text-[11px] transition-colors',
          data ? 'hover:bg-[#f9fafb]' : 'opacity-40',
          expanded && 'bg-[#f5f5f5]',
        )}
      >
        {/* Property name — scrolls with the table per user request */}
        <td
          className="px-2 py-1 bg-white border-r border-[#e5e5e5]"
          style={{ minWidth: 200, width: 200 }}
        >
          <div className="flex items-center gap-1.5">
            {canExpand ? (
              <button
                onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
                title={expanded ? 'Hide last 7 days' : 'Show last 7 days'}
                aria-label={expanded ? 'Collapse details' : 'Expand details'}
                className="shrink-0 p-0.5 text-[#9ca3af] hover:text-[#1a1a1a] hover:bg-[#e5e7eb] rounded transition-colors"
              >
                {expanded
                  ? <ChevronDownIcon className="w-3 h-3" />
                  : <ChevronRightIcon className="w-3 h-3" />}
              </button>
            ) : (
              <span className="w-3 h-3 shrink-0" />
            )}
            <span className="font-medium text-[#1a1a1a] truncate" title={property.name}>
              {property.name}
            </span>
          </div>
        </td>

        {/* ─── Day section ─── */}
        {showDay && <>
          <td className={`${cell} border-l border-[#e5e5e5] ${occColor(d?.occupancy_day ?? null)}`}>
            <ClickablePct value={d?.occupancy_day ?? null} />
          </td>
          <td className={`${cell} ${adrColor(d?.adr_day ?? null)}`}>
            <ClickableValue value={d?.adr_day ?? null} formatted={d?.adr_day != null ? fmtRate(d.adr_day) : '—'} />
          </td>
          <td className={`${cell} ${revparColor(d?.revpar_day ?? null)}`}>
            <ClickableValue value={d?.revpar_day ?? null} formatted={d?.revpar_day != null ? fmtRate(d.revpar_day) : '—'} />
          </td>
          <td className={cell}>
            <ClickableValue value={d?.total_rooms_sold ?? null} formatted={d?.total_rooms_sold != null ? fmtNumber(d.total_rooms_sold) : '—'} />
          </td>
          <td className={`${cell} ${revenueColor(d?.revenue_day ?? null)}`}>
            <ClickableValue value={d?.revenue_day ?? null} formatted={d?.revenue_day != null ? fmtCurrency(d.revenue_day) : '—'} />
          </td>
          <td className={clsx(cell, d?.ooo_rooms && d.ooo_rooms > 0 ? 'text-[#dc2626] font-semibold' : 'text-[#9ca3af]')}>
            <ClickableValue value={d?.ooo_rooms ?? null} formatted={d?.ooo_rooms != null ? String(d.ooo_rooms) : '—'} />
          </td>
          <td className={cellMuted}>
            <ClickableValue value={d?.py_revenue_day ?? null} formatted={d?.py_revenue_day != null ? fmtCurrency(d.py_revenue_day) : '—'} />
          </td>
          <td className={`${cell} ${varianceColor(d?.revenue_day ?? null, d?.py_revenue_day ?? null)}`}>
            {fmtVariance(d?.revenue_day ?? null, d?.py_revenue_day ?? null)}
          </td>
        </>}

        {/* ─── MTD section ─── */}
        {showMtd && <>
          <td className={`${cell} border-l border-[#d1d5db] ${occColor(d?.occupancy_mtd ?? null)}`}>
            <ClickablePct value={d?.occupancy_mtd ?? null} />
          </td>
          <td className={`${cell} ${adrColor(d?.adr_mtd ?? null)}`}>
            <ClickableValue value={d?.adr_mtd ?? null} formatted={d?.adr_mtd != null ? fmtRate(d.adr_mtd) : '—'} />
          </td>
          <td className={`${cell} ${revparColor(d?.revpar_mtd ?? null)}`}>
            <ClickableValue value={d?.revpar_mtd ?? null} formatted={d?.revpar_mtd != null ? fmtRate(d.revpar_mtd) : '—'} />
          </td>
          <td className={`${cell} ${revenueColor(d?.revenue_mtd ?? null)}`}>
            <ClickableValue value={d?.revenue_mtd ?? null} formatted={d?.revenue_mtd != null ? fmtCurrency(d.revenue_mtd) : '—'} />
          </td>
          <td className={cellMuted}>
            <ClickableValue value={d?.py_revenue_mtd ?? null} formatted={d?.py_revenue_mtd != null ? fmtCurrency(d.py_revenue_mtd) : '—'} />
          </td>
          <td className={`${cell} ${varianceColor(d?.revenue_mtd ?? null, d?.py_revenue_mtd ?? null)}`}>
            {fmtVariance(d?.revenue_mtd ?? null, d?.py_revenue_mtd ?? null)}
          </td>
        </>}

        {/* ─── YTD section ─── */}
        {showYtd && <>
          <td className={`${cell} border-l border-[#d1d5db] ${occColor(d?.occupancy_ytd ?? null)}`}>
            <ClickablePct value={d?.occupancy_ytd ?? null} />
          </td>
          <td className={`${cell} ${adrColor(d?.adr_ytd ?? null)}`}>
            <ClickableValue value={d?.adr_ytd ?? null} formatted={d?.adr_ytd != null ? fmtRate(d.adr_ytd) : '—'} />
          </td>
          <td className={`${cell} ${revparColor(d?.revpar_ytd ?? null)}`}>
            <ClickableValue value={d?.revpar_ytd ?? null} formatted={d?.revpar_ytd != null ? fmtRate(d.revpar_ytd) : '—'} />
          </td>
          <td className={`${cell} ${revenueColor(d?.revenue_ytd ?? null)}`}>
            <ClickableValue value={d?.revenue_ytd ?? null} formatted={d?.revenue_ytd != null ? fmtCurrency(d.revenue_ytd) : '—'} />
          </td>
          <td className={cellMuted}>
            <ClickableValue value={d?.py_revenue_ytd ?? null} formatted={d?.py_revenue_ytd != null ? fmtCurrency(d.py_revenue_ytd) : '—'} />
          </td>
          <td className={`${cell} ${varianceColor(d?.revenue_ytd ?? null, d?.py_revenue_ytd ?? null)}`}>
            {fmtVariance(d?.revenue_ytd ?? null, d?.py_revenue_ytd ?? null)}
          </td>
        </>}
      </tr>

      {expanded && data && (
        <ExpandedDetail data={data} sparklinePoints={sparklinePoints} />
      )}
    </>
  );
}
