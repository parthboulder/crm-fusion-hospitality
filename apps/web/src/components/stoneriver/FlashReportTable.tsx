/**
 * Flash Report table — single-date snapshot with operating metrics,
 * room status, and AR aging, grouped by brand.
 * Supports section toggle (All / Operating / Room Status / AR).
 */

import { useState } from 'react';
import type { FlashReportProperty } from './flash-report-types';
import { PROPERTIES, GROUP_ORDER } from '../../constants/stoneriver-properties';
import { FlashReportRow } from './FlashReportRow';
import { FlashSubtotalRow, FlashGrandTotalRow } from './FlashReportTotalsRow';

export type FlashViewSection = 'all' | 'operating' | 'rooms' | 'ar';

interface FlashReportTableProps {
  data: FlashReportProperty[];
  isLoading: boolean;
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

const btnBase = 'px-3 py-1 text-[11px] font-semibold rounded transition-colors';
const btnActive = `${btnBase} bg-[#1f2937] text-white`;
const btnInactive = `${btnBase} bg-[#f3f4f6] text-[#6b7280] hover:bg-[#e5e7eb]`;

export function FlashReportTable({
  data,
  isLoading,
  displayDate,
  filterCities = [],
  filterRegions = [],
}: FlashReportTableProps) {
  const [viewSection, setViewSection] = useState<FlashViewSection>('all');

  if (isLoading) {
    return (
      <div className="space-y-2 py-4">
        {Array.from({ length: 21 }).map((_, i) => (
          <div key={i} className="h-7 bg-[#f5f5f5] animate-pulse rounded" />
        ))}
      </div>
    );
  }

  const dataMap = new Map(data.map((d) => [d.property_name, d]));
  const showOps = viewSection === 'all' || viewSection === 'operating';
  const showRooms = viewSection === 'all' || viewSection === 'rooms';
  const showAR = viewSection === 'all' || viewSection === 'ar';

  const colCount = 1 + (showOps ? 5 : 0) + (showRooms ? 5 : 0) + (showAR ? 6 : 0);

  const filteredProperties = PROPERTIES.filter((p) => {
    if (filterCities.length > 0 && !filterCities.includes(p.city)) return false;
    if (filterRegions.length > 0 && !filterRegions.includes(p.region)) return false;
    return true;
  });

  const allPresentData: FlashReportProperty[] = [];
  for (const prop of filteredProperties) {
    const d = dataMap.get(prop.name);
    if (d) allPresentData.push(d);
  }

  return (
    <div>
      {/* Section toggle buttons */}
      <div className="flex items-center gap-1.5 mb-3">
        {([
          ['all', 'All'],
          ['operating', 'Operating Metrics'],
          ['rooms', 'Room Status'],
          ['ar', 'Accounts Receivable'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setViewSection(key)}
            className={viewSection === key ? btnActive : btnInactive}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto border border-[#e5e5e5] rounded" id="flash-report-table">
        <table className="w-full text-[11px] border-collapse" style={{ fontVariantNumeric: 'tabular-nums', minWidth: viewSection === 'all' ? 1500 : 600 }}>
          <thead>
            <tr className="bg-[#1f2937]">
              <th className="px-2 py-1 text-center text-[10px] font-bold text-white bg-[#1f2937] sticky left-0 z-10 min-w-[180px]">
                {displayDate}
              </th>
              {showOps && <SectionHeader label="Operating Metrics" colSpan={5} />}
              {showRooms && <SectionHeader label="Room Status" colSpan={5} />}
              {showAR && <SectionHeader label="Accounts Receivable" colSpan={6} />}
            </tr>
            <tr className="bg-[#f9fafb] border-b border-[#e5e5e5]">
              <th className="sticky left-0 bg-[#f9fafb] z-10 min-w-[180px]" />
              {showOps && <>
                <th className={`${thRight} border-l border-[#e5e5e5]`}>Occ%</th>
                <th className={thRight}>ADR</th>
                <th className={thRight}>RevPAR</th>
                <th className={thRight}>Room Rev</th>
                <th className={thRight}>F&B Rev</th>
              </>}
              {showRooms && <>
                <th className={`${thRight} border-l border-[#e5e5e5]`}>Occupied</th>
                <th className={thRight}>OOO</th>
                <th className={thRight}>Dirty</th>
                <th className={thRight}>Res Today</th>
                <th className={thRight}>No Shows</th>
              </>}
              {showAR && <>
                <th className={`${thRight} border-l border-[#e5e5e5]`}>{'<=30d'}</th>
                <th className={thRight}>{'>30d'}</th>
                <th className={thRight}>{'>60d'}</th>
                <th className={thRight}>{'>90d'}</th>
                <th className={thRight}>{'>120d'}</th>
                <th className={thRight}>Total AR</th>
              </>}
            </tr>
          </thead>
          {GROUP_ORDER.map((group) => {
            const groupProps = filteredProperties.filter((p) => p.group === group);
            if (groupProps.length === 0) return null;

            const groupData = groupProps
              .map((p) => dataMap.get(p.name))
              .filter((d): d is FlashReportProperty => d != null);

            return (
              <tbody key={group}>
                <tr className="bg-[#f3f4f6] border-t border-[#d1d5db]">
                  <td colSpan={colCount} className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-[#374151]">
                    {group}
                  </td>
                </tr>
                {groupProps.map((prop) => (
                  <FlashReportRow
                    key={prop.name}
                    property={prop}
                    data={dataMap.get(prop.name) ?? null}
                    showOps={showOps}
                    showRooms={showRooms}
                    showAR={showAR}
                  />
                ))}
                {groupData.length > 0 && (
                  <FlashSubtotalRow rows={groupData} label={`${group} Total`} showOps={showOps} showRooms={showRooms} showAR={showAR} />
                )}
              </tbody>
            );
          })}
          <tfoot>
            <FlashGrandTotalRow rows={allPresentData} showOps={showOps} showRooms={showRooms} showAR={showAR} />
          </tfoot>
        </table>
      </div>
    </div>
  );
}
