/**
 * Report parsers — extract structured performance data from OCR text.
 * Shared between the File Scanner (scanner route) and OCR worker.
 *
 * Post-Stage-0 rules (see migration 017 + property-resolver.ts):
 *   - Every output row MUST carry property_name resolved to a canonical
 *     value via resolveProperty(). Raw extracted name goes into
 *     raw_property_name for audit.
 *   - When the raw name can't be resolved, the row still lands but with
 *     needs_review = true so it surfaces in a review queue instead of
 *     silently polluting the flash table under a variant name.
 *   - The date parameter passed in MUST be the canonical business date
 *     (from reconcileDates), not the filename date. Callers are
 *     responsible; the parsers no longer derive dates themselves.
 */

import { supabaseAdmin } from './supabase.js';
import { resolveProperty, type CanonicalProperty } from './property-resolver.js';
import { reconcileDates } from './date-reconciler.js';

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
    // Match any of the raw property name variants (KNOWN_PROPERTIES is still
    // used as the line-start regex trigger — those literals appear verbatim
    // in the PDFs). The canonicalization happens right after.
    let rawMatch: string | null = null;
    let remainder = '';
    for (const prop of KNOWN_PROPERTIES) {
      const regex = new RegExp(`^${prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[.,]?\\s*`, 'i');
      const m = trimmed.match(regex);
      if (m) { rawMatch = prop; remainder = trimmed.slice(m[0].length).replace(/\.{2,}/g, '.').trim(); break; }
    }
    if (!rawMatch) continue;

    const resolved = resolveProperty(rawMatch);
    // If the resolver couldn't land on a canonical, keep the raw value as
    // the display name and flag needs_review. The UI's canonical-keyed Map
    // won't pick this up on its own, but the admin queue can surface it.
    const canonical: string = resolved.canonical ?? rawMatch;
    const needsReview = resolved.canonical === null;

    if (seen.has(canonical)) continue;
    const tokens = remainder.match(/\(?\$?[\d,]+\.?\d*%?\)?/g) ?? [];
    if (tokens.length < 8) continue;
    seen.add(canonical);
    rows.push({
      property_name: canonical,
      raw_property_name: rawMatch,
      needs_review: needsReview,
      property_group: GROUP_MAP[canonical as CanonicalProperty] ?? 'Other',
      report_date: date,
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
      const resolved = resolveProperty(dba);
      // If unresolved, still land the row under the raw DBA so ops can fix
      // it via the needs_review queue. Prior behavior silently dropped
      // unknowns which is why numbers felt like they moved around.
      const canonical: string = resolved.canonical ?? dba.trim();
      const needsReview = resolved.canonical === null;
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      const v: Record<string, string> = {};
      for (const r of metricRows) v[r.label] = r.cells[i] ?? '';
      let occ = parseNum(v['Occupancy %']);
      if (occ != null && occ > 0 && occ <= 1) occ = Math.round(occ * 1000) / 10;
      rows.push({
        property_name: canonical,
        raw_property_name: dba,
        needs_review: needsReview,
        entity_name: '',
        property_group: GROUP_MAP[canonical as CanonicalProperty] ?? 'Other',
        report_date: date,
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
      const resolved = resolveProperty(hotel);
      const canonical: string = resolved.canonical ?? hotel.trim();
      rooms.push({
        property_name: canonical,
        raw_property_name: hotel,
        needs_review: resolved.canonical === null,
        report_date: date, room_number: roomNum,
        date_ooo: cells[2]?.trim() || null, reason: cells[3]?.trim() || null,
        notes: cells[4]?.trim() || null, is_long_term: isLongTerm,
      });
    }
  }
  return rooms;
}

// ── Single-property parsers ─────────────────────────────────────────────────
// Hotel Statistics and Final Audit PDFs cover ONE property per file. The
// aggregated Revenue Flash / Flash Report parsers above produce many rows
// per PDF; these produce exactly one. Property name comes from the header
// line ("Home2 Suites By Hilton - Tupelo, MS Date: Mar 26, 2026").

const PROPERTY_HEADER_RE = /^(.+?)\s+(?:Date Range:|Date:)\s/m;

/**
 * Parse the property name from a per-hotel PMS report header. These PDFs
 * always start with one line like:
 *   "Home2 Suites By Hilton - Tupelo, MS Date: Mar 26, 2026"
 *   "Hilton Garden Inn Meridian Date Range: Mar 26, 2026 - Mar 26, 2026"
 * Returns the raw name substring, or null.
 */
function extractPropertyFromHeader(text: string): string | null {
  const m = text.slice(0, 1000).match(PROPERTY_HEADER_RE);
  return m?.[1]?.trim() ?? null;
}

// Token shape for numeric/currency/% values. Must include at least one
// digit — a plain comma like "COMP," in a label used to match and pollute
// column-position lookups.
const VALUE_TOKEN_RE = /\(?\$?-?\d[\d,]*\.?\d*%?\)?/g;

/**
 * Pick the first numeric/currency/% token on a line. Report tables OCR with
 * 3+ spaces between columns — we take the first token after the label.
 */
function firstTokenAfterLabel(line: string, label: RegExp): string | null {
  const m = line.match(label);
  if (!m) return null;
  const after = line.slice(m.index! + m[0].length);
  VALUE_TOKEN_RE.lastIndex = 0;
  const tok = VALUE_TOKEN_RE.exec(after);
  return tok?.[0] ?? null;
}

/**
 * PMS tables sometimes wrap a long row label across 2-3 lines with the
 * numeric columns sitting on just one of those lines. Joining "label" lines
 * (those without numbers) to the next numeric line reassembles the logical
 * row so regexes can match the label AND capture the numbers in one go.
 *
 * Input:
 *   OCCUPANCY EXCLUDING
 *   DOWN, COMP, HOUSE USE 94.38 %   97.80 %   80.23 %   90.40 %   79.14 %
 *   ROOMS
 *
 * Output (one line):
 *   OCCUPANCY EXCLUDING DOWN, COMP, HOUSE USE 94.38 %   97.80 %   80.23 %   90.40 %   79.14 % ROOMS
 */
function stitchWrappedRows(text: string): string[] {
  const src = text.split('\n');
  const out: string[] = [];
  const HAS_NUM = /[\d$%]/;
  let buf = '';
  for (const line of src) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (buf) { out.push(buf); buf = ''; }
      out.push('');
      continue;
    }
    if (HAS_NUM.test(trimmed)) {
      // Numeric line — attach any preceding label buffer, emit, then
      // hold any trailing text like "ROOMS" on the next line.
      out.push((buf ? buf + ' ' : '') + trimmed);
      buf = '';
    } else {
      // Pure label / trailing-noun line. Buffer it for the next numeric row.
      buf = buf ? buf + ' ' + trimmed : trimmed;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * Find the first line matching `labelRe` and return the first numeric/%/$
 * token that appears on it. Use this when a metric row has exactly one
 * Actual-Today column we care about (5-column tables: Today / MTD / LY-MTD
 * / YTD / LY-YTD — we only want the first).
 *
 * Uses stitchWrappedRows so labels that OCR wraps across lines still match.
 */
function valueAfterLabel(text: string, labelRe: RegExp): string | null {
  for (const line of stitchWrappedRows(text)) {
    if (!labelRe.test(line)) continue;
    const tok = firstTokenAfterLabel(line, labelRe);
    if (tok) return tok;
  }
  return null;
}

/** Same as valueAfterLabel but returns the whole matching line. */
function lineMatchingLabel(text: string, labelRe: RegExp): string | null {
  for (const line of stitchWrappedRows(text)) {
    if (labelRe.test(line)) return line;
  }
  return null;
}

/**
 * Hotel Statistics PDF (per-property). Produces one row for
 * daily_hotel_performance. Column shape:
 *   Description | Actual Today | M-T-D | LY-M-T-D | Y-T-D | LY-T-D
 *
 * We pull Actual Today for occ%/ADR/RevPAR/rooms, and the first M-T-D /
 * Y-T-D values too so the dashboard's MTD/YTD columns populate.
 */
export function parseHotelStatistics(text: string, date: string): Record<string, unknown>[] {
  const raw = extractPropertyFromHeader(text);
  if (!raw) return [];

  const resolved = resolveProperty(raw);
  const canonical: string = resolved.canonical ?? raw;
  const needsReview = resolved.canonical === null;

  // Prefer the "EXCLUDING COMP, HOUSE USE" lines — those are the true
  // paid-rooms numbers every other report agrees with.
  const occLine = valueAfterLabel(text, /OCCUPANCY\s+EXCLUDING\s+DOWN,?\s*COMP,?\s*HOUSE\s*USE/i);
  const adrLine = valueAfterLabel(text, /\bADR\s+EXCLUDING\s+COMP/i);
  const revparLine = valueAfterLabel(text, /\bREVPAR\b(?!\s+With\s+Out)/i);
  const roomsSoldLine = valueAfterLabel(text, /\bROOM\s+SOLD\s+EXCLUDING/i);
  const totalRoomsLine = valueAfterLabel(text, /^Total\s+Rooms\b/mi);
  const oooLine = valueAfterLabel(text, /^OUT\s+OF\s+ORDER\b/mi);

  // "Totals" row under "Revenue Statistics → Room Revenue" is the full day's
  // room revenue (taxable + exempt). Easiest to grab by scanning for a line
  // that begins with "Totals" AFTER the "Revenue Statistics" marker.
  const revBlock = text.split(/Revenue\s+Statistics/i)[1] ?? '';
  const roomRevMatch = revBlock.match(/Totals\s+\$?([\d,]+\.\d{2})/);
  const roomRevenue = roomRevMatch ? parseNum(roomRevMatch[1]) : null;

  // Column layout of every metric row in Hotel Statistics:
  //   tokens[0] = Actual Today
  //   tokens[1] = M-T-D
  //   tokens[2] = LY-M-T-D   (prior year month-to-date)
  //   tokens[3] = Y-T-D
  //   tokens[4] = LY-T-D     (prior year to-date)
  const allCols = (line: string | null): (number | null)[] => {
    if (!line) return [];
    VALUE_TOKEN_RE.lastIndex = 0;
    const tokens: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = VALUE_TOKEN_RE.exec(line)) !== null) tokens.push(m[0]);
    return tokens.map((t) => parseNum(t));
  };
  const allPctCols = (line: string | null): (number | null)[] => {
    if (!line) return [];
    VALUE_TOKEN_RE.lastIndex = 0;
    const tokens: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = VALUE_TOKEN_RE.exec(line)) !== null) tokens.push(m[0]);
    return tokens.map((t) => parsePct(t));
  };

  const occFullLine = lineMatchingLabel(text, /OCCUPANCY\s+EXCLUDING\s+DOWN,?\s*COMP,?\s*HOUSE\s*USE/i) ?? '';
  const adrFullLine = lineMatchingLabel(text, /\bADR\s+EXCLUDING\s+COMP/i) ?? '';
  const revparFullLine = lineMatchingLabel(text, /\bREVPAR\b(?!\s+With\s+Out)/i) ?? '';

  const occCols = allPctCols(occFullLine);
  const adrCols = allCols(adrFullLine);
  const revparCols = allCols(revparFullLine);

  // Revenue Statistics → Totals row: Actual / MTD / LY-MTD / YTD / LY-YTD
  const revTokens = roomRevMatch
    ? (revBlock.match(/Totals\s+(.+)/)?.[1]?.match(/\(?\$?-?\d[\d,]*\.\d{2}\)?/g) ?? [])
    : [];

  return [{
    property_name: canonical,
    raw_property_name: raw,
    needs_review: needsReview,
    property_group: GROUP_MAP[canonical as CanonicalProperty] ?? 'Other',
    report_date: date,
    occupancy_day: parsePct(occLine ?? undefined),
    occupancy_mtd: occCols[1] ?? null,
    occupancy_ytd: occCols[3] ?? null,
    adr_day: parseNum(adrLine ?? undefined),
    adr_mtd: adrCols[1] ?? null,
    adr_ytd: adrCols[3] ?? null,
    revpar_day: parseNum(revparLine ?? undefined),
    revpar_mtd: revparCols[1] ?? null,
    revpar_ytd: revparCols[3] ?? null,
    revenue_day: roomRevenue,
    revenue_mtd: revTokens.length > 1 ? parseNum(revTokens[1]) : null,
    revenue_ytd: revTokens.length > 3 ? parseNum(revTokens[3]) : null,
    // Prior-year columns — PDF has LY-M-T-D at index 2 and LY-T-D at index 4.
    py_revenue_mtd: revTokens.length > 2 ? parseNum(revTokens[2]) : null,
    py_revenue_ytd: revTokens.length > 4 ? parseNum(revTokens[4]) : null,
    total_rooms_sold: roomsSoldLine ? parseNum(roomsSoldLine) : null,
    total_rooms_available: totalRoomsLine ? parseNum(totalRoomsLine) : null,
    ooo_rooms: oooLine ? parseNum(oooLine) : 0,
    report_format: 'hotel-statistics',
  }];
}

