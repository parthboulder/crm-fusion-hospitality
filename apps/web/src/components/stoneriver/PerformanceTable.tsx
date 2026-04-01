/**
 * Revenue Flash–style performance table.
 * Shows Day / MTD / YTD side-by-side, grouped by brand with subtotals.
 * Supports period toggle (All / Day / MTD / YTD) and PDF export.
 */

import { useState, useRef } from 'react';
import type { DailyHotelPerformance, SparklinePoint } from './types';
import { PROPERTIES, GROUP_ORDER } from '../../constants/stoneriver-properties';
import { RevenueFlashRow } from './PerformanceTableRow';
import { SubtotalRow, GrandTotalRow } from './PortfolioTotalsRow';

export type ViewPeriod = 'all' | 'day' | 'mtd' | 'ytd';

interface PerformanceTableProps {
  dataMap: Map<string, DailyHotelPerformance>;
  sparklineData: SparklinePoint[];
  isLoading: boolean;
  selectedDate: string;
  displayDate: string;
  filterCities?: string[];
  filterRegions?: string[];
}

const thBase = 'px-1.5 py-1.5 text-[9px] font-semibold uppercase tracking-wide text-[#6b7280] whitespace-nowrap';
const thRight = `${thBase} text-right`;

function SectionHeader({ label, colSpan }: { label: string; colSpan: number }) {
  return (
    <th colSpan={colSpan} className="px-1.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white bg-[#374151] text-center border-l border-[#4b5563]">
      {label}
    </th>
  );
}

const periodBtnBase = 'px-3 py-1 text-[11px] font-semibold rounded transition-colors';
const periodBtnActive = `${periodBtnBase} bg-[#1f2937] text-white`;
const periodBtnInactive = `${periodBtnBase} bg-[#f3f4f6] text-[#6b7280] hover:bg-[#e5e7eb]`;

