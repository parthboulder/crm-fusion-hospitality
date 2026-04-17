/**
 * Flash Report Dashboard — comprehensive daily property snapshot with
 * F&B revenue, room status, reservations, and AR aging.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeftIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { fmtCurrency } from '../lib/formatters';
import { useFlashReportData } from '../hooks/useFlashReportData';
import { useLatestDataDate } from '../hooks/useLatestDataDate';
import { FlashReportTable } from '../components/stoneriver/FlashReportTable';
import { MultiSelect } from '../components/stoneriver/MultiSelect';
import { CITIES, REGIONS } from '../constants/stoneriver-properties';
import { exportTableToPdf } from '../lib/pdf-table-export';

const TODAY = format(new Date(), 'yyyy-MM-dd');

export function FlashReportDashboardPage() {
  const { data: latestDate } = useLatestDataDate('flash_report');
  const [selectedDate, setSelectedDate] = useState('');
  const [filterCities, setFilterCities] = useState<string[]>([]);
  const [filterRegions, setFilterRegions] = useState<string[]>([]);

  useEffect(() => {
    if (latestDate && !selectedDate) setSelectedDate(latestDate);
  }, [latestDate, selectedDate]);

  const [exporting, setExporting] = useState(false);
  const { data: flashData = [], isLoading } = useFlashReportData(selectedDate);

  const totalRoomRev = flashData.reduce((s, r) => s + (r.room_revenue ?? 0), 0);
  const totalAR = flashData.reduce((s, r) => s + (r.ar_total ?? 0), 0);

  async function handlePdfExport() {
    setExporting(true);
    try {
      const tableEl = document.getElementById('flash-report-table');
      if (!tableEl) return;
      await exportTableToPdf({
        element: tableEl,
        title: 'Flash Report',
        subtitle: `Report Date: ${displayDate}`,
        filename: `flash-report-${selectedDate}`,
        orientation: 'landscape',
      });
    } catch (err) {
      console.error('PDF export failed:', err);
    } finally {
      setExporting(false);
    }
  }

  const displayDate = (() => {
    try {
      return format(new Date(selectedDate + 'T00:00:00'), 'MM/dd/yyyy');
    } catch {
      return selectedDate;
    }
  })();

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="sticky top-0 z-20 border-b border-[#e5e5e5] bg-white px-6 py-3 flex flex-wrap items-center gap-3">
        <Link to="/stoneriver" className="text-[#6b7280] hover:text-[#1a1a1a] transition-colors">
          <ArrowLeftIcon className="w-4 h-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-[#1a1a1a] tracking-tight">
            Flash Report
            <span className="ml-2 text-[#2563eb]">{displayDate}</span>
          </h1>
        </div>

        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          max={TODAY}
          className="text-xs border border-[#e5e5e5] px-2 py-1.5 text-[#1a1a1a] bg-white focus:outline-none focus:ring-1 focus:ring-[#1a1a1a] rounded"
        />

        <MultiSelect label="All Regions" options={REGIONS} selected={filterRegions} onChange={setFilterRegions} />
        <MultiSelect label="All Cities" options={CITIES} selected={filterCities} onChange={setFilterCities} />

        {flashData.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-1 bg-[#f5f5f5] text-[#1a1a1a] font-semibold rounded tabular-nums">
              {flashData.length} properties
            </span>
            <span className="px-2 py-1 bg-[#f5f5f5] text-[#1a1a1a] font-semibold rounded tabular-nums">
              {fmtCurrency(totalRoomRev)} room rev
            </span>
            <span className="px-2 py-1 bg-[#f5f5f5] text-[#1a1a1a] font-semibold rounded tabular-nums">
              {fmtCurrency(totalAR)} total AR
            </span>
          </div>
        )}

        {/* PDF Export */}
        <button
          onClick={handlePdfExport}
          disabled={exporting}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#1f2937] hover:bg-[#374151] disabled:opacity-50 transition-colors rounded"
        >
          <ArrowDownTrayIcon className="w-3.5 h-3.5" />
          {exporting ? 'Exporting...' : 'Export PDF'}
        </button>
      </div>

      {/* Content */}
      <div className="px-4 py-4">
        {flashData.length === 0 && !isLoading && (
          <p className="text-xs text-[#6b7280] mb-2">
            No Flash Report data for {selectedDate}.
          </p>
        )}
        <FlashReportTable
          data={flashData}
          isLoading={isLoading}
          displayDate={displayDate}
          filterCities={filterCities}
          filterRegions={filterRegions}
        />
      </div>
    </div>
  );
}
