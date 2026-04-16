/**
 * Report parsers — extract structured performance data from OCR text.
 * Shared between the File Scanner (scanner route) and OCR worker.
 */

import { supabaseAdmin } from './supabase.js';

// ── Property name / group mappings ──────────────────────────────────────────

export const KNOWN_PROPERTIES = [
  'Candlewood Suites', 'Holiday Inn Express Fulton', 'Holiday Inn Express Memphis Southwind',
  'Holiday Inn Express Tupelo', 'Holiday Inn Tupelo', 'Four Points Memphis Southwind',
  'Best Western Tupelo', 'Surestay Tupelo', 'SureStay Tupelo', 'Hyatt Place Biloxi',
  'Comfort Inn Tupelo', 'Hilton Garden Inn Olive Branch', 'TownePlace Suites',
  'Best Western Plus Olive Branch', 'Home 2 Suites by Hilton Tupelo', 'Home2 Suites by Hilton Tupelo',
  'Home 2 Suites by Hilton Tupelo, MS.', 'Home2 Suites by Hilton Tupelo, MS.',
  'Tru by Hilton Tupelo', 'Tru by Hilton Tupelo, MS.',
  'Holiday Inn Meridian', 'Hilton Garden Inn Meridian',
  'Hampton Inn Meridian', 'Hampton Inn Vicksburg', 'DoubleTree Biloxi', 'Hilton Garden Inn Madison',
  'Best Western Plus DeSoto',
];

export const NAME_MAP: Record<string, string> = {
  'Surestay Tupelo': 'SureStay Hotel', 'SureStay Tupelo': 'SureStay Hotel',
  'Hilton Garden Inn Olive Branch': 'HGI Olive Branch',
  'Home 2 Suites by Hilton Tupelo': 'Home2 Suites By Hilton',
  'Home2 Suites by Hilton Tupelo': 'Home2 Suites By Hilton',
  'Home 2 Suites by Hilton Tupelo, MS.': 'Home2 Suites By Hilton',
  'Home2 Suites by Hilton Tupelo, MS.': 'Home2 Suites By Hilton',
  'Tru by Hilton Tupelo': 'Tru By Hilton Tupelo',
  'Tru by Hilton Tupelo, MS.': 'Tru By Hilton Tupelo',
  'Best Western Plus DeSoto': 'Best Western Plus Olive Branch',
};

export const GROUP_MAP: Record<string, string> = {
  'HGI Olive Branch': 'Hilton', 'Tru By Hilton Tupelo': 'Hilton', 'Hampton Inn Vicksburg': 'Hilton',
  'DoubleTree Biloxi': 'Hilton', 'Home2 Suites By Hilton': 'Hilton', 'Hilton Garden Inn Madison': 'Hilton',
  'Hilton Garden Inn Meridian': 'Hilton', 'Hampton Inn Meridian': 'Hilton',
  'Holiday Inn Meridian': 'IHG', 'Candlewood Suites': 'IHG', 'Holiday Inn Express Fulton': 'IHG',
  'Holiday Inn Express Memphis Southwind': 'IHG', 'Holiday Inn Express Tupelo': 'IHG', 'Holiday Inn Tupelo': 'IHG',
  'Four Points Memphis Southwind': 'Marriott', 'TownePlace Suites': 'Marriott',
  'Best Western Tupelo': 'Best Western', 'SureStay Hotel': 'Best Western', 'Best Western Plus Olive Branch': 'Best Western',
  'Hyatt Place Biloxi': 'Hyatt', 'Comfort Inn Tupelo': 'Choice',
};

export const DBA_MAP: Record<string, string> = {
  'best western plus tupelo': 'Best Western Tupelo', 'hie fulton': 'Holiday Inn Express Fulton',
  'surestay tupelo': 'SureStay Hotel', 'holiday inn tupelo': 'Holiday Inn Tupelo',
  'comfort inn': 'Comfort Inn Tupelo', 'candlewood tupelo': 'Candlewood Suites',
  'hie tupelo': 'Holiday Inn Express Tupelo', 'home2 suites tupelo': 'Home2 Suites By Hilton',
  'tru by hilton tupelo': 'Tru By Hilton Tupelo', 'tps olive branch': 'TownePlace Suites',
  'hgi olive branch': 'HGI Olive Branch', 'holiday inn meridian': 'Holiday Inn Meridian',
  'hampton inn meridian': 'Hampton Inn Meridian', 'hgi meridian': 'Hilton Garden Inn Meridian',
  'hyatt place biloxi': 'Hyatt Place Biloxi', 'best western plus desoto': 'Best Western Plus Olive Branch',
  'hie memphis southwind': 'Holiday Inn Express Memphis Southwind',
  'four points memphis southwind': 'Four Points Memphis Southwind',
  'hgi madison': 'Hilton Garden Inn Madison', 'hampton inn vicksburg': 'Hampton Inn Vicksburg',
  'doubletree biloxi': 'DoubleTree Biloxi',
};

