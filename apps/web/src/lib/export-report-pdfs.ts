/**
 * Generate performance report PDFs (Revenue Flash, Flash Report, Engineering)
 * for a date range. Renders styled HTML tables matching the exact dashboard format,
 * captures them with html2canvas, and bundles into a zip.
 */

import JSZip from 'jszip';
import { supabase } from './supabase';
import type { DailyHotelPerformance } from '../components/stoneriver/types';
import type { FlashReportProperty } from '../components/stoneriver/flash-report-types';
import { PROPERTIES, GROUP_ORDER } from '../constants/stoneriver-properties';

// ── Formatters (match dashboard exactly) ─────────────────────────────────────

function fmtCurrency(v: number | null): string {
  if (v == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
}
function fmtRate(v: number | null): string {
  if (v == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v);
}
function fmtPct(v: number | null): string { return v == null ? '—' : `${v.toFixed(1)}%`; }
function fmtNum(v: number | null): string {
  if (v == null) return '—';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
}
function fmtVariance(current: number | null, prior: number | null): string {
  if (current == null || prior == null) return '—';
  const diff = current - prior;
  const formatted = fmtCurrency(Math.abs(diff));
  return diff < 0 ? `(${formatted})` : formatted;
}

// ── Color helpers (match PerformanceTableRow.tsx) ─────────────────────────────

function occStyle(v: number | null): string {
  if (v == null) return 'color:#9ca3af';
  if (v >= 70) return 'color:#1a1a1a;font-weight:600';
  if (v >= 50) return 'color:#6b7280;font-weight:600';
  return 'color:#dc2626;font-weight:600';
}
function oooStyle(v: number | null): string {
  if (v != null && v > 0) return 'color:#dc2626;font-weight:600';
  return 'color:#9ca3af';
}
function varStyle(cur: number | null, prior: number | null): string {
  if (cur == null || prior == null) return 'color:#9ca3af';
  return (cur - prior) < 0 ? 'color:#dc2626' : 'color:#1a1a1a';
}
function revStyle(v: number | null): string {
  if (v == null) return 'color:#9ca3af';
  if (v >= 15000) return 'color:#1a1a1a;font-weight:600';
  return 'color:#1a1a1a';
}

// ── Aggregation helpers ──────────────────────────────────────────────────────

function sum(rows: DailyHotelPerformance[], fn: (r: DailyHotelPerformance) => number | null): number {
  return rows.reduce((s, r) => { const v = fn(r); return v != null ? s + v : s; }, 0);
}
function avg(rows: DailyHotelPerformance[], fn: (r: DailyHotelPerformance) => number | null): number | null {
  const vals = rows.map(fn).filter((v): v is number => v != null);
  return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function totalCells(rows: DailyHotelPerformance[]): string {
  const o_d = avg(rows, r => r.occupancy_day), a_d = avg(rows, r => r.adr_day), rp_d = avg(rows, r => r.revpar_day);
  const rs = sum(rows, r => r.total_rooms_sold), rv_d = sum(rows, r => r.revenue_day), ooo = sum(rows, r => r.ooo_rooms);
  const py_d = sum(rows, r => r.py_revenue_day);
  const o_m = avg(rows, r => r.occupancy_mtd), a_m = avg(rows, r => r.adr_mtd), rp_m = avg(rows, r => r.revpar_mtd);
  const rv_m = sum(rows, r => r.revenue_mtd), py_m = sum(rows, r => r.py_revenue_mtd);
  const o_y = avg(rows, r => r.occupancy_ytd), a_y = avg(rows, r => r.adr_ytd), rp_y = avg(rows, r => r.revpar_ytd);
  const rv_y = sum(rows, r => r.revenue_ytd), py_y = sum(rows, r => r.py_revenue_ytd);

  return `<td style="border-left:1px solid #e5e5e5">${fmtPct(o_d)}</td><td>${fmtRate(a_d)}</td><td>${fmtRate(rp_d)}</td>
    <td>${fmtNum(rs)}</td><td>${fmtCurrency(rv_d)}</td><td style="${oooStyle(ooo)}">${fmtNum(ooo)}</td>
    <td style="color:#6b7280">${fmtCurrency(py_d)}</td><td style="${varStyle(rv_d, py_d)}">${fmtVariance(rv_d, py_d)}</td>
    <td style="border-left:1px solid #d1d5db">${fmtPct(o_m)}</td><td>${fmtRate(a_m)}</td><td>${fmtRate(rp_m)}</td>
    <td>${fmtCurrency(rv_m)}</td><td style="color:#6b7280">${fmtCurrency(py_m)}</td><td style="${varStyle(rv_m, py_m)}">${fmtVariance(rv_m, py_m)}</td>
    <td style="border-left:1px solid #d1d5db">${fmtPct(o_y)}</td><td>${fmtRate(a_y)}</td><td>${fmtRate(rp_y)}</td>
    <td>${fmtCurrency(rv_y)}</td><td style="color:#6b7280">${fmtCurrency(py_y)}</td><td style="${varStyle(rv_y, py_y)}">${fmtVariance(rv_y, py_y)}</td>`;
}

// ── CSS ──────────────────────────────────────────────────────────────────────

const TABLE_CSS = `
  * { margin:0; padding:0; box-sizing:border-box; }
  div, table, th, td { font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
  .header { padding:12px 16px 8px; }
  .header h1 { font-size:14px; font-weight:700; color:#1a1a1a; margin-bottom:2px; }
  .header p { font-size:10px; color:#6b7280; }
  table { width:100%; border-collapse:collapse; font-size:11px; font-variant-numeric:tabular-nums; }
  th { padding:4px 6px; font-size:9px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em;
       color:#6b7280; white-space:nowrap; text-align:right; border-bottom:1px solid #e5e5e5; background:#f9fafb; }
  th.left { text-align:left; }
  th.section { font-size:10px; font-weight:700; color:#fff; background:#1f2937; text-align:center;
               padding:4px 6px; letter-spacing:0.1em; border-left:1px solid #4b5563; }
  td { padding:3px 6px; text-align:right; border-bottom:1px solid #f3f4f6; white-space:nowrap; color:#1a1a1a; }
  td.left { text-align:left; font-weight:500; }
  td.muted { color:#6b7280; }
  td.dash { color:#9ca3af; }
  tr.group-hdr td { background:#f3f4f6; font-weight:700; font-size:10px; color:#374151;
                    text-transform:uppercase; letter-spacing:0.05em; padding:5px 6px;
                    border-bottom:1px solid #d1d5db; border-top:1px solid #d1d5db; }
  tr.subtotal td { background:#f3f4f6; font-weight:600; font-size:11px; color:#374151;
                   border-bottom:1px solid #d1d5db; }
  tr.grand-total td { background:#e5e7eb; font-weight:700; font-size:11px; color:#111827;
                      border-top:2px solid #374151; }
  tr.nodata td { color:#9ca3af; opacity:0.5; }
`;

// ── Revenue Flash HTML ───────────────────────────────────────────────────────

function buildRevenueFlashHTML(rows: DailyHotelPerformance[], date: string): string {
  const dataMap = new Map<string, DailyHotelPerformance>();
  for (const r of rows) dataMap.set(r.property_name, r);

  let tbody = '';
  const allPresent: DailyHotelPerformance[] = [];

  for (const group of GROUP_ORDER) {
    const groupProps = PROPERTIES.filter(p => p.group === group);
    if (groupProps.length === 0) continue;

    const groupData = groupProps.map(p => dataMap.get(p.name)).filter((d): d is DailyHotelPerformance => d != null);

    tbody += `<tr class="group-hdr"><td colspan="21">${group}</td></tr>`;

    for (const prop of groupProps) {
      const d = dataMap.get(prop.name);
      if (d) allPresent.push(d);

      if (!d) {
        // No data — show dashes
        tbody += `<tr class="nodata"><td class="left">${prop.name}</td>${'<td>—</td>'.repeat(20)}</tr>`;
        continue;
      }

      tbody += `<tr>
        <td class="left">${d.property_name}</td>
        <td style="border-left:1px solid #e5e5e5;${occStyle(d.occupancy_day)}">${fmtPct(d.occupancy_day)}</td>
        <td>${fmtRate(d.adr_day)}</td><td>${fmtRate(d.revpar_day)}</td>
        <td>${fmtNum(d.total_rooms_sold)}</td>
        <td style="${revStyle(d.revenue_day)}">${fmtCurrency(d.revenue_day)}</td>
        <td style="${oooStyle(d.ooo_rooms)}">${d.ooo_rooms != null ? d.ooo_rooms : '—'}</td>
        <td class="muted">${fmtCurrency(d.py_revenue_day)}</td>
        <td style="${varStyle(d.revenue_day, d.py_revenue_day)}">${fmtVariance(d.revenue_day, d.py_revenue_day)}</td>
        <td style="border-left:1px solid #d1d5db;${occStyle(d.occupancy_mtd)}">${fmtPct(d.occupancy_mtd)}</td>
        <td>${fmtRate(d.adr_mtd)}</td><td>${fmtRate(d.revpar_mtd)}</td>
        <td style="${revStyle(d.revenue_mtd)}">${fmtCurrency(d.revenue_mtd)}</td>
        <td class="muted">${fmtCurrency(d.py_revenue_mtd)}</td>
        <td style="${varStyle(d.revenue_mtd, d.py_revenue_mtd)}">${fmtVariance(d.revenue_mtd, d.py_revenue_mtd)}</td>
        <td style="border-left:1px solid #d1d5db;${occStyle(d.occupancy_ytd)}">${fmtPct(d.occupancy_ytd)}</td>
        <td>${fmtRate(d.adr_ytd)}</td><td>${fmtRate(d.revpar_ytd)}</td>
        <td style="${revStyle(d.revenue_ytd)}">${fmtCurrency(d.revenue_ytd)}</td>
        <td class="muted">${fmtCurrency(d.py_revenue_ytd)}</td>
        <td style="${varStyle(d.revenue_ytd, d.py_revenue_ytd)}">${fmtVariance(d.revenue_ytd, d.py_revenue_ytd)}</td>
      </tr>`;
    }

    // Group subtotal
    if (groupData.length > 0) {
      tbody += `<tr class="subtotal"><td class="left">${group} Total</td>${totalCells(groupData)}</tr>`;
    }
  }

  // Grand total
  if (allPresent.length > 0) {
    tbody += `<tr class="grand-total"><td class="left">TOTAL: All Properties</td>${totalCells(allPresent)}</tr>`;
  }

  return `<div class="header"><h1>Fusion Hospitality Group — Revenue Flash</h1><p>Report Date: ${date}</p></div>
    <table>
      <thead>
        <tr><th class="section" style="text-align:center;min-width:180px">${date}</th>
        <th class="section" colspan="8">Date</th>
        <th class="section" colspan="6">Month to Date</th>
        <th class="section" colspan="6">Year to Date</th></tr>
        <tr>
          <th class="left" style="min-width:180px"></th>
          <th style="border-left:1px solid #e5e5e5">Occ%</th><th>ADR</th><th>RevPAR</th><th>Rooms</th><th>Revenue</th><th>OOO</th><th>PY Rev</th><th>Variance</th>
          <th style="border-left:1px solid #d1d5db">Occ%</th><th>ADR</th><th>RevPAR</th><th>Revenue</th><th>PY Rev</th><th>Variance</th>
          <th style="border-left:1px solid #d1d5db">Occ%</th><th>ADR</th><th>RevPAR</th><th>Revenue</th><th>PY Rev</th><th>Variance</th>
        </tr>
      </thead>
      <tbody>${tbody}</tbody>
    </table>`;
}

// ── Flash Report HTML ────────────────────────────────────────────────────────

function buildFlashReportHTML(rows: FlashReportProperty[], date: string): string {
  const dataMap = new Map<string, FlashReportProperty>();
  for (const r of rows) dataMap.set(r.property_name, r);

  let tbody = '';

  for (const group of GROUP_ORDER) {
    const groupProps = PROPERTIES.filter(p => p.group === group);
    if (groupProps.length === 0) continue;

    tbody += `<tr class="group-hdr"><td colspan="17">${group}</td></tr>`;

    for (const prop of groupProps) {
      const r = dataMap.get(prop.name);
      if (!r) {
        tbody += `<tr class="nodata"><td class="left">${prop.name}</td>${'<td>—</td>'.repeat(16)}</tr>`;
        continue;
      }
      tbody += `<tr>
        <td class="left">${r.property_name}</td>
        <td style="${occStyle(r.occupancy_pct)}">${fmtPct(r.occupancy_pct)}</td>
        <td>${fmtRate(r.adr)}</td><td>${fmtRate(r.revpar)}</td>
        <td style="${revStyle(r.room_revenue)}">${fmtCurrency(r.room_revenue)}</td><td>${fmtCurrency(r.fb_revenue)}</td>
        <td>${fmtNum(r.rooms_occupied)}</td><td style="${oooStyle(r.rooms_ooo)}">${fmtNum(r.rooms_ooo)}</td><td>${fmtNum(r.rooms_dirty)}</td>
        <td>${fmtNum(r.room_nights_reserved)}</td><td>${fmtNum(r.no_shows)}</td>
        <td>${fmtCurrency(r.ar_up_to_30)}</td><td>${fmtCurrency(r.ar_over_30)}</td>
        <td>${fmtCurrency(r.ar_over_60)}</td><td>${fmtCurrency(r.ar_over_90)}</td>
        <td>${fmtCurrency(r.ar_over_120)}</td><td>${fmtCurrency(r.ar_total)}</td>
      </tr>`;
    }
  }

  const totalRev = rows.reduce((s, r) => s + (r.room_revenue ?? 0), 0);
  const totalAR = rows.reduce((s, r) => s + (r.ar_total ?? 0), 0);
  tbody += `<tr class="grand-total"><td class="left">TOTAL: All Properties</td>
    <td></td><td></td><td></td><td>${fmtCurrency(totalRev)}</td><td></td>
    <td></td><td></td><td></td><td></td><td></td>
    <td></td><td></td><td></td><td></td><td></td><td>${fmtCurrency(totalAR)}</td>
  </tr>`;

  return `<div class="header"><h1>Fusion Hospitality Group — Flash Report</h1><p>Report Date: ${date}</p></div>
    <table>
      <thead>
        <tr><th class="section" style="text-align:center;min-width:180px">${date}</th>
        <th class="section" colspan="5">Operating Metrics</th>
        <th class="section" colspan="5">Room Status</th>
        <th class="section" colspan="6">Accounts Receivable</th></tr>
        <tr>
          <th class="left" style="min-width:180px"></th>
          <th>Occ%</th><th>ADR</th><th>RevPAR</th><th>Room Rev</th><th>F&amp;B Rev</th>
          <th>Occ</th><th>OOO</th><th>Dirty</th><th>Reserved</th><th>No Shows</th>
          <th>≤30d</th><th>&gt;30d</th><th>&gt;60d</th><th>&gt;90d</th><th>&gt;120d</th><th>Total</th>
        </tr>
      </thead>
      <tbody>${tbody}</tbody>
    </table>`;
}

// ── Engineering HTML ─────────────────────────────────────────────────────────

interface EngRow {
  property_name: string;
  room_number: string;
  date_ooo: string | null;
  reason: string | null;
  notes: string | null;
  is_long_term: boolean;
}

function buildEngineeringHTML(rows: EngRow[], date: string): string {
  const ooo = rows.filter(r => !r.is_long_term);
  const longTerm = rows.filter(r => r.is_long_term);

  const counts: Record<string, { ooo: number; lt: number }> = {};
  for (const p of PROPERTIES) counts[p.name] = { ooo: 0, lt: 0 };
  for (const r of ooo) { if (!counts[r.property_name]) counts[r.property_name] = { ooo: 0, lt: 0 }; counts[r.property_name]!.ooo++; }
  for (const r of longTerm) { if (!counts[r.property_name]) counts[r.property_name] = { ooo: 0, lt: 0 }; counts[r.property_name]!.lt++; }

  let summaryRows = '';
  for (const [name, c] of Object.entries(counts)) {
    if (c.ooo === 0 && c.lt === 0) continue;
    summaryRows += `<tr><td class="left">${name}</td><td>${c.ooo}</td><td>${c.lt}</td><td>${c.ooo + c.lt}</td></tr>`;
  }
  summaryRows += `<tr class="grand-total"><td class="left">TOTAL</td><td>${ooo.length}</td><td>${longTerm.length}</td><td>${rows.length}</td></tr>`;

  const buildRoomTable = (rooms: EngRow[], title: string): string => {
    if (rooms.length === 0) return '';
    let html = `<div style="margin-top:16px"><div class="header" style="padding:8px 0 4px"><h1 style="font-size:12px">${title} (${rooms.length} rooms)</h1></div>`;
    html += `<table><thead><tr><th class="left">Property</th><th class="left">Room</th><th class="left">Date OOO</th><th class="left" style="min-width:200px">Reason</th><th class="left" style="min-width:200px">Notes</th></tr></thead><tbody>`;
    for (const r of rooms) {
      html += `<tr><td class="left">${r.property_name}</td><td class="left">${r.room_number}</td><td class="left">${r.date_ooo ?? ''}</td><td class="left" style="white-space:normal">${r.reason ?? ''}</td><td class="left" style="white-space:normal">${r.notes ?? ''}</td></tr>`;
    }
    html += `</tbody></table></div>`;
    return html;
  };

  return `<div class="header"><h1>Fusion Hospitality Group — Engineering Flash</h1><p>Report Date: ${date}</p></div>
    <table><thead><tr><th class="left">Property</th><th>OOO Rooms</th><th>Long Term</th><th>Total</th></tr></thead>
    <tbody>${summaryRows}</tbody></table>
    ${buildRoomTable(ooo, 'OOO Rooms')}
    ${buildRoomTable(longTerm, 'Long Term OOO Rooms')}`;
}

// ── html2canvas capture helper ───────────────────────────────────────────────

async function captureHTML(html: string, width: number): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import('html2canvas-pro');

  const container = document.createElement('div');
  container.style.cssText = `position:fixed;left:-9999px;top:0;width:${width}px;background:#fff;z-index:-1;`;
  container.innerHTML = `<style>${TABLE_CSS}</style>${html}`;
  document.body.appendChild(container);

  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  const canvas = await html2canvas(container, { scale: 2, backgroundColor: '#ffffff', logging: false });
  document.body.removeChild(container);
  return canvas;
}

// ── Main export function ─────────────────────────────────────────────────────

export type ReportType = 'revenue-flash' | 'flash-report' | 'engineering';

interface ExportProgress { current: number; total: number; label: string; }

export async function exportReportPdfs(
  reportTypes: ReportType[],
  startDate: string,
  endDate: string,
  onProgress?: (p: ExportProgress) => void,
): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');

  await import('html2canvas-pro');
  await import('jspdf');

  const { data: dateRows } = await supabase
    .from('daily_hotel_performance')
    .select('report_date')
    .gte('report_date', startDate)
    .lte('report_date', endDate)
    .order('report_date');

  const dates = [...new Set((dateRows ?? []).map((r: { report_date: string }) => r.report_date))].sort();
  if (dates.length === 0) throw new Error(`No data found between ${startDate} and ${endDate}`);

  const zip = new JSZip();
  const rangeLabel = dates.length === 1 ? dates[0]! : `${startDate}-to-${endDate}`;
  const totalSteps = dates.length * reportTypes.length;
  let step = 0;

  for (const type of reportTypes) {
    const { jsPDF } = await import('jspdf');
    const combinedPdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    let firstPage = true;

    for (const date of dates) {
      step++;
      onProgress?.({ current: step, total: totalSteps, label: `${type} — ${date}` });

      let html = '';
      if (type === 'revenue-flash') {
        const { data } = await supabase.from('daily_hotel_performance').select('*').eq('report_date', date);
        html = buildRevenueFlashHTML((data ?? []) as DailyHotelPerformance[], date);
      } else if (type === 'flash-report') {
        const { data } = await supabase.from('flash_report').select('*').eq('report_date', date);
        html = buildFlashReportHTML((data ?? []) as FlashReportProperty[], date);
      } else if (type === 'engineering') {
        const { data } = await supabase.from('engineering_ooo_rooms').select('*').eq('report_date', date);
        html = buildEngineeringHTML((data ?? []) as EngRow[], date);
      }

      const canvas = await captureHTML(html, 1400);

      const pageW = 297, pageH = 210, margin = 8;
      const usableW = pageW - margin * 2;
      const usableH = pageH - margin * 2;
      const ratio = usableW / canvas.width;
      const totalScaledH = canvas.height * ratio;

      if (totalScaledH <= usableH) {
        if (!firstPage) combinedPdf.addPage();
        firstPage = false;
        combinedPdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, margin, usableW, totalScaledH);
      } else {
        const pageHeightPx = usableH / ratio;
        let yPx = 0;
        while (yPx < canvas.height) {
          if (!firstPage) combinedPdf.addPage();
          firstPage = false;
          const sliceH = Math.min(pageHeightPx, canvas.height - yPx);
          const sliceCanvas = document.createElement('canvas');
          sliceCanvas.width = canvas.width;
          sliceCanvas.height = sliceH;
          const ctx = sliceCanvas.getContext('2d')!;
          ctx.drawImage(canvas, 0, yPx, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
          combinedPdf.addImage(sliceCanvas.toDataURL('image/png'), 'PNG', margin, margin, usableW, sliceH * ratio);
          yPx += sliceH;
        }
      }
    }

    zip.file(`${type}-${rangeLabel}.pdf`, combinedPdf.output('arraybuffer'));
  }

  onProgress?.({ current: totalSteps, total: totalSteps, label: 'Packaging zip...' });
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fusion-reports-${rangeLabel}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
