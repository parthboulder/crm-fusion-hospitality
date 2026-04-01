/**
 * Subtotal and grand total rows for the Revenue Flash table.
 * Shows aggregated Day / MTD / YTD values across all 20 columns.
 */

import { fmtCurrency, fmtRate, fmtPct, fmtNumber, fmtVariance } from '../../lib/formatters';
import type { DailyHotelPerformance } from './types';

interface TotalRowProps {
  rows: DailyHotelPerformance[];
  label?: string;
  showDay?: boolean;
  showMtd?: boolean;
  showYtd?: boolean;
}

function computeTotals(rows: DailyHotelPerformance[]) {
  if (rows.length === 0) return null;

  const sum = (fn: (r: DailyHotelPerformance) => number | null) =>
    rows.reduce((s, r) => { const v = fn(r); return v != null ? s + v : s; }, 0);

  // Simple average (matching Revenue Flash PDF methodology)
  const avg = (fn: (r: DailyHotelPerformance) => number | null) => {
    const vals = rows.map(fn).filter((v): v is number => v != null);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  return {
    occ_day: avg((r) => r.occupancy_day),
    adr_day: avg((r) => r.adr_day),
    revpar_day: avg((r) => r.revpar_day),
    rooms_sold: sum((r) => r.total_rooms_sold),
    rev_day: sum((r) => r.revenue_day),
    ooo: sum((r) => r.ooo_rooms),
    py_rev_day: sum((r) => r.py_revenue_day),

    occ_mtd: avg((r) => r.occupancy_mtd),
    adr_mtd: avg((r) => r.adr_mtd),
    revpar_mtd: avg((r) => r.revpar_mtd),
    rev_mtd: sum((r) => r.revenue_mtd),
    py_rev_mtd: sum((r) => r.py_revenue_mtd),

    occ_ytd: avg((r) => r.occupancy_ytd),
    adr_ytd: avg((r) => r.adr_ytd),
    revpar_ytd: avg((r) => r.revpar_ytd),
    rev_ytd: sum((r) => r.revenue_ytd),
    py_rev_ytd: sum((r) => r.py_revenue_ytd),
  };
}

const tc = 'px-1.5 py-1 text-right tabular-nums text-[11px] font-semibold text-[#1a1a1a]';
const tcMuted = `${tc} text-[#6b7280]`;

function varianceColor(current: number | null, prior: number | null): string {
  if (current == null || prior == null) return 'text-[#9ca3af]';
  return current - prior >= 0 ? 'text-[#1a1a1a]' : 'text-[#dc2626]';
}

function TotalCells({ t, showDay = true, showMtd = true, showYtd = true }: {
  t: NonNullable<ReturnType<typeof computeTotals>>;
  showDay?: boolean;
  showMtd?: boolean;
  showYtd?: boolean;
}) {
  return (
    <>
      {/* Day */}
      {showDay && <>
        <td className={`${tc} border-l border-[#e5e5e5]`}>{t.occ_day != null ? fmtPct(t.occ_day) : '—'}</td>
        <td className={tc}>{t.adr_day != null ? fmtRate(t.adr_day) : '—'}</td>
        <td className={tc}>{t.revpar_day != null ? fmtRate(t.revpar_day) : '—'}</td>
        <td className={tc}>{fmtNumber(t.rooms_sold)}</td>
        <td className={tc}>{fmtCurrency(t.rev_day)}</td>
        <td className={`${tc} ${t.ooo > 0 ? 'text-[#dc2626]' : ''}`}>{fmtNumber(t.ooo)}</td>
        <td className={tcMuted}>{fmtCurrency(t.py_rev_day)}</td>
        <td className={`${tc} ${varianceColor(t.rev_day, t.py_rev_day)}`}>
          {fmtVariance(t.rev_day, t.py_rev_day)}
        </td>
      </>}
      {/* MTD */}
      {showMtd && <>
        <td className={`${tc} border-l border-[#d1d5db]`}>{t.occ_mtd != null ? fmtPct(t.occ_mtd) : '—'}</td>
        <td className={tc}>{t.adr_mtd != null ? fmtRate(t.adr_mtd) : '—'}</td>
        <td className={tc}>{t.revpar_mtd != null ? fmtRate(t.revpar_mtd) : '—'}</td>
        <td className={tc}>{fmtCurrency(t.rev_mtd)}</td>
        <td className={tcMuted}>{fmtCurrency(t.py_rev_mtd)}</td>
        <td className={`${tc} ${varianceColor(t.rev_mtd, t.py_rev_mtd)}`}>
          {fmtVariance(t.rev_mtd, t.py_rev_mtd)}
        </td>
      </>}
      {/* YTD */}
      {showYtd && <>
        <td className={`${tc} border-l border-[#d1d5db]`}>{t.occ_ytd != null ? fmtPct(t.occ_ytd) : '—'}</td>
        <td className={tc}>{t.adr_ytd != null ? fmtRate(t.adr_ytd) : '—'}</td>
        <td className={tc}>{t.revpar_ytd != null ? fmtRate(t.revpar_ytd) : '—'}</td>
        <td className={tc}>{fmtCurrency(t.rev_ytd)}</td>
        <td className={tcMuted}>{fmtCurrency(t.py_rev_ytd)}</td>
        <td className={`${tc} ${varianceColor(t.rev_ytd, t.py_rev_ytd)}`}>
          {fmtVariance(t.rev_ytd, t.py_rev_ytd)}
        </td>
      </>}
    </>
  );
}

/** Brand subtotal row */
export function SubtotalRow({ rows, label, showDay = true, showMtd = true, showYtd = true }: TotalRowProps) {
  const t = computeTotals(rows);
  if (!t) return null;

  return (
    <tr className="bg-[#f3f4f6] border-b border-[#d1d5db]">
      <td className="px-2 py-1 text-[11px] font-bold text-[#374151] sticky left-0 bg-[#f3f4f6] z-[5] border-r border-[#e5e5e5] whitespace-nowrap">
        {label ?? 'Subtotal'}
      </td>
      <TotalCells t={t} showDay={showDay} showMtd={showMtd} showYtd={showYtd} />
    </tr>
  );
}

/** Grand total row at the bottom of the table */
export function GrandTotalRow({ rows, showDay = true, showMtd = true, showYtd = true }: TotalRowProps) {
  const t = computeTotals(rows);
  if (!t) return null;

  return (
    <tr className="bg-[#e5e7eb] border-t-2 border-[#374151] font-bold">
      <td className="px-2 py-1.5 text-[11px] font-bold text-[#111827] sticky left-0 bg-[#e5e7eb] z-[5] border-r border-[#d1d5db] whitespace-nowrap">
        TOTAL: All Properties
      </td>
      <TotalCells t={t} showDay={showDay} showMtd={showMtd} showYtd={showYtd} />
    </tr>
  );
}