export const HOTEL_MAP: Record<string, string> = {
  'bw tupelo': 'Best Western Tupelo', 'hie fulton': 'Holiday Inn Express Fulton',
  'hi tupelo': 'Holiday Inn Tupelo', 'comfort inn tupelo': 'Comfort Inn Tupelo',
  'candlewood tupelo': 'Candlewood Suites', 'hie tupelo': 'Holiday Inn Express Tupelo',
  'tru tupelo': 'Tru By Hilton Tupelo', 'home 2 suites': 'Home2 Suites By Hilton',
  'hyatt biloxi': 'Hyatt Place Biloxi', 'hyatt place biloxi': 'Hyatt Place Biloxi',
  'tps olive branch': 'TownePlace Suites', 'hgi olive branch': 'HGI Olive Branch',
  'hilton garden inn olive branch': 'HGI Olive Branch', 'bw plus ob': 'Best Western Plus Olive Branch',
  'hgi madison': 'Hilton Garden Inn Madison', 'holiday inn meridian': 'Holiday Inn Meridian',
  'hampton inn meridian': 'Hampton Inn Meridian', 'hgi meridian': 'Hilton Garden Inn Meridian',
  'hampton inn vicksburg': 'Hampton Inn Vicksburg', 'doubletree biloxi': 'DoubleTree Biloxi',
  'fp southwind': 'Four Points Memphis Southwind', 'hie southwind': 'Holiday Inn Express Memphis Southwind',
  'hie memphis southwind': 'Holiday Inn Express Memphis Southwind',
  'surestay tupelo': 'SureStay Hotel', 'tru by hilton tupelo': 'Tru By Hilton Tupelo',
  'towneplace olive branch': 'TownePlace Suites',
  'best western plus desoto': 'Best Western Plus Olive Branch',
  'hie olive branch': 'Holiday Inn Express Olive Branch',
};

// ── Helpers ─────────────────────────────────────────────────────────────────

export function parseNum(s: string | undefined): number | null {
  if (!s) return null;
  let c = s.replace(/[$,%\s]/g, '').replace(/,/g, '');
  if (c.startsWith('(') && c.endsWith(')')) c = '-' + c.slice(1, -1);
  const v = parseFloat(c);
  return isNaN(v) ? null : v;
}

export function parsePct(s: string | undefined): number | null {
  if (!s) return null;
  const v = parseFloat(s.replace(/[%\s]/g, ''));
  if (isNaN(v) || v < 0) return null;
  if (v > 0 && v <= 1) return Math.round(v * 10000) / 100;
  return v > 100 ? null : v;
}

// ── Parsers ─────────────────────────────────────────────────────────────────

export function parseRevenueFlash(text: string, date: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let matched: string | null = null;
    let remainder = '';
    for (const prop of KNOWN_PROPERTIES) {
      const regex = new RegExp(`^${prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[.,]?\\s*`, 'i');
      const m = trimmed.match(regex);
      if (m) { matched = prop; remainder = trimmed.slice(m[0].length).replace(/\.{2,}/g, '.').trim(); break; }
    }
    if (!matched) continue;
    const canonical = NAME_MAP[matched] ?? matched;
    if (seen.has(canonical)) continue;
    const tokens = remainder.match(/\(?\$?[\d,]+\.?\d*%?\)?/g) ?? [];
    if (tokens.length < 8) continue;
    seen.add(canonical);
    rows.push({
      property_name: canonical, property_group: GROUP_MAP[canonical] ?? 'Other', report_date: date,
      occupancy_day: parsePct(tokens[0]), adr_day: parseNum(tokens[1]), revpar_day: parseNum(tokens[2]),
      total_rooms_sold: parseNum(tokens[3]), revenue_day: parseNum(tokens[4]),
      ooo_rooms: parseNum(tokens[5]), py_revenue_day: parseNum(tokens[6]),
      occupancy_mtd: tokens.length > 8 ? parsePct(tokens[8]) : null,
      adr_mtd: tokens.length > 9 ? parseNum(tokens[9]) : null,
      revpar_mtd: tokens.length > 10 ? parseNum(tokens[10]) : null,
      revenue_mtd: tokens.length > 11 ? parseNum(tokens[11]) : null,
      py_revenue_mtd: tokens.length > 12 ? parseNum(tokens[12]) : null,
      occupancy_ytd: tokens.length > 14 ? parsePct(tokens[14]) : null,
      adr_ytd: tokens.length > 15 ? parseNum(tokens[15]) : null,
      revpar_ytd: tokens.length > 16 ? parseNum(tokens[16]) : null,
      revenue_ytd: tokens.length > 17 ? parseNum(tokens[17]) : null,
      py_revenue_ytd: tokens.length > 18 ? parseNum(tokens[18]) : null,
      report_format: 'revenue-flash',
    });
  }
  return rows;
}

