/**
 * Main property performance table with sorting, group toggling, and sticky totals.
 */

import { useState } from 'react';
import { clsx } from 'clsx';
import type { DailyHotelPerformance, Period, SortCol, SparklinePoint } from './types';
import { getOcc, getAdr, getRevpar, getRevenue, getPyRevenue } from './types';
import { yoyChange } from '../../lib/formatters';
import { PROPERTIES, GROUP_ORDER } from '../../constants/stoneriver-properties';
import { PerformanceTableRow } from './PerformanceTableRow';
import { PortfolioTotalsRow } from './PortfolioTotalsRow';

interface PerformanceTableProps {
  dataMap: Map<string, DailyHotelPerformance>;
  period: Period;
  sparklineData: SparklinePoint[];
  isLoading: boolean;
  selectedDate: string;
}

type SortDir = 'asc' | 'desc';

function getSortValue(
  data: DailyHotelPerformance | null,
  col: SortCol,
  period: Period,
): number {
  if (!data) return -Infinity;
  switch (col) {
    case 'property_name': return 0; // handled separately
    case 'occupancy': return getOcc(data, period) ?? -Infinity;
    case 'adr': return getAdr(data, period) ?? -Infinity;
    case 'revpar': return getRevpar(data, period) ?? -Infinity;
    case 'total_rooms_sold': return data.total_rooms_sold ?? -Infinity;
    case 'ooo_rooms': return data.ooo_rooms ?? -Infinity;
    case 'revenue': return getRevenue(data, period) ?? -Infinity;
    case 'py_revenue': return getPyRevenue(data, period) ?? -Infinity;
    case 'rev_delta': {
      const rev = getRevenue(data, period);
      const py = getPyRevenue(data, period);
      return yoyChange(rev, py) ?? -Infinity;
    }
    default: return -Infinity;
  }
}

const COLUMNS: { col: SortCol; label: string; align: 'left' | 'right' }[] = [
  { col: 'property_name', label: 'Property', align: 'left' },
  { col: 'property_name', label: 'Group', align: 'left' }, // not sortable by group
  { col: 'occupancy', label: 'Occ %', align: 'right' },
  { col: 'adr', label: 'ADR', align: 'right' },
  { col: 'revpar', label: 'RevPAR', align: 'right' },
  { col: 'total_rooms_sold', label: 'Rooms Sold', align: 'right' },
  { col: 'ooo_rooms', label: 'OOO', align: 'right' },
  { col: 'revenue', label: 'Revenue', align: 'right' },
  { col: 'py_revenue', label: 'PY Revenue', align: 'right' },
  { col: 'rev_delta', label: 'Rev Δ %', align: 'right' },
];

export function PerformanceTable({
  dataMap,
  period,
  sparklineData,
  isLoading,
  selectedDate,
}: PerformanceTableProps) {
  const [sortCol, setSortCol] = useState<SortCol>('revenue');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [grouped, setGrouped] = useState(false);

  function handleSort(col: SortCol) {
    if (col === 'property_name' && COLUMNS.indexOf(COLUMNS.find((c) => c.label === 'Group')!) === -1) return;
    if (sortCol === col) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
  }

  const allRows = PROPERTIES.map((prop) => ({
    property: prop,
    data: dataMap.get(prop.name) ?? null,
  }));

  const sortedRows = [...allRows].sort((a, b) => {
    if (sortCol === 'property_name') {
      return sortDir === 'asc'
        ? a.property.name.localeCompare(b.property.name)
        : b.property.name.localeCompare(a.property.name);
    }
    const av = getSortValue(a.data, sortCol, period);
    const bv = getSortValue(b.data, sortCol, period);
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  const presentData = allRows.flatMap((r) => (r.data ? [r.data] : []));

  const thCls = (col: SortCol, align: 'left' | 'right') =>
    clsx(
      'px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[#6b7280] cursor-pointer select-none whitespace-nowrap',
      align === 'right' ? 'text-right' : 'text-left',
      sortCol === col && 'text-[#1a1a1a]',
    );

  function SortIcon({ col }: { col: SortCol }) {
    if (sortCol !== col) return <span className="ml-0.5 text-[#e5e5e5]">↕</span>;
    return <span className="ml-0.5">{sortDir === 'desc' ? '↓' : '↑'}</span>;
  }

  if (isLoading) {
    return (
      <div className="space-y-2 py-4">
        {Array.from({ length: 21 }).map((_, i) => (
          <div key={i} className="h-8 bg-[#f5f5f5] animate-pulse rounded" />
        ))}
      </div>
    );
  }

  const noData = dataMap.size === 0;

  return (
    <div>
      {/* Group toggle */}
      <div className="flex items-center justify-between mb-2">
        <label className="flex items-center gap-2 text-xs text-[#6b7280] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={grouped}
            onChange={(e) => setGrouped(e.target.checked)}
            className="rounded border-[#e5e5e5]"
          />
          Group by brand
        </label>
        {noData && (
          <p className="text-xs text-[#6b7280]">
            No data for {selectedDate}. Reports typically arrive by 7:00 AM CT.
          </p>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse" style={{ fontVariantNumeric: 'tabular-nums' }}>
          <thead className="bg-[#fafafa] border-b border-[#e5e5e5]">
            <tr>
              {COLUMNS.map((c, i) => (
                <th
                  key={i}
                  onClick={() => handleSort(c.col)}
                  className={thCls(c.col, c.align)}
                >
                  {c.label}
                  {c.label !== 'Group' && <SortIcon col={c.col} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped
              ? GROUP_ORDER.map((group) => {
                  const groupRows = sortedRows.filter((r) => r.property.group === group);
                  if (groupRows.length === 0) return null;
                  const groupData = groupRows.flatMap((r) => (r.data ? [r.data] : []));

                  return (
                    <>
                      {/* Group header */}
                      <tr key={`group-${group}`} className="bg-[#fafafa] border-t-2 border-[#e5e5e5]">
                        <td
                          colSpan={10}
                          className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-[#6b7280]"
                        >
                          {group}
                        </td>
                      </tr>
                      {groupRows.map((row) => (
                        <PerformanceTableRow
                          key={row.property.name}
                          property={row.property}
                          data={row.data}
                          period={period}
                          sparklinePoints={sparklineData.filter(
                            (p) => p.property_name === row.property.name,
                          )}
                        />
                      ))}
                      {/* Group subtotals */}
                      {groupData.length > 0 && (
                        <PortfolioTotalsRow rows={groupData} period={period} />
                      )}
                    </>
                  );
                })
              : sortedRows.map((row) => (
                  <PerformanceTableRow
                    key={row.property.name}
                    property={row.property}
                    data={row.data}
                    period={period}
                    sparklinePoints={sparklineData.filter(
                      (p) => p.property_name === row.property.name,
                    )}
                  />
                ))}

            {/* Portfolio totals */}
            <PortfolioTotalsRow rows={presentData} period={period} />
          </tbody>
        </table>
      </div>
    </div>
  );
}
