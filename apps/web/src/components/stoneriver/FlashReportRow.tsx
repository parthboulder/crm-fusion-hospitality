/**
 * Single property row in the Flash Report table.
 */

import { clsx } from 'clsx';
import { fmtCurrency, fmtRate, fmtPct, fmtNumber } from '../../lib/formatters';
import type { FlashReportProperty } from './flash-report-types';
import type { Property } from '../../constants/stoneriver-properties';

interface FlashReportRowProps {
  property: Property;
  data: FlashReportProperty | null;
  showOps?: boolean;
  showRooms?: boolean;
  showAR?: boolean;
}

const cell = 'px-1.5 py-1 text-right tabular-nums text-[11px] text-[#1a1a1a]';
const cellMuted = `${cell} text-[#6b7280]`;

function occColor(v: number | null): string {
  if (v == null) return 'text-[#9ca3af]';
  if (v >= 70) return 'text-[#1a1a1a] font-semibold';
  if (v >= 50) return 'text-[#6b7280] font-semibold';
  return 'text-[#dc2626] font-semibold';
}

function arColor(v: number | null): string {
  if (v == null || v === 0) return 'text-[#9ca3af]';
  if (v > 50000) return 'text-[#dc2626] font-semibold';
  if (v > 10000) return 'text-[#6b7280]';
  return 'text-[#1a1a1a]';
}

export function FlashReportRow({ property, data, showOps = true, showRooms = true, showAR = true }: FlashReportRowProps) {
  const d = data;

  return (
    <tr
      className={clsx(
        'border-b border-[#e5e5e5] text-[11px]',
        data ? '' : 'opacity-40',
      )}
    >
      {/* Property name — sticky */}
      <td className="px-2 py-1 sticky left-0 bg-white z-[5] border-r border-[#e5e5e5]">
        <span className="font-medium text-[#1a1a1a] truncate block max-w-[180px]" title={property.name}>
          {property.name}
        </span>
        <span className="text-[9px] text-[#9ca3af] truncate block">{property.entityName}</span>
      </td>

      {/* Operating metrics */}
      {showOps && <>
        <td className={`${cell} border-l border-[#e5e5e5] ${occColor(d?.occupancy_pct ?? null)}`}>
          {d?.occupancy_pct != null ? fmtPct(d.occupancy_pct) : '—'}
        </td>
        <td className={cell}>{d?.adr != null ? fmtRate(d.adr) : '—'}</td>
        <td className={cell}>{d?.revpar != null ? fmtRate(d.revpar) : '—'}</td>
        <td className={`${cell} font-medium`}>{d?.room_revenue != null ? fmtCurrency(d.room_revenue) : '—'}</td>
        <td className={cell}>{d?.fb_revenue != null ? fmtCurrency(d.fb_revenue) : '—'}</td>
      </>}

      {/* Room stats */}
      {showRooms && <>
        <td className={`${cell} border-l border-[#e5e5e5]`}>{d?.rooms_occupied != null ? fmtNumber(d.rooms_occupied) : '—'}</td>
        <td className={clsx(cell, d?.rooms_ooo && d.rooms_ooo > 0 ? 'text-[#dc2626] font-semibold' : 'text-[#9ca3af]')}>
          {d?.rooms_ooo != null ? d.rooms_ooo : '—'}
        </td>
        <td className={cell}>{d?.rooms_dirty != null ? fmtNumber(d.rooms_dirty) : '—'}</td>
        <td className={cell}>{d?.room_nights_reserved != null ? fmtNumber(d.room_nights_reserved) : '—'}</td>
        <td className={clsx(cell, d?.no_shows && d.no_shows > 0 ? 'text-[#dc2626]' : 'text-[#9ca3af]')}>
          {d?.no_shows != null ? d.no_shows : '—'}
        </td>
      </>}

      {/* AR aging */}
      {showAR && <>
        <td className={`${cell} border-l border-[#e5e5e5]`}>{d?.ar_up_to_30 != null ? fmtCurrency(d.ar_up_to_30) : '—'}</td>
        <td className={cell}>{d?.ar_over_30 != null ? fmtCurrency(d.ar_over_30) : '—'}</td>
        <td className={cell}>{d?.ar_over_60 != null ? fmtCurrency(d.ar_over_60) : '—'}</td>
        <td className={`${cell} ${arColor(d?.ar_over_90 ?? null)}`}>{d?.ar_over_90 != null ? fmtCurrency(d.ar_over_90) : '—'}</td>
        <td className={`${cell} ${arColor(d?.ar_over_120 ?? null)}`}>{d?.ar_over_120 != null ? fmtCurrency(d.ar_over_120) : '—'}</td>
        <td className={`${cell} font-semibold ${arColor(d?.ar_total ?? null)}`}>{d?.ar_total != null ? fmtCurrency(d.ar_total) : '—'}</td>
      </>}
    </tr>
  );
}