/**
 * Hotel Statistics → flash_report shape. Same PDF as parseHotelStatistics
 * but emits the operating-metrics columns the Flash Report dashboard needs
 * (occupancy_pct, adr, revpar, room_revenue). AR fields stay null — those
 * live in a separate report type.
 */
export function parseHotelStatisticsForFlash(text: string, date: string): Record<string, unknown>[] {
  const raw = extractPropertyFromHeader(text);
  if (!raw) return [];

  const resolved = resolveProperty(raw);
  const canonical: string = resolved.canonical ?? raw;
  const needsReview = resolved.canonical === null;

  const occ = valueAfterLabel(text, /OCCUPANCY\s+EXCLUDING\s+DOWN,?\s*COMP,?\s*HOUSE\s*USE/i);
  const adr = valueAfterLabel(text, /\bADR\s+EXCLUDING\s+COMP/i);
  const revpar = valueAfterLabel(text, /\bREVPAR\b(?!\s+With\s+Out)/i);
  const roomsSold = valueAfterLabel(text, /\bROOM\s+SOLD\s+EXCLUDING/i);
  const oooLine = valueAfterLabel(text, /^OUT\s+OF\s+ORDER\b/mi);
  const dirtyLine = valueAfterLabel(text, /^DIRTY\b/mi);

  const revBlock = text.split(/Revenue\s+Statistics/i)[1] ?? '';
  const roomRevMatch = revBlock.match(/Totals\s+\$?([\d,]+\.\d{2})/);

  return [{
    property_name: canonical,
    raw_property_name: raw,
    needs_review: needsReview,
    entity_name: '',
    property_group: GROUP_MAP[canonical as CanonicalProperty] ?? 'Other',
    report_date: date,
    occupancy_pct: parsePct(occ ?? undefined),
    adr: parseNum(adr ?? undefined),
    revpar: parseNum(revpar ?? undefined),
    room_revenue: roomRevMatch ? parseNum(roomRevMatch[1]) : null,
    rooms_occupied: roomsSold ? parseNum(roomsSold) : null,
    rooms_ooo: oooLine ? parseNum(oooLine) : 0,
    rooms_dirty: dirtyLine ? parseNum(dirtyLine) : null,
  }];
}

