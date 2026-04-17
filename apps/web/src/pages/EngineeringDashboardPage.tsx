/**
 * Engineering Flash Dashboard — OOO rooms and long-term maintenance tracking.
 */

import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeftIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { clsx } from 'clsx';
import { useEngineeringData } from '../hooks/useEngineeringData';
import { useLatestDataDate } from '../hooks/useLatestDataDate';
import { PROPERTIES } from '../constants/stoneriver-properties';
import type { OOORoom } from '../components/stoneriver/engineering-types';
import { exportTableToPdf } from '../lib/pdf-table-export';

const TODAY = format(new Date(), 'yyyy-MM-dd');

type ViewTab = 'ooo' | 'longterm' | 'summary';

const btnBase = 'px-3 py-1 text-[11px] font-semibold rounded transition-colors';
const btnActive = `${btnBase} bg-[#1f2937] text-white`;
const btnInactive = `${btnBase} bg-[#f3f4f6] text-[#6b7280] hover:bg-[#e5e7eb]`;

const thBase = 'px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#6b7280] whitespace-nowrap';

function reasonColor(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes('pest')) return 'bg-[#fef2f2] text-[#dc2626]';
  if (r.includes('leak') || r.includes('water')) return 'bg-[#eff6ff] text-[#2563eb]';
  if (r.includes('hvac') || r.includes('ac') || r.includes('heat')) return 'bg-[#fefce8] text-[#ca8a04]';
  if (r.includes('odor') || r.includes('wet') || r.includes('bed')) return 'bg-[#fef2f2] text-[#dc2626]';
  return 'bg-[#f3f4f6] text-[#374151]';
}

