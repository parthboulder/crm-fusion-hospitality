/**
 * Ingestion script: parses scan output (output.json) and pushes
 * all extracted data to Supabase tables.
 *
 * Usage: npx tsx scripts/ingest-to-supabase.ts [path-to-output.json]
 *
 * Tables written:
 *   - daily_hotel_performance (Revenue Flash data)
 *   - flash_report (Flash Report data)
 *   - engineering_ooo_rooms (Engineering Flash data)
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// --- Config ---
const SUPABASE_URL = process.env['SUPABASE_URL'] || process.env['VITE_SUPABASE_URL'] || '';
const SUPABASE_SERVICE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'] || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing env vars. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  console.error('Example: SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=eyJ... npx tsx scripts/ingest-to-supabase.ts');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// --- Load output.json ---
const outputPath = process.argv[2] || resolve(__dirname, '../apps/web/public/data/output.json');
console.log('Loading:', outputPath);
const data = JSON.parse(readFileSync(outputPath, 'utf8'));
const results: any[] = data.results ?? [];
console.log(`Loaded ${results.length} scan results`);

// --- Revenue Flash Parser (inline, simplified) ---
const KNOWN_PROPERTIES = [
  'Candlewood Suites', 'Holiday Inn Express Fulton', 'Holiday Inn Express Memphis Southwind',
  'Holiday Inn Express Tupelo', 'Holiday Inn Tupelo', 'Four Points Memphis Southwind',
  'Best Western Tupelo', 'Surestay Tupelo', 'SureStay Tupelo', 'Hyatt Place Biloxi',
  'Comfort Inn Tupelo', 'Hilton Garden Inn Olive Branch', 'TownePlace Suites',
  'Best Western Plus Olive Branch', 'Best Western Plus DeSoto',
  'Home 2 Suites by Hilton Tupelo', 'Home2 Suites by Hilton Tupelo',
  'Tru by Hilton Tupelo', 'Tru by Hilton Tueplo', // OCR typo variant
  'Holiday Inn Meridian', 'Hilton Garden Inn Meridian',
  'Hampton Inn Meridian', 'Hampton Inn Vicksburg', 'DoubleTree Biloxi', 'Hilton Garden Inn Madison',
];

const NAME_MAP: Record<string, string> = {
  'Surestay Tupelo': 'SureStay Hotel', 'SureStay Tupelo': 'SureStay Hotel',
  'Hilton Garden Inn Olive Branch': 'HGI Olive Branch',
  'Home 2 Suites by Hilton Tupelo': 'Home2 Suites By Hilton',
  'Home2 Suites by Hilton Tupelo': 'Home2 Suites By Hilton',
  'Tru by Hilton Tupelo': 'Tru By Hilton Tupelo',
  'Tru by Hilton Tueplo': 'Tru By Hilton Tupelo', // OCR typo
  'Best Western Plus DeSoto': 'Best Western Plus Olive Branch',
};

const GROUP_MAP: Record<string, string> = {
  'HGI Olive Branch': 'Hilton', 'Tru By Hilton Tupelo': 'Hilton', 'Hampton Inn Vicksburg': 'Hilton',
  'DoubleTree Biloxi': 'Hilton', 'Home2 Suites By Hilton': 'Hilton', 'Hilton Garden Inn Madison': 'Hilton',
  'Hilton Garden Inn Meridian': 'Hilton', 'Hampton Inn Meridian': 'Hilton',
  'Holiday Inn Meridian': 'IHG', 'Candlewood Suites': 'IHG', 'Holiday Inn Express Fulton': 'IHG',
  'Holiday Inn Express Memphis Southwind': 'IHG', 'Holiday Inn Express Tupelo': 'IHG', 'Holiday Inn Tupelo': 'IHG',
  'Four Points Memphis Southwind': 'Marriott', 'TownePlace Suites': 'Marriott',
  'Best Western Tupelo': 'Best Western', 'SureStay Hotel': 'Best Western', 'Best Western Plus Olive Branch': 'Best Western',
  'Hyatt Place Biloxi': 'Hyatt', 'Comfort Inn Tupelo': 'Choice',
};

function parseNum(s: string | undefined): number | null {
  if (!s) return null;
  let c = s.replace(/[$,%\s]/g, '');
  if (c.startsWith('(') && c.endsWith(')')) c = '-' + c.slice(1, -1);
  const v = parseFloat(c);
  return isNaN(v) ? null : v;
}

function parsePct(s: string | undefined): number | null {
  if (!s) return null;
  const v = parseFloat(s.replace(/[%\s]/g, ''));
  if (isNaN(v)) return null;
  // Decimal fraction (0.42 = 42%, 1.00 = 100%) — hotel occupancy is never truly <= 1%
  if (v > 0 && v <= 1) return Math.round(v * 10000) / 100;
  return v;
}

function parseRevenueFlash(text: string, date: string): any[] {
  const rows: any[] = [];
  const seen = new Set<string>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let matched: string | null = null;
    let remainder = '';
    for (const prop of KNOWN_PROPERTIES) {
      const regex = new RegExp(`^${prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[.,]?\\s*`, 'i');
      const m = trimmed.match(regex);
      if (m) { matched = prop; remainder = trimmed.slice(m[0].length).trim(); break; }
    }
    if (!matched) continue;
    const canonical = NAME_MAP[matched] ?? matched;
    if (seen.has(canonical)) continue;
    // Fix OCR artifacts: double dots (e.g. "106..46" → "106.46")
    const cleaned = remainder.replace(/\.{2,}/g, '.');
    const tokens = cleaned.match(/\(?\$?[\d,]+\.?\d*%?\)?/g) ?? [];
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

// --- Flash Report Parser (inline) ---
const DBA_MAP: Record<string, string> = {
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

function parseFlashReport(text: string, date: string): any[] {
  const rows: any[] = [];
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
        // Stop before Portfolio Total summary rows that would overwrite per-property data
        if (/^(Portfolio Total|Total Outstanding)/i.test(label)) break;
        if (label === 'DBA') dbaRow = dataCells;
        else if (label === 'Entity Name' || label === 'Date' || /^\d{2}\/\d{2}\/\d{4}/.test(label)) {}
        else if (label === 'Total' || (!cells[0]?.trim() && !cells[1]?.trim() && dataCells[0] && !/^\d{1,2}\/\d{1,2}\/\d{4}/.test(dataCells[0]))) metricRows.push({ label: 'AR Total', cells: dataCells });
        else if (label) metricRows.push({ label, cells: dataCells });
      } else {
        const parts = line.split(/\s{3,}/).map((s: string) => s.trim()).filter(Boolean);
        const label = parts[0] ?? '';
        const cells = parts.slice(1);
        // Stop before Portfolio Total summary rows
        if (/^(Portfolio Total|Total Outstanding)/i.test(label)) break;
        if (label === 'DBA') dbaRow = cells;
        else if (label === 'Entity Name' || label === 'Date' || /^\d{1,2}\/\d{1,2}\/\d{4}/.test(label)) {}
        else if (label === 'Total') metricRows.push({ label: 'AR Total', cells });
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

// --- Engineering Parser (inline) ---
const HOTEL_MAP: Record<string, string> = {
  'bw tupelo': 'Best Western Tupelo', 'hie fulton': 'Holiday Inn Express Fulton',
  'hi tupelo': 'Holiday Inn Tupelo', 'comfort inn tupelo': 'Comfort Inn Tupelo',
  'candlewood tupelo': 'Candlewood Suites', 'hie tupelo': 'Holiday Inn Express Tupelo',
  'tru tupelo': 'Tru By Hilton Tupelo', 'tru by hilton tupelo': 'Tru By Hilton Tupelo',
  'home 2 suites': 'Home2 Suites By Hilton',
  'hyatt biloxi': 'Hyatt Place Biloxi', 'hyatt place biloxi': 'Hyatt Place Biloxi',
  'tps olive branch': 'TownePlace Suites', 'towneplace olive branch': 'TownePlace Suites',
  'hgi olive branch': 'HGI Olive Branch',
  'hilton garden inn olive branch': 'HGI Olive Branch', 'bw plus ob': 'Best Western Plus Olive Branch',
  'best western plus desoto': 'Best Western Plus Olive Branch',
  'hgi madison': 'Hilton Garden Inn Madison', 'holiday inn meridian': 'Holiday Inn Meridian',
  'hampton inn meridian': 'Hampton Inn Meridian', 'hgi meridian': 'Hilton Garden Inn Meridian',
  'hampton inn vicksburg': 'Hampton Inn Vicksburg', 'doubletree biloxi': 'DoubleTree Biloxi',
  'fp southwind': 'Four Points Memphis Southwind', 'four points memphis southwind': 'Four Points Memphis Southwind',
  'hie southwind': 'Holiday Inn Express Memphis Southwind',
  'hie memphis southwind': 'Holiday Inn Express Memphis Southwind',
  'surestay tupelo': 'SureStay Hotel',
  'hie olive branch': 'Holiday Inn Express Olive Branch',
};

function parseEngineering(text: string, date: string): any[] {
  // Normalize \r\n inside cells to spaces — prevents phantom rows and truncated reasons
  const normalized = text.replace(/\r\n/g, ' ').replace(/\r/g, '');
  const rooms: any[] = [];
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

// --- Main ingestion ---
async function ingest() {
  const allDates = [...new Set(results.map((r: any) => r.dateFolder).filter(Boolean))].sort();
  console.log(`Found ${allDates.length} dates:`, allDates.join(', '));

  let totalRF = 0, totalFR = 0, totalEng = 0;

  for (const date of allDates) {
    console.log(`\n--- Processing ${date} ---`);

    // 1. Revenue Flash
    const rfFiles = results.filter((r: any) => r.dateFolder === date && r.reportType === 'Revenue Flash' && r.fullText)
      .sort((a: any, b: any) => (b.fullText?.length ?? 0) - (a.fullText?.length ?? 0));

    const rfRows: any[] = [];
    const rfSeen = new Set<string>();
    for (const rf of rfFiles) {
      for (const row of parseRevenueFlash(rf.fullText, date)) {
        if (!rfSeen.has(row.property_name)) { rfSeen.add(row.property_name); rfRows.push(row); }
      }
    }

    if (rfRows.length > 0) {
      const { error } = await supabase.from('daily_hotel_performance').upsert(rfRows, { onConflict: 'property_name,report_date' });
      if (error) console.error('  RF error:', error.message);
      else { console.log(`  Revenue Flash: ${rfRows.length} rows`); totalRF += rfRows.length; }
    }

    // 2. Flash Report
    const frFiles = results.filter((r: any) => r.dateFolder === date && r.fileName?.toLowerCase().includes('flash report') && !r.fileName?.toLowerCase().includes('revenue') && r.fullText)
      .sort((a: any, b: any) => { const ap = a.extension === '.pdf' ? 1 : 0; const bp = b.extension === '.pdf' ? 1 : 0; return bp - ap; });

    if (frFiles.length > 0) {
      const frRows = parseFlashReport(frFiles[0].fullText, date);
      if (frRows.length > 0) {
        const { error } = await supabase.from('flash_report').upsert(frRows, { onConflict: 'property_name,report_date' });
        if (error) console.error('  FR error:', error.message);
        else { console.log(`  Flash Report: ${frRows.length} rows`); totalFR += frRows.length; }
      }
    }

    // 3. Engineering Flash
    const engFiles = results.filter((r: any) => r.dateFolder === date && r.fileName?.toLowerCase().includes('engineering flash') && !r.fileName?.toLowerCase().includes('template') && r.fullText)
      .sort((a: any, b: any) => (b.fullText?.length ?? 0) - (a.fullText?.length ?? 0));

    if (engFiles.length > 0) {
      const engRows = parseEngineering(engFiles[0].fullText, date);
      if (engRows.length > 0) {
        const { error } = await supabase.from('engineering_ooo_rooms').upsert(engRows, { onConflict: 'property_name,report_date,room_number,is_long_term' });
        if (error) console.error('  Eng error:', error.message);
        else { console.log(`  Engineering: ${engRows.length} rows`); totalEng += engRows.length; }
      }
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Revenue Flash: ${totalRF} rows`);
  console.log(`Flash Report: ${totalFR} rows`);
  console.log(`Engineering: ${totalEng} rows`);
}

ingest().catch(console.error);
