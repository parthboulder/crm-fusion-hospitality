/**
 * Reconcile the three date sources on an OCR-classified report:
 *   - filename date       (weakest; properties name files inconsistently)
 *   - business date       (from the PDF body "Date:" / "Business Date:" field)
 *   - report generated at (from the PDF body run-timestamp, if present)
 *
 * Rules (per ops guidance):
 *   1. business_date is canonical — prefer the PDF body, fall back to
 *      filename only when the body has no date. Mark DATE_SOURCE_MISSING
 *      when we fell back.
 *   2. Night-audit reports (category === 'Night Audit') have an expected
 *      1-day offset between the business date and the filename/folder date.
 *      Don't flag that as an anomaly; flag *larger* drift as FILENAME_DATE_DRIFT.
 *   3. Late audit — if report_generated_at - business_date > 1 day, flag as
 *      LATE_AUDIT (auditor didn't close on time, or reports were re-run).
 *   4. Year anomaly — filename year differs from business-date year by 1+
 *      years, flag as YEAR_MISMATCH (likely PMS template with hardcoded year
 *      or staff typo).
 *
 * Extraction strategy (why it's label-driven, not regex-soup):
 *   PMS reports embed many dates — the business day, the report run
 *   timestamp, copyright footers, version strings, per-row date columns.
 *   A greedy regex over the whole head picks up noise. Instead we only
 *   accept a date that sits next to a known label ("Business Date",
 *   "Date Range", "For Date", etc.), and we walk the labels in priority
 *   order. Bare-date fallback only fires when no label matched and we're
 *   willing to guess — and even then we sanity-check the year.
 */

export type WarningCode =
  | 'YEAR_MISMATCH'
  | 'LATE_AUDIT'
  | 'DATE_SOURCE_MISSING'
  | 'FILENAME_DATE_DRIFT';

export interface Warning {
  code: WarningCode;
  message: string;
  detail?: Record<string, unknown>;
}

export interface ReconcileInput {
  /** YYYY-MM-DD parsed from filename, or null if none found. */
  filenameDate: string | null;
  /** Full OCR text — the body of the document. */
  fullText: string;
  /** Classified category (e.g. 'Night Audit'), used for offset rules. */
  category: string;
}

export interface ReconcileResult {
  /** Canonical business day. YYYY-MM-DD, or null when nothing parseable found. */
  businessDate: string | null;
  /** When the report was run — ISO 8601 timestamp, or null when not present. */
  reportGeneratedAt: string | null;
  /** Echoed back from input for convenient persistence. */
  filenameDate: string | null;
  warnings: Warning[];
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;

// Reject years outside this window — they're almost certainly OCR noise or
// a copyright footer, not the report's business date.
const MIN_PLAUSIBLE_YEAR = 2000;
const MAX_PLAUSIBLE_YEAR = new Date().getUTCFullYear() + 2;

function padIso(y: number, m: number, d: number): string | null {
  if (y < MIN_PLAUSIBLE_YEAR || y > MAX_PLAUSIBLE_YEAR) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Reject impossible day-of-month (Feb 31 etc.) via Date round-trip.
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function monthFromName(raw: string): number {
  const idx = MONTH_NAMES.indexOf(raw.slice(0, 3).toLowerCase() as (typeof MONTH_NAMES)[number]);
  return idx < 0 ? 0 : idx + 1;
}

function twoDigitYear(yy: number): number {
  // Treat 00–69 as 2000–2069 and 70–99 as 1970–1999. PMS data won't pre-date
  // 2000 in practice, but we keep this conservative to avoid 1926 interpretations.
  return yy >= 70 ? 1900 + yy : 2000 + yy;
}

/** Result of parsing one date literal, with the raw matched text kept for logs. */
interface ParsedDate {
  iso: string;
  raw: string;
}

/**
 * Find every date-like literal in `text` and return them in order of
 * appearance. Handles:
 *   - MM/DD/YYYY, MM.DD.YY, M-D-YY      (digits + separators)
 *   - Mar 27, 2026 / March 27 2026      (month name + day + year)
 *   - 26-Mar-2026 / 26-Mar-26            (day + month name + year, hyphenated)
 *   - 2026-03-27                         (ISO)
 *
 * Each candidate is validated via padIso — impossible dates are dropped,
 * so "05:07:29" won't get parsed as a date, and neither will "2020-99-99".
 */
export function findAllDates(text: string): ParsedDate[] {
  const out: ParsedDate[] = [];

  // Track spans we've already consumed so overlapping patterns don't double-count.
  const consumed: Array<[number, number]> = [];
  const overlaps = (start: number, end: number): boolean =>
    consumed.some(([a, b]) => !(end <= a || start >= b));
  const record = (start: number, end: number, iso: string, raw: string): void => {
    consumed.push([start, end]);
    out.push({ iso, raw });
  };

  const add = (pattern: RegExp, fn: (m: RegExpExecArray) => string | null): void => {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (overlaps(start, end)) continue;
      const iso = fn(m);
      if (iso) record(start, end, iso, m[0]);
    }
  };

  // ISO first — unambiguous.
  add(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m) =>
    padIso(parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)),
  );

  // "26-Mar-2026" or "26-Mar-26" — day first, hyphenated month name.
  add(/\b(\d{1,2})-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)-(\d{2}|\d{4})\b/gi, (m) => {
    const d = parseInt(m[1]!, 10);
    const mo = monthFromName(m[2]!);
    const yraw = parseInt(m[3]!, 10);
    const y = m[3]!.length === 2 ? twoDigitYear(yraw) : yraw;
    return padIso(y, mo, d);
  });

  // "Mar 27, 2026" or "March 27 2026".
  add(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/gi, (m) =>
    padIso(parseInt(m[3]!, 10), monthFromName(m[1]!), parseInt(m[2]!, 10)),
  );

  // "03/27/2026", "3.27.26", "03-27-26" — digit separators.
  add(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})\b/g, (m) => {
    const mo = parseInt(m[1]!, 10);
    const d = parseInt(m[2]!, 10);
    const yraw = parseInt(m[3]!, 10);
    const y = m[3]!.length === 2 ? twoDigitYear(yraw) : yraw;
    return padIso(y, mo, d);
  });

  // Re-sort by position so callers see dates in document order.
  const indexed = out.map((d, i) => ({ d, pos: consumed[i]![0] }));
  indexed.sort((a, b) => a.pos - b.pos);
  return indexed.map((x) => x.d);
}

