/**
 * Revenue Flash–style performance table.
 * Shows Day / MTD / YTD side-by-side, grouped by brand with subtotals.
 * Supports period toggle (All / Day / MTD / YTD) and PDF export.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
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
  const tableRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  /**
   * Click-and-drag horizontal scroll for the wide table.
   *
   * Ref callback instead of useRef+useEffect because the component
   * early-returns a loading skeleton while `isLoading` is true; the scroll
   * container isn't in the DOM on first render, and a static effect dep
   * array would miss the later mount. A ref callback fires exactly when
   * the node attaches/detaches.
   *
   * Wheel-scroll is intentionally NOT hijacked — the page keeps its
   * normal vertical scroll behavior. Only click+drag pans horizontally.
   *
   * We only commit to panning after the cursor moves more than 6px, so
   * regular clicks on number cells still open the PDF preview. When a
   * drag has happened, the trailing `click` is swallowed so cell buttons
   * don't fire on release.
   */
  const attachScrollHandlers = useCallback((el: HTMLDivElement | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    tableRef.current = el;
    if (!el) return;

    const updateCursor = () => {
      el.style.cursor = el.scrollWidth > el.clientWidth ? 'grab' : '';
    };
    updateCursor();
    const ro = new ResizeObserver(updateCursor);
    ro.observe(el);

    let pressing = false;
    let panning = false;
    let startX = 0;
    let startY = 0;
    let startScroll = 0;
    const THRESHOLD_PX = 6;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest('input, textarea, select')) return;
      if (el.scrollWidth <= el.clientWidth) return;

      pressing = true;
      panning = false;
      startX = e.clientX;
      startY = e.clientY;
      startScroll = el.scrollLeft;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!pressing) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!panning) {
        if (Math.hypot(dx, dy) < THRESHOLD_PX) return;
        panning = true;
        el.style.cursor = 'grabbing';
        el.style.userSelect = 'none';
        document.body.style.userSelect = 'none';
      }
      el.scrollLeft = startScroll - dx;
      e.preventDefault();
    };

    const onMouseUp = () => {
      if (!pressing) return;
      const wasPanning = panning;
      pressing = false;
      panning = false;
      el.style.userSelect = '';
      document.body.style.userSelect = '';
      updateCursor();

      if (wasPanning) {
        const swallow = (ev: MouseEvent) => {
          ev.stopPropagation();
          ev.preventDefault();
          window.removeEventListener('click', swallow, true);
        };
        window.addEventListener('click', swallow, true);
      }
    };

    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    cleanupRef.current = () => {
      ro.disconnect();
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      el.style.cursor = '';
      el.style.userSelect = '';
      document.body.style.userSelect = '';
    };
  }, []);

  useEffect(() => () => cleanupRef.current?.(), []);

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

      <div ref={attachScrollHandlers} className="overflow-x-auto border border-[#e5e5e5] rounded" id="revenue-flash-table">
        {/* border-collapse: separate (not collapse) — required for sticky <td>/<th> to pin during horizontal scroll on Chromium. */}
        <table className="w-full text-[11px]" style={{ borderCollapse: 'separate', borderSpacing: 0, fontVariantNumeric: 'tabular-nums', minWidth: viewPeriod === 'all' ? 1400 : 600 }}>
          {/* Two-level header: section labels, then column labels */}
          <thead>
            <tr className="bg-[#1f2937]">
              <th className="px-2 py-1 text-center text-[10px] font-bold text-white bg-[#1f2937] min-w-[180px]">
                {displayDate}
              </th>
              {showDay && <SectionHeader label="Date" colSpan={8} />}
              {showMtd && <SectionHeader label="Month to Date" colSpan={6} />}
              {showYtd && <SectionHeader label="Year to Date" colSpan={6} />}
            </tr>
            <tr className="bg-[#f9fafb] border-b border-[#e5e5e5]">
              <th className="bg-[#f9fafb] min-w-[180px]" />
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