export function parseFlashReport(text: string, date: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const sections = text.split(/(?=Entity Name)/);
  for (const section of sections) {
    const lines = section.split('\n').filter((l: string) => l.trim());
    let dbaRow: string[] = [];
    const metricRows: { label: string; cells: string[] }[] = [];
    for (const line of lines) {
      const hasTabs = line.includes('\t');
      if (hasTabs) {
        const cells = line.split('\t');
        const label = cells[0]?.trim() || cells[1]?.trim() || '';
        const dataCells = cells.slice(2).map((c: string) => c.trim());
        if (label === 'DBA') dbaRow = dataCells;
        else if (label === 'Entity Name' || label === 'Date' || /^\d{2}\/\d{2}\/\d{4}/.test(label)) { /* skip */ }
        else if (label === 'Total' || label === 'Portfolio Total' || label === 'Total Outstanding') { /* skip totals */ }
        else if (!cells[0]?.trim() && !cells[1]?.trim() && dataCells[0]) metricRows.push({ label: 'AR Total', cells: dataCells });
        else if (label) metricRows.push({ label, cells: dataCells });
      } else {
        const parts = line.split(/\s{3,}/).map((s: string) => s.trim()).filter(Boolean);
        const label = parts[0] ?? '';
        const cells = parts.slice(1);
        if (label === 'DBA') dbaRow = cells;
        else if (label === 'Entity Name' || label === 'Date' || /^\d{1,2}\/\d{1,2}\/\d{4}/.test(label)) { /* skip */ }
        else if (label === 'Total' || label === 'Portfolio Total' || label === 'Total Outstanding') { /* skip totals */ }
        else if (/^[-$]/.test(label) && cells.length > 0) metricRows.push({ label: 'AR Total', cells: [label, ...cells] });
        else if (cells.length > 0) metricRows.push({ label, cells });
      }
    }
    for (let i = 0; i < dbaRow.length; i++) {
      const dba = dbaRow[i];
      if (!dba || dba === 'Total') continue;
      const name = DBA_MAP[dba.toLowerCase().trim()];
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const v: Record<string, string> = {};
      for (const r of metricRows) v[r.label] = r.cells[i] ?? '';
      let occ = parseNum(v['Occupancy %']);
      if (occ != null && occ > 0 && occ <= 1) occ = Math.round(occ * 1000) / 10;
      rows.push({
        property_name: name, entity_name: '', property_group: GROUP_MAP[name] ?? 'Other', report_date: date,
        occupancy_pct: occ, adr: parseNum(v['ADR']), revpar: parseNum(v['RevPAR']),
        room_revenue: parseNum(v['Room Revenue']), fb_revenue: parseNum(v['F&B Revenue']),
        rooms_occupied: parseNum(v['Rooms Occupied']), rooms_ooo: parseNum(v['Rooms OOO']),
        rooms_dirty: parseNum(v['Rooms Dirty']), room_nights_reserved: parseNum(v['Room Nights Reserved Today']),
        no_shows: parseNum(v['No Shows']),
        ar_up_to_30: parseNum(v['Accounts Up to 30 Days']), ar_over_30: parseNum(v['Accounts Over 30 Days']),
        ar_over_60: parseNum(v['Accounts Over 60 Days']), ar_over_90: parseNum(v['Accounts Over 90 Days']),
        ar_over_120: parseNum(v['Accounts Over 120 Days']), ar_total: parseNum(v['AR Total']),
      });
    }
  }
  return rows;
}