function RoomTable({ rooms, title }: { rooms: OOORoom[]; title: string }) {
  if (rooms.length === 0) {
    return <p className="text-xs text-[#6b7280] py-4">No {title.toLowerCase()} rooms.</p>;
  }

  return (
    <div className="overflow-x-auto border border-[#e5e5e5] rounded" id={`eng-table-${title.replace(/\s/g, '-').toLowerCase()}`}>
      <table className="w-full text-[11px] border-collapse" style={{ minWidth: 700 }}>
        <thead>
          <tr className="bg-[#1f2937]">
            <th colSpan={5} className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-white text-left">
              {title} ({rooms.length} rooms)
            </th>
          </tr>
          <tr className="bg-[#f9fafb] border-b border-[#e5e5e5]">
            <th className={`${thBase} text-left`}>Property</th>
            <th className={`${thBase} text-center`}>Room #</th>
            <th className={`${thBase} text-left`}>Date OOO</th>
            <th className={`${thBase} text-left`}>Reason</th>
            <th className={`${thBase} text-left`}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((room, i) => (
            <tr key={`${room.propertyName}-${room.roomNumber}-${i}`} className="border-b border-[#e5e5e5] hover:bg-[#f9fafb]">
              <td className="px-2 py-1.5 text-[11px] font-medium text-[#1a1a1a]">{room.propertyName}</td>
              <td className="px-2 py-1.5 text-[11px] text-center tabular-nums font-semibold">{room.roomNumber}</td>
              <td className="px-2 py-1.5 text-[11px] text-[#6b7280] tabular-nums">{room.dateOOO}</td>
              <td className="px-2 py-1.5">
                {room.reason ? (
                  <span className={clsx('inline-block px-1.5 py-0.5 rounded text-[10px] font-medium', reasonColor(room.reason))}>
                    {room.reason}
                  </span>
                ) : (
                  <span className="text-[#9ca3af]">—</span>
                )}
              </td>
              <td className="px-2 py-1.5 text-[11px] text-[#6b7280] max-w-[300px] truncate" title={room.notes}>
                {room.notes || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryView({ oooRooms, longTermRooms }: { oooRooms: OOORoom[]; longTermRooms: OOORoom[] }) {
  const allRooms = [...oooRooms, ...longTermRooms];

  // Count OOO rooms per property
  const perProperty = new Map<string, { ooo: number; longTerm: number }>();
  for (const prop of PROPERTIES) {
    perProperty.set(prop.name, { ooo: 0, longTerm: 0 });
  }
  for (const room of oooRooms) {
    const p = perProperty.get(room.propertyName);
    if (p) p.ooo++;
  }
  for (const room of longTermRooms) {
    const p = perProperty.get(room.propertyName);
    if (p) p.longTerm++;
  }

  // Count by reason
  const byReason = new Map<string, number>();
  for (const room of allRooms) {
    const reason = room.reason || 'Unspecified';
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  }
  const topReasons = [...byReason.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Per Property */}
      <div className="border border-[#e5e5e5] rounded" id="eng-table-summary">
        <div className="bg-[#1f2937] px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-white">
          OOO Rooms by Property
        </div>
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="bg-[#f9fafb] border-b border-[#e5e5e5]">
              <th className={`${thBase} text-left`}>Property</th>
              <th className={`${thBase} text-right`}>Today OOO</th>
              <th className={`${thBase} text-right`}>Long Term</th>
              <th className={`${thBase} text-right`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {PROPERTIES.filter((p) => {
              const d = perProperty.get(p.name);
              return d && (d.ooo > 0 || d.longTerm > 0);
            }).map((prop) => {
              const d = perProperty.get(prop.name)!;
              return (
                <tr key={prop.name} className="border-b border-[#e5e5e5]">
                  <td className="px-2 py-1 font-medium">{prop.name}</td>
                  <td className={clsx('px-2 py-1 text-right tabular-nums', d.ooo > 0 ? 'text-[#dc2626] font-semibold' : 'text-[#9ca3af]')}>
                    {d.ooo}
                  </td>
                  <td className={clsx('px-2 py-1 text-right tabular-nums', d.longTerm > 0 ? 'text-[#ca8a04] font-semibold' : 'text-[#9ca3af]')}>
                    {d.longTerm}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums font-bold">{d.ooo + d.longTerm}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-[#e5e7eb] font-bold">
              <td className="px-2 py-1">TOTAL</td>
              <td className="px-2 py-1 text-right tabular-nums text-[#dc2626]">{oooRooms.length}</td>
              <td className="px-2 py-1 text-right tabular-nums text-[#ca8a04]">{longTermRooms.length}</td>
              <td className="px-2 py-1 text-right tabular-nums">{allRooms.length}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* By Reason */}
      <div className="border border-[#e5e5e5] rounded">
        <div className="bg-[#1f2937] px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-white">
          OOO Reasons
        </div>
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="bg-[#f9fafb] border-b border-[#e5e5e5]">
              <th className={`${thBase} text-left`}>Reason</th>
              <th className={`${thBase} text-right`}>Count</th>
            </tr>
          </thead>
          <tbody>
            {topReasons.map(([reason, count]) => (
              <tr key={reason} className="border-b border-[#e5e5e5]">
                <td className="px-2 py-1">
                  <span className={clsx('inline-block px-1.5 py-0.5 rounded text-[10px] font-medium', reasonColor(reason))}>
                    {reason}
                  </span>
                </td>
                <td className="px-2 py-1 text-right tabular-nums font-semibold">{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function EngineeringDashboardPage() {
  const { data: latestDate } = useLatestDataDate('engineering_ooo_rooms');
  const [selectedDate, setSelectedDate] = useState('');
  const [viewTab, setViewTab] = useState<ViewTab>('summary');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (latestDate && !selectedDate) setSelectedDate(latestDate);
  }, [latestDate, selectedDate]);

  const { data: engData, isLoading } = useEngineeringData(selectedDate);
  const oooRooms = engData?.oooRooms ?? [];
  const longTermRooms = engData?.longTermRooms ?? [];

  const displayDate = useMemo(() => {
    try { return format(new Date(selectedDate + 'T00:00:00'), 'MM/dd/yyyy'); }
    catch { return selectedDate; }
  }, [selectedDate]);

  async function handlePdfExport() {
    setExporting(true);
    try {
      const tableId = viewTab === 'summary' ? 'eng-table-summary' : `eng-table-${viewTab === 'ooo' ? 'ooo-rooms' : 'long-term-ooo-rooms'}`;
      const tableEl = document.getElementById(tableId);
      if (!tableEl) return;
      const tabLabel = viewTab === 'summary' ? 'Summary' : viewTab === 'ooo' ? 'OOO Rooms' : 'Long-Term OOO';
      await exportTableToPdf({
        element: tableEl,
        title: `Engineering Flash — ${tabLabel}`,
        subtitle: `Report Date: ${displayDate}`,
        filename: `engineering-flash-${viewTab}-${selectedDate}`,
        orientation: 'landscape',
      });
    } catch (err) {
      console.error('PDF export failed:', err);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="sticky top-0 z-20 border-b border-[#e5e5e5] bg-white px-6 py-3 flex flex-wrap items-center gap-3">
        <Link to="/stoneriver" className="text-[#6b7280] hover:text-[#1a1a1a] transition-colors">
          <ArrowLeftIcon className="w-4 h-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-[#1a1a1a] tracking-tight">
            Engineering Flash
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

        {/* Summary pills */}
        <div className="flex items-center gap-2 text-xs">
          <span className="px-2 py-1 bg-[#fef2f2] text-[#dc2626] font-semibold rounded tabular-nums">
            {oooRooms.length} OOO today
          </span>
          <span className="px-2 py-1 bg-[#fefce8] text-[#ca8a04] font-semibold rounded tabular-nums">
            {longTermRooms.length} long-term
          </span>
        </div>

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
      <div className="px-4 py-4 space-y-4">
        {/* Tab buttons */}
        <div className="flex items-center gap-1.5">
          {([
            ['summary', 'Summary'],
            ['ooo', 'OOO Rooms'],
            ['longterm', 'Long Term OOO'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setViewTab(key)}
              className={viewTab === key ? btnActive : btnInactive}
            >
              {label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-2 py-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-7 bg-[#f5f5f5] animate-pulse rounded" />
            ))}
          </div>
        ) : (
          <>
            {viewTab === 'summary' && <SummaryView oooRooms={oooRooms} longTermRooms={longTermRooms} />}
            {viewTab === 'ooo' && <RoomTable rooms={oooRooms} title="OOO Rooms" />}
            {viewTab === 'longterm' && <RoomTable rooms={longTermRooms} title="Long Term OOO Rooms" />}
          </>
        )}
      </div>
    </div>
  );
}
