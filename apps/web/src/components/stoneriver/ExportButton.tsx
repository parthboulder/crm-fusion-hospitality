/**
 * CSV export for the current Stoneriver performance table view.
 */

import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { fmtCurrency, fmtPct, fmtNumber, yoyChange } from '../../lib/formatters';
import type { DailyHotelPerformance, Period } from './types';
import { getOcc, getAdr, getRevpar, getRevenue, getPyRevenue } from './types';
import { PROPERTIES } from '../../constants/stoneriver-properties';

interface ExportButtonProps {
  date: string;
  period: Period;
  dataMap: Map<string, DailyHotelPerformance>;
}

export function ExportButton({ date, period, dataMap }: ExportButtonProps) {
  function handleExport() {
    const headers = [
      'Property', 'Group', 'State',
      'Occ %', 'ADR', 'RevPAR', 'Rooms Sold', 'OOO',
      'Revenue', 'PY Revenue', 'Rev Δ %',
    ];

    const rows = PROPERTIES.map((prop) => {
      const row = dataMap.get(prop.name);
      if (!row) {
        return [prop.name, prop.group, prop.state, '', '', '', '', '', 'No report', '', ''];
      }
      const occ = getOcc(row, period);
      const adr = getAdr(row, period);
      const revpar = getRevpar(row, period);
      const rev = getRevenue(row, period);
      const py = getPyRevenue(row, period);
      const delta = yoyChange(rev, py);
      return [
        prop.name,
        prop.group,
        prop.state,
        occ != null ? fmtPct(occ) : '',
        adr != null ? fmtCurrency(adr) : '',
        revpar != null ? fmtCurrency(revpar) : '',
        row.total_rooms_sold != null ? fmtNumber(row.total_rooms_sold) : '',
        row.ooo_rooms != null ? String(row.ooo_rooms) : '',
        rev != null ? fmtCurrency(rev) : 'No report',
        py != null ? fmtCurrency(py) : '—',
        delta != null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%` : '—',
      ];
    });

    const csv = [headers, ...rows]
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stoneriver-performance-${date}-${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      onClick={handleExport}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#6b7280] border border-[#e5e5e5] bg-white hover:bg-[#f5f5f5] transition-colors rounded"
    >
      <ArrowDownTrayIcon className="w-3.5 h-3.5" />
      Export CSV
    </button>
  );
}
