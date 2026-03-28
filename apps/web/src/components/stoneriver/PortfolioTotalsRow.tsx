/**
 * Sticky portfolio totals row — weighted averages and sums across all properties.
 */

import { fmtCurrency, fmtPct, fmtNumber, yoyChange, fmtYoy } from '../../lib/formatters';
import type { DailyHotelPerformance, Period } from './types';
import { getOcc, getAdr, getRevpar, getRevenue, getPyRevenue } from './types';

interface PortfolioTotalsRowProps {
  rows: DailyHotelPerformance[];
  period: Period;
}

export function PortfolioTotalsRow({ rows, period }: PortfolioTotalsRowProps) {
  const present = rows.filter((r) => r != null);

  // Weighted occupancy: sum(occ * available) / sum(available) — fall back to mean if no available data
  const totalAvailable = present.reduce((s, r) => s + (r.total_rooms_available ?? 0), 0);
  const weightedOcc =
    totalAvailable > 0
      ? present.reduce((s, r) => {
          const occ = getOcc(r, period) ?? 0;
          return s + occ * (r.total_rooms_available ?? 0);
        }, 0) / totalAvailable
      : present.length > 0
        ? present.reduce((s, r) => s + (getOcc(r, period) ?? 0), 0) / present.length
        : null;

  // For day period: ADR = total_revenue / total_rooms_sold; RevPAR = total_revenue / total_available
  // For MTD/YTD: simple mean of available values (rooms sold not tracked by period)
  const totalRoomsSold = present.reduce((s, r) => s + (r.total_rooms_sold ?? 0), 0);
  const totalRev = present.reduce((s, r) => s + (getRevenue(r, period) ?? 0), 0);
  const totalPyRev = present.reduce((s, r) => {
    const py = getPyRevenue(r, period);
    return py != null ? s + py : s;
  }, 0);
  const pyCount = present.filter((r) => getPyRevenue(r, period) != null).length;
  const totalOoo = present.reduce((s, r) => s + (r.ooo_rooms ?? 0), 0);

  const portfolioAdr =
    period === 'day' && totalRoomsSold > 0
      ? totalRev / totalRoomsSold
      : present.length > 0
        ? present.reduce((s, r) => s + (getAdr(r, period) ?? 0), 0) / present.filter((r) => getAdr(r, period) != null).length
        : null;

  const portfolioRevpar =
    period === 'day' && totalAvailable > 0
      ? totalRev / totalAvailable
      : present.length > 0
        ? present.reduce((s, r) => s + (getRevpar(r, period) ?? 0), 0) / present.filter((r) => getRevpar(r, period) != null).length
        : null;

  const pyTotal = pyCount > 0 ? totalPyRev : null;
  const delta = yoyChange(totalRev, pyTotal);

  const cellCls = 'px-3 py-2 text-right tabular-nums text-xs font-semibold text-[#1a1a1a]';
  const deltaCls = delta == null ? 'text-[#6b7280]' : delta >= 0 ? 'text-[#16a34a]' : 'text-[#dc2626]';

  return (
    <tr className="sticky bottom-0 bg-[#fafafa] border-t-2 border-[#1a1a1a]">
      <td className="px-3 py-2 text-xs font-bold text-[#1a1a1a] whitespace-nowrap">
        Portfolio Total
      </td>
      <td className="px-3 py-2 text-xs text-[#6b7280]">{present.length} properties</td>
      <td className={cellCls}>
        {weightedOcc != null ? fmtPct(weightedOcc) : '—'}
      </td>
      <td className={cellCls}>
        {portfolioAdr != null && !isNaN(portfolioAdr) ? fmtCurrency(portfolioAdr) : '—'}
      </td>
      <td className={cellCls}>
        {portfolioRevpar != null && !isNaN(portfolioRevpar) ? fmtCurrency(portfolioRevpar) : '—'}
      </td>
      <td className={cellCls}>
        {period === 'day' ? fmtNumber(totalRoomsSold) : '—'}
      </td>
      <td className={`${cellCls} ${totalOoo > 0 ? 'text-[#dc2626]' : ''}`}>
        {fmtNumber(totalOoo)}
      </td>
      <td className={cellCls}>{fmtCurrency(totalRev)}</td>
      <td className={`${cellCls} text-[#6b7280]`}>
        {pyTotal != null ? fmtCurrency(pyTotal) : '—'}
      </td>
      <td className={`${cellCls} ${deltaCls}`}>
        {delta != null ? fmtYoy(delta) : '—'}
      </td>
    </tr>
  );
}
