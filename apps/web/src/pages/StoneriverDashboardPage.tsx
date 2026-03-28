/**
 * Stoneriver HG — Daily Performance Dashboard.
 * Morning view for leadership to review all 21 properties at a glance.
 */

import { useState, useMemo } from 'react';
import { format, subDays } from 'date-fns';
import { fmtCurrency, fmtNumber } from '../lib/formatters';
import { usePerformanceData } from '../hooks/usePerformanceData';
import { useSparklineData } from '../hooks/useSparklineData';
import { PerformanceTable } from '../components/stoneriver/PerformanceTable';
import { PropertySparklines } from '../components/stoneriver/PropertySparklines';
import { PeriodToggle } from '../components/stoneriver/PeriodToggle';
import { ExportButton } from '../components/stoneriver/ExportButton';
import type { Period, DailyHotelPerformance } from '../components/stoneriver/types';
import { getRevenue } from '../components/stoneriver/types';

const DEFAULT_DATE = format(subDays(new Date(), 1), 'yyyy-MM-dd');

export function StoneriverDashboardPage() {
  const [selectedDate, setSelectedDate] = useState(DEFAULT_DATE);
  const [period, setPeriod] = useState<Period>('day');

  const { data: perfData = [], isLoading } = usePerformanceData(selectedDate);
  const { data: sparklineData = [] } = useSparklineData(selectedDate);

  // Build O(1) lookup map by property name
  const dataMap = useMemo<Map<string, DailyHotelPerformance>>(() => {
    return new Map(perfData.map((r) => [r.property_name, r]));
  }, [perfData]);

  // Portfolio summary pills
  const totalRoomsSold = perfData.reduce((s, r) => s + (r.total_rooms_sold ?? 0), 0);
  const totalRevenue = perfData.reduce((s, r) => s + (getRevenue(r, period) ?? 0), 0);

  return (
    <div className="min-h-screen bg-white">
      {/* Header bar */}
      <div className="sticky top-0 z-10 border-b border-[#e5e5e5] bg-white px-6 py-3 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-[#1a1a1a] tracking-tight">
            Stoneriver HG — Daily Performance
          </h1>
        </div>

        {/* Date picker */}
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          max={DEFAULT_DATE}
          className="text-xs border border-[#e5e5e5] px-2 py-1.5 text-[#1a1a1a] bg-white focus:outline-none focus:ring-1 focus:ring-[#1a1a1a] rounded"
        />

        {/* Period toggle */}
        <PeriodToggle value={period} onChange={setPeriod} />

        {/* Portfolio summary pills */}
        {perfData.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-1 bg-[#f5f5f5] text-[#1a1a1a] font-semibold rounded tabular-nums">
              {fmtNumber(totalRoomsSold)} rooms sold
            </span>
            <span className="px-2 py-1 bg-[#f5f5f5] text-[#1a1a1a] font-semibold rounded tabular-nums">
              {fmtCurrency(totalRevenue)} revenue
            </span>
          </div>
        )}

        {/* Export */}
        <ExportButton date={selectedDate} period={period} dataMap={dataMap} />
      </div>

      {/* Main content */}
      <div className="px-6 py-4 space-y-8">
        {/* Performance table */}
        <PerformanceTable
          dataMap={dataMap}
          period={period}
          sparklineData={sparklineData}
          isLoading={isLoading}
          selectedDate={selectedDate}
        />

        {/* Sparklines panel — hidden on mobile */}
        <div className="hidden sm:block">
          <PropertySparklines sparklineData={sparklineData} />
        </div>
      </div>
    </div>
  );
}