/**
 * Try to extract a business date by looking near known labels. Returns the
 * first sensible match — a date that appears within ~60 chars after a label
 * we recognize. Returns null when nothing labelled was found; callers decide
 * whether to fall back or give up.
 */
function extractLabelledBusinessDate(text: string): ParsedDate | null {
  const head = text.slice(0, 8000);

  // Labels in priority order. First match wins.
  const labels: Array<{ pattern: RegExp; takeEndOfRange: boolean }> = [
    { pattern: /business\s*date\b/i,            takeEndOfRange: false },
    { pattern: /\bfor\s*date\b/i,               takeEndOfRange: false },
    { pattern: /\baudit\s*date\b/i,             takeEndOfRange: false },
    { pattern: /\bas\s*of\s*date\b/i,           takeEndOfRange: false },
    { pattern: /\bperiod\s*ending\b/i,          takeEndOfRange: false },
    // "Date Range: Mar 26, 2026 - Mar 26, 2026" — the business day is the
    // END of the range (the last day being reported on).
    { pattern: /\bdate\s*range\b/i,             takeEndOfRange: true  },
    { pattern: /\breport\s*(?:for|of)\s*date\b/i, takeEndOfRange: false },
    { pattern: /\bstatement\s*date\b/i,         takeEndOfRange: false },
    // Bare "Date:" — lowest priority because "Report run date:" and similar
    // will be caught here if nothing more specific fired. Explicit colon
    // required so we don't match "Date Range".
    { pattern: /(?:^|[^a-z])date\s*:/i,         takeEndOfRange: false },
  ];

  for (const { pattern, takeEndOfRange } of labels) {
    const m = pattern.exec(head);
    if (!m) continue;
    // Window: 80 chars after the label. Enough for a range, not enough to
    // reach the next PMS field.
    const start = m.index + m[0].length;
    const window = head.slice(start, start + 80);
    const dates = findAllDates(window);
    if (dates.length === 0) continue;
    return takeEndOfRange ? dates[dates.length - 1]! : dates[0]!;
  }

  return null;
}

/**
 * All distinct dates found anywhere in the text, normalized to YYYY-MM-DD,
 * sorted ascending. Used by the UI to show every date the document
 * references (table rows, range bounds, run timestamps).
 */
export function extractUniqueDates(text: string): string[] {
  const set = new Set<string>();
  for (const d of findAllDates(text)) set.add(d.iso);
  return [...set].sort();
}

export function extractBusinessDate(text: string): string | null {
  const labelled = extractLabelledBusinessDate(text);
  if (labelled) return labelled.iso;

  // No label matched. Take the first date in the head — better than nothing,
  // but the caller will still flag DATE_SOURCE_MISSING because this is
  // guessy. We pick the first so a header-line "Mar 26, 2026" wins over a
  // transaction row deeper in the document.
  const anyDates = findAllDates(text.slice(0, 4000));
  return anyDates[0]?.iso ?? null;
}