/**
 * Final Audit PDF (per-property). Contributes one row to flash_report with
 * room_revenue filled in; AR aging comes from a different report, so those
 * fields stay null.
 *
 * Column shape in the Room Revenue block:
 *   Charge Type | Actual Today | Adjusted | Adjusted Transferred | Net Today | M-T-D | LY-M-T-D | Variance | Y-T-D | LY-T-D | Variance
 *
 * We want Actual Today (column 1) from the "Totals" row of "Room Revenue".
 */
export function parseFinalAudit(text: string, date: string): Record<string, unknown>[] {
  const raw = extractPropertyFromHeader(text);
  if (!raw) return [];

  const resolved = resolveProperty(raw);
  const canonical: string = resolved.canonical ?? raw;
  const needsReview = resolved.canonical === null;

  // Scope to the "Room Revenue" block — the one that matches Hotel
  // Statistics' Revenue Totals. "Other Room Revenue" block uses the same
  // "Totals" label so we split on it first.
  const roomRevenueBlock = text.split(/Other\s+Room\s+Revenue/i)[0] ?? text;
  const totalsLine = roomRevenueBlock.split('\n').find((l) => /^\s*Totals\b/.test(l)) ?? '';
  const firstAmount = totalsLine.match(/\$?\(?([-\d,]+\.\d{2})\)?/);
  const roomRevenue = firstAmount ? parseNum(firstAmount[1]) : null;
  if (roomRevenue === null) return [];

  return [{
    property_name: canonical,
    raw_property_name: raw,
    needs_review: needsReview,
    entity_name: '',
    property_group: GROUP_MAP[canonical as CanonicalProperty] ?? 'Other',
    report_date: date,
    room_revenue: roomRevenue,
    // Other flash_report fields not sourced by Final Audit — leave null.
  }];
}