export function PerformanceTable({
  dataMap,
  sparklineData,
  isLoading,
  selectedDate,
  displayDate,
  filterCities = [],
  filterRegions = [],
}: PerformanceTableProps) {
  const [viewPeriod, setViewPeriod] = useState<ViewPeriod>('all');
  const tableRef = useRef<HTMLDivElement>(null);

  if (isLoading) {
    return (
      <div className="space-y-2 py-4">
        {Array.from({ length: 21 }).map((_, i) => (
          <div key={i} className="h-7 bg-[#f5f5f5] animate-pulse rounded" />
        ))}
      </div>
    );
  }

  const noData = dataMap.size === 0;
  const showDay = viewPeriod === 'all' || viewPeriod === 'day';
  const showMtd = viewPeriod === 'all' || viewPeriod === 'mtd';
  const showYtd = viewPeriod === 'all' || viewPeriod === 'ytd';

  const colCount = 1 + (showDay ? 8 : 0) + (showMtd ? 6 : 0) + (showYtd ? 6 : 0);

  // Filter properties by city/region (multi-select: empty array = show all)
  const filteredProperties = PROPERTIES.filter((p) => {
    if (filterCities.length > 0 && !filterCities.includes(p.city)) return false;
    if (filterRegions.length > 0 && !filterRegions.includes(p.region)) return false;
    return true;
  });

  // Build rows by group
  const allPresentData: DailyHotelPerformance[] = [];
  for (const prop of filteredProperties) {
    const d = dataMap.get(prop.name);
    if (d) allPresentData.push(d);
  }

  return (
    <div>
      {/* Period toggle buttons */}
      <div className="flex items-center gap-1.5 mb-3">
        {(['all', 'day', 'mtd', 'ytd'] as const).map((p) => (
          <button
            key={p}
            onClick={() => setViewPeriod(p)}
            className={viewPeriod === p ? periodBtnActive : periodBtnInactive}
          >
            {p === 'all' ? 'All' : p === 'day' ? 'Day' : p === 'mtd' ? 'MTD' : 'YTD'}
          </button>
        ))}
      </div>

      {noData && (
        <p className="text-xs text-[#6b7280] mb-2">
          No data for {selectedDate}. Reports typically arrive by 7:00 AM CT.
        </p>
      )}

      <div ref={tableRef} className="overflow-x-auto border border-[#e5e5e5] rounded" id="revenue-flash-table">
        <table className="w-full text-[11px] border-collapse" style={{ fontVariantNumeric: 'tabular-nums', minWidth: viewPeriod === 'all' ? 1400 : 600 }}>
          {/* Two-level header: section labels, then column labels */}
          <thead>
            <tr className="bg-[#1f2937]">
              <th className="px-2 py-1 text-center text-[10px] font-bold text-white bg-[#1f2937] sticky left-0 z-10 min-w-[180px]">
                {displayDate}
              </th>
              {showDay && <SectionHeader label="Date" colSpan={8} />}
              {showMtd && <SectionHeader label="Month to Date" colSpan={6} />}
              {showYtd && <SectionHeader label="Year to Date" colSpan={6} />}
            </tr>
            <tr className="bg-[#f9fafb] border-b border-[#e5e5e5]">
              <th className="sticky left-0 bg-[#f9fafb] z-10 min-w-[180px]" />
              {/* Day columns */}
              {showDay && <>
                <th className={`${thRight} border-l border-[#e5e5e5]`}>Occ%</th>
                <th className={thRight}>ADR</th>
                <th className={thRight}>RevPAR</th>
                <th className={thRight}>Rooms</th>
                <th className={thRight}>Revenue</th>
                <th className={thRight}>OOO</th>
                <th className={thRight}>PY Rev</th>
                <th className={thRight}>Variance</th>
              </>}
              {/* MTD columns */}
              {showMtd && <>
                <th className={`${thRight} border-l border-[#d1d5db]`}>Occ%</th>
                <th className={thRight}>ADR</th>
                <th className={thRight}>RevPAR</th>
                <th className={thRight}>Revenue</th>
                <th className={thRight}>PY Rev</th>
                <th className={thRight}>Variance</th>
              </>}
              {/* YTD columns */}
              {showYtd && <>
                <th className={`${thRight} border-l border-[#d1d5db]`}>Occ%</th>
                <th className={thRight}>ADR</th>
                <th className={thRight}>RevPAR</th>
                <th className={thRight}>Revenue</th>
                <th className={thRight}>PY Rev</th>
                <th className={thRight}>Variance</th>
              </>}
            </tr>
          </thead>
          {GROUP_ORDER.map((group) => {
            const groupProps = filteredProperties.filter((p) => p.group === group);
            if (groupProps.length === 0) return null;

            const groupData = groupProps
              .map((p) => dataMap.get(p.name))
              .filter((d): d is DailyHotelPerformance => d != null);

            return (
              <tbody key={group}>
                {/* Brand group header */}
                <tr className="bg-[#f3f4f6] border-t border-[#d1d5db]">
                  <td
                    colSpan={colCount}
                    className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-[#374151]"
                  >
                    {group}
                  </td>
                </tr>
                {/* Property rows */}
                {groupProps.map((prop) => (
                  <RevenueFlashRow
                    key={prop.name}
                    property={prop}
                    data={dataMap.get(prop.name) ?? null}
                    sparklinePoints={sparklineData.filter(
                      (p) => p.property_name === prop.name,
                    )}
                    showDay={showDay}
                    showMtd={showMtd}
                    showYtd={showYtd}
                  />
                ))}
                {/* Brand subtotal */}
                {groupData.length > 0 && (
                  <SubtotalRow rows={groupData} label={`${group} Total`} showDay={showDay} showMtd={showMtd} showYtd={showYtd} />
                )}
              </tbody>
            );
          })}
          {/* Grand total */}
          <tfoot>
            <GrandTotalRow rows={allPresentData} showDay={showDay} showMtd={showMtd} showYtd={showYtd} />
          </tfoot>
        </table>
      </div>
    </div>
  );
}