export function parseEngineering(text: string, date: string): Record<string, unknown>[] {
  const rooms: Record<string, unknown>[] = [];
  const normalized = text.replace(/\r\n/g, '\n');
  const sheets = normalized.split(/=== Sheet:\s*/);
  for (const sheet of sheets) {
    const firstLine = sheet.split('\n')[0]?.trim() ?? '';
    const isLongTerm = firstLine.includes('Long Term');
    if (!firstLine.includes('OOO')) continue;
    for (const line of sheet.split('\n').slice(1)) {
      const cells = line.split('\t');
      const hotel = cells[0]?.trim();
      const roomNum = cells[1]?.trim();
      if (!hotel || !roomNum || hotel === 'Hotel' || hotel === 'Engineering Flash') continue;
      rooms.push({
        property_name: HOTEL_MAP[hotel.toLowerCase().trim()] ?? hotel,
        report_date: date, room_number: roomNum,
        date_ooo: cells[2]?.trim() || null, reason: cells[3]?.trim() || null,
        notes: cells[4]?.trim() || null, is_long_term: isLongTerm,
      });
    }
  }
  return rooms;
}

// ── Report type detection ───────────────────────────────────────────────────

export type ReportType = 'revenue-flash' | 'flash-report' | 'engineering' | 'unknown';

export function detectReportType(filename: string): ReportType {
  const lower = filename.toLowerCase();
  if (lower.includes('revenue') && lower.includes('flash')) return 'revenue-flash';
  if (lower.includes('flash') && lower.includes('report') && !lower.includes('revenue')) return 'flash-report';
  if (lower.includes('engineering') && lower.includes('flash') && !lower.includes('template')) return 'engineering';
  // Also detect by prefix patterns
  if (lower.includes('revenue flash')) return 'revenue-flash';
  return 'unknown';
}

export function extractDateFromFilename(filename: string): string | null {
  // Try patterns: 04.12.2026, 04-12-2026, 4-12-26, 04/12/2026, 04122026
  const patterns = [
    /(\d{2})[.\-/](\d{2})[.\-/](\d{4})/,    // MM.DD.YYYY or MM-DD-YYYY
    /(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2})(?!\d)/, // M-D-YY
    /(\d{4})[.\-/](\d{2})[.\-/](\d{2})/,      // YYYY-MM-DD
  ];
  for (const re of patterns) {
    const m = filename.match(re);
    if (!m) continue;
    let year = parseInt(m[3]!, 10);
    let month = parseInt(m[1]!, 10);
    let day = parseInt(m[2]!, 10);

    // If first match looks like a year (>= 2020), it's YYYY-MM-DD
    if (month >= 2020) {
      [year, month, day] = [month, day, year];
    }
    // 2-digit year
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

// ── Post-OCR ingestion ──────────────────────────────────────────────────────

export async function ingestOcrResult(
  jobId: string,
  originalName: string,
  fullText: string,
  log: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void; warn: (...args: unknown[]) => void },
): Promise<void> {
  const reportType = detectReportType(originalName);
  if (reportType === 'unknown') return; // Not a performance report — skip silently

  const date = extractDateFromFilename(originalName);
  if (!date) {
    log.warn({ jobId, originalName }, 'ocr_ingest.no_date_in_filename');
    return;
  }

  const supabase = supabaseAdmin();
  let rows: Record<string, unknown>[] = [];
  let table = '';

  if (reportType === 'revenue-flash') {
    rows = parseRevenueFlash(fullText, date);
    table = 'daily_hotel_performance';
  } else if (reportType === 'flash-report') {
    rows = parseFlashReport(fullText, date);
    table = 'flash_report';
  } else if (reportType === 'engineering') {
    rows = parseEngineering(fullText, date);
    table = 'engineering_ooo_rooms';
  }

  if (rows.length === 0) {
    log.warn({ jobId, originalName, reportType, date }, 'ocr_ingest.no_rows_parsed');
    return;
  }

  const conflictColumn =
    table === 'daily_hotel_performance' ? 'property_name,report_date'
    : table === 'flash_report' ? 'property_name,report_date'
    : 'property_name,report_date,room_number,is_long_term';

  const { error } = await supabase
    .from(table)
    .upsert(rows, { onConflict: conflictColumn });

  if (error) {
    log.error({ jobId, table, error: error.message }, 'ocr_ingest.upsert_failed');
  } else {
    log.info({ jobId, table, rows: rows.length, date, reportType }, 'ocr_ingest.success');
  }
}