/**
 * Extract the "report generated at" timestamp. PMS reports print it in the
 * header as "Report run date: X\nReport run time: HH:MM:SS" or "Run Date:"
 * / "Printed:" / "Generated:".
 */
export function extractReportGeneratedAt(text: string): string | null {
  const head = text.slice(0, 8000);

  const labels = [
    /report\s*run\s*date\b/i,
    /\brun\s*date\b/i,
    /\bprinted\b/i,
    /\bgenerated\b/i,
    /\brun\s*at\b/i,
  ];

  let datePart: string | null = null;
  let labelEnd = -1;
  for (const pattern of labels) {
    const m = pattern.exec(head);
    if (!m) continue;
    const start = m.index + m[0].length;
    const window = head.slice(start, start + 80);
    const dates = findAllDates(window);
    if (dates.length === 0) continue;
    datePart = dates[0]!.iso;
    labelEnd = start;
    break;
  }
  if (!datePart) return null;

  // Look for a companion time in the next ~120 chars — often on the next line
  // as "Report run time: 05:07:29".
  const timeWindow = head.slice(labelEnd, labelEnd + 200);
  const t = timeWindow.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
  let hh = 0;
  let mm = 0;
  let ss = 0;
  if (t) {
    hh = parseInt(t[1]!, 10);
    mm = parseInt(t[2]!, 10);
    ss = t[3] ? parseInt(t[3]!, 10) : 0;
    const ampm = t[4]?.toLowerCase();
    if (ampm === 'pm' && hh < 12) hh += 12;
    if (ampm === 'am' && hh === 12) hh = 0;
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) {
      hh = 0; mm = 0; ss = 0;
    }
  }

  const iso = `${datePart}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}Z`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

function diffDays(a: string, b: string): number {
  const ms = new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}

export function reconcileDates(input: ReconcileInput): ReconcileResult {
  const warnings: Warning[] = [];

  const labelled = extractLabelledBusinessDate(input.fullText);
  const generatedAt = extractReportGeneratedAt(input.fullText);

  let businessDate: string | null = labelled?.iso ?? null;
  if (!businessDate) {
    // Fall back — first date in the head, then the filename. Both are
    // guesses, so we flag DATE_SOURCE_MISSING either way.
    const unlabelled = findAllDates(input.fullText.slice(0, 4000));
    businessDate = unlabelled[0]?.iso ?? input.filenameDate;
    if (businessDate) {
      warnings.push({
        code: 'DATE_SOURCE_MISSING',
        message: 'No labelled business date found in document body; using best-effort fallback.',
        detail: { fallback: businessDate, usedFilename: !unlabelled[0] },
      });
    }
  }

  const isNightAudit = input.category === 'Night Audit';
  const expectedOffset = isNightAudit ? 1 : 0;

  if (businessDate && input.filenameDate) {
    const drift = diffDays(input.filenameDate, businessDate);
    if (Math.abs(drift - expectedOffset) >= 1) {
      warnings.push({
        code: 'FILENAME_DATE_DRIFT',
        message: `Filename date is ${drift} day(s) off from business date (expected ${expectedOffset}).`,
        detail: { filenameDate: input.filenameDate, businessDate, drift, expectedOffset },
      });
    }

    const yearDrift = Math.abs(
      new Date(`${input.filenameDate}T00:00:00Z`).getUTCFullYear() -
      new Date(`${businessDate}T00:00:00Z`).getUTCFullYear(),
    );
    if (yearDrift >= 1) {
      warnings.push({
        code: 'YEAR_MISMATCH',
        message: `Filename year differs from business-date year by ${yearDrift} year(s). Likely a PMS template with a hardcoded year or a staff typo.`,
        detail: { filenameDate: input.filenameDate, businessDate },
      });
    }
  }

  if (businessDate && generatedAt) {
    const genDay = generatedAt.slice(0, 10);
    const delta = diffDays(genDay, businessDate);
    const tolerance = isNightAudit ? 1 : 0;
    if (delta - tolerance > 1) {
      warnings.push({
        code: 'LATE_AUDIT',
        message: `Report was generated ${delta} day(s) after the business date (tolerance ${tolerance}). Audit may not have closed on time, or reports were re-run.`,
        detail: { businessDate, reportGeneratedAt: generatedAt, deltaDays: delta, tolerance },
      });
    }
  }

  return {
    businessDate,
    reportGeneratedAt: generatedAt,
    filenameDate: input.filenameDate,
    warnings,
  };
}