// ── Report type detection ───────────────────────────────────────────────────

export type ReportType =
  | 'revenue-flash'
  | 'flash-report'
  | 'engineering'
  | 'hotel-statistics'
  | 'final-audit'
  | 'unknown';

export function detectReportType(filename: string): ReportType {
  const lower = filename.toLowerCase();
  if (lower.includes('revenue') && lower.includes('flash')) return 'revenue-flash';
  if (lower.includes('hotel-statistics') || lower.includes('hotel statistics')) return 'hotel-statistics';
  if (lower.includes('final-audit') || lower.includes('final audit')) return 'final-audit';
  if (lower.includes('flash') && lower.includes('report') && !lower.includes('revenue')) return 'flash-report';
  if (lower.includes('engineering') && lower.includes('flash') && !lower.includes('template')) return 'engineering';
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

  // Resolve the canonical business date via the same reconciler the OCR
  // worker uses for ocr_jobs. business_date from the PDF body is the source
  // of truth; the filename date is weak evidence. If neither produces a
  // date, skip the ingest entirely — landing a row on a wrong date is
  // worse than landing no row at all.
  const filenameDate = extractDateFromFilename(originalName);
  const category = reportType === 'revenue-flash' || reportType === 'flash-report'
    ? 'Revenue'
    : reportType === 'engineering'
      ? 'Maintenance'
      : 'Uncategorized';
  const reconciled = reconcileDates({ filenameDate, fullText, category });
  const date = reconciled.businessDate ?? filenameDate;
  if (!date) {
    log.warn({ jobId, originalName, warnings: reconciled.warnings.map((w) => w.code) }, 'ocr_ingest.no_business_date');
    return;
  }
  if (reconciled.warnings.length > 0) {
    log.info({ jobId, originalName, warnings: reconciled.warnings.map((w) => w.code), date }, 'ocr_ingest.date_warnings');
  }

  const supabase = supabaseAdmin();
  // One PDF can feed multiple tables (e.g. Hotel Statistics fills both
  // daily_hotel_performance and flash_report), so we accumulate targets.
  const targets: Array<{ table: string; rows: Record<string, unknown>[]; partial: boolean }> = [];

  if (reportType === 'revenue-flash') {
    targets.push({ table: 'daily_hotel_performance', rows: parseRevenueFlash(fullText, date), partial: false });
  } else if (reportType === 'flash-report') {
    targets.push({ table: 'flash_report', rows: parseFlashReport(fullText, date), partial: false });
  } else if (reportType === 'engineering') {
    targets.push({ table: 'engineering_ooo_rooms', rows: parseEngineering(fullText, date), partial: false });
  } else if (reportType === 'hotel-statistics') {
    // Hotel Statistics feeds BOTH tables — it has operating metrics that
    // match what Revenue Flash / Flash Report dashboards show.
    targets.push({ table: 'daily_hotel_performance', rows: parseHotelStatistics(fullText, date), partial: true });
    targets.push({ table: 'flash_report', rows: parseHotelStatisticsForFlash(fullText, date), partial: true });
  } else if (reportType === 'final-audit') {
    targets.push({ table: 'flash_report', rows: parseFinalAudit(fullText, date), partial: true });
  }

  const totalRows = targets.reduce((sum, t) => sum + t.rows.length, 0);
  if (totalRows === 0) {
    log.warn({ jobId, originalName, reportType, date }, 'ocr_ingest.no_rows_parsed');
    return;
  }

  const extractedAt = new Date().toISOString();
  for (const target of targets) {
    if (target.rows.length === 0) continue;

    const stampedRows = target.rows.map((r) => ({
      ...r,
      source_ocr_job_id: jobId,
      extracted_at: extractedAt,
    }));

    const conflictColumn =
      target.table === 'daily_hotel_performance' ? 'property_name,report_date'
      : target.table === 'flash_report' ? 'property_name,report_date'
      : 'property_name,report_date,room_number,is_long_term';

    // Partial-row parsers (Hotel Statistics, Final Audit) fill a subset of
    // columns. Merge with any existing row so a later PDF doesn't null out
    // fields an earlier PDF filled in.
    const finalRows = target.partial
      ? await mergeWithExisting(supabase, target.table, stampedRows)
      : stampedRows;

    const { error } = await supabase
      .from(target.table)
      .upsert(finalRows, { onConflict: conflictColumn });

    if (error) {
      log.error({ jobId, table: target.table, error: error.message }, 'ocr_ingest.upsert_failed');
    } else {
      const reviewCount = finalRows.filter((r) => (r as Record<string, unknown>).needs_review === true).length;
      log.info({ jobId, table: target.table, rows: finalRows.length, reviewCount, date, reportType, merged: target.partial }, 'ocr_ingest.success');
    }
  }
}

/**
 * Fetch existing rows by (property_name, report_date) and overlay non-null
 * new fields on top. Preserves data written by a prior PDF type (e.g. a
 * Flash Report setting occupancy_pct shouldn't be wiped when a Final Audit
 * only fills room_revenue).
 */
async function mergeWithExisting(
  supabase: ReturnType<typeof supabaseAdmin>,
  table: string,
  rows: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const merged: Record<string, unknown>[] = [];
  for (const incoming of rows) {
    const propName = incoming.property_name as string;
    const reportDate = incoming.report_date as string;
    const { data: existing } = await supabase
      .from(table)
      .select('*')
      .eq('property_name', propName)
      .eq('report_date', reportDate)
      .maybeSingle();

    if (!existing) {
      merged.push(incoming);
      continue;
    }

    // Keep existing values except where `incoming` has a non-null value.
    const overlay: Record<string, unknown> = { ...(existing as Record<string, unknown>) };
    for (const [k, v] of Object.entries(incoming)) {
      if (v !== null && v !== undefined) overlay[k] = v;
    }
    merged.push(overlay);
  }
  return merged;
}
