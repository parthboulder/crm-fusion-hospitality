/**
 * Stoneriver HG — Revenue Flash Dashboard.
 * Morning view for leadership to review all 21 properties at a glance.
 * Matches the Revenue Flash PDF layout: Day / MTD / YTD side-by-side.
 */

import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { fmtCurrency, fmtNumber } from '../lib/formatters';
import { usePerformanceData } from '../hooks/usePerformanceData';
import { useSparklineData } from '../hooks/useSparklineData';
import { useLatestDataDate } from '../hooks/useLatestDataDate';
import { PerformanceTable } from '../components/stoneriver/PerformanceTable';
import { PropertySparklines } from '../components/stoneriver/PropertySparklines';
import { ExportButton } from '../components/stoneriver/ExportButton';
import { PdfExportButton } from '../components/stoneriver/PdfExportButton';
import { MultiSelect } from '../components/stoneriver/MultiSelect';
import { PdfSearchBar } from '../components/stoneriver/PdfSearchBar';
import { PdfSearchProvider } from '../components/stoneriver/PdfSearchContext';
import { CITIES, REGIONS } from '../constants/stoneriver-properties';
import type { DailyHotelPerformance } from '../components/stoneriver/types';

const TODAY = format(new Date(), 'yyyy-MM-dd');

export function StoneriverDashboardPage() {
  const { data: latestDate } = useLatestDataDate('daily_hotel_performance');
  const [selectedDate, setSelectedDate] = useState('');
  const [filterCities, setFilterCities] = useState<string[]>([]);
  const [filterRegions, setFilterRegions] = useState<string[]>([]);

  // Auto-select the latest date that has data
  useEffect(() => {
    if (latestDate && !selectedDate) setSelectedDate(latestDate);
  }, [latestDate, selectedDate]);

  const { data: perfData = [], isLoading } = usePerformanceData(selectedDate);
  const { data: sparklineData = [] } = useSparklineData(selectedDate);

  // Build O(1) lookup map by property name
  const dataMap = useMemo<Map<string, DailyHotelPerformance>>(() => {
    return new Map(perfData.map((r) => [r.property_name, r]));
  }, [perfData]);

  // Portfolio summary pills
  const totalRoomsSold = perfData.reduce((s, r) => s + (r.total_rooms_sold ?? 0), 0);
  const totalRevenue = perfData.reduce((s, r) => s + (r.revenue_day ?? 0), 0);

  // Format the selected date for the header
  const displayDate = (() => {
    try {
      const d = new Date(selectedDate + 'T00:00:00');
      return format(d, 'MM/dd/yyyy');
    } catch {
      return selectedDate;
    }
  })();

  return (
    <div className="min-h-screen bg-white">
      {/* Header bar */}
      <div className="sticky top-0 z-20 border-b border-[#e5e5e5] bg-white px-6 py-3 flex flex-wrap items-center gap-3">
        <Link to="/stoneriver" className="text-[#6b7280] hover:text-[#1a1a1a] transition-colors">
          <ArrowLeftIcon className="w-4 h-4" />
        </Link>
        <div className="shrink-0">
          <h1 className="text-sm font-bold text-[#1a1a1a] tracking-tight whitespace-nowrap">
            Revenue Flash
            <span className="ml-2 text-[#2563eb]">{displayDate}</span>
          </h1>
        </div>
        <div className="flex-1" />

        {/* Date picker */}
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          max={TODAY}
          className="text-xs border border-[#e5e5e5] px-2 py-1.5 text-[#1a1a1a] bg-white focus:outline-none focus:ring-1 focus:ring-[#1a1a1a] rounded"
        />

        {/* Region multi-select filter */}
        <MultiSelect
          label="All Regions"
          options={REGIONS}
          selected={filterRegions}
          onChange={setFilterRegions}
        />

        {/* City multi-select filter */}
        <MultiSelect
          label="All Cities"
          options={CITIES}
          selected={filterCities}
          onChange={setFilterCities}
        />

        {/* Portfolio summary pills */}
        {perfData.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-1 bg-[#f5f5f5] text-[#1a1a1a] font-semibold rounded tabular-nums">
              {perfData.length} properties
            </span>
            <span className="px-2 py-1 bg-[#f5f5f5] text-[#1a1a1a] font-semibold rounded tabular-nums">
              {fmtNumber(totalRoomsSold)} rooms
            </span>
            <span className="px-2 py-1 bg-[#f5f5f5] text-[#1a1a1a] font-semibold rounded tabular-nums">
              {fmtCurrency(totalRevenue)} day rev
            </span>
          </div>
        )}

        {/* Search PDFs */}
        <PdfSearchBar date={selectedDate} />

        {/* Export */}
        <ExportButton date={selectedDate} period="day" dataMap={dataMap} />
        <PdfExportButton date={selectedDate} />
      </div>

      {/* Main content — wrapped in PdfSearchProvider so cell clicks can open viewer */}
      <PdfSearchProvider date={selectedDate}>
        <div className="px-4 py-4 space-y-8">
          {/* Revenue Flash table — all periods */}
          <PerformanceTable
            dataMap={dataMap}
            sparklineData={sparklineData}
            isLoading={isLoading}
            selectedDate={selectedDate}
            displayDate={displayDate}
            filterCities={filterCities}
            filterRegions={filterRegions}
          />

          {/* Sparklines panel — hidden on mobile */}
          <div className="hidden sm:block">
            <PropertySparklines sparklineData={sparklineData} />
          </div>
        </div>
      </PdfSearchProvider>
    </div>
  );
}
