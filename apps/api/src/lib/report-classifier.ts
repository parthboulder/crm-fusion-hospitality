/**
 * Report classifier — derives reportType, category, property, dateFolder
 * from a filename and (optionally) extracted document text.
 *
 * Two call sites:
 *   1. Upload time — only filename available; produces low-confidence guesses.
 *   2. Post-OCR    — re-classify with full text; usually upgrades to high confidence.
 *
 * Rules ported from scripts/scanWithOCR-local.ts so the OCR pipeline classifies
 * the same way the legacy scanner did.
 */

interface ContentRule {
  contentPatterns: RegExp[];
  tableHeaderPatterns?: RegExp[];
  reportType: string;
  category: string;
  priority: number;
}

const CONTENT_RULES: ContentRule[] = [
  // Revenue & Performance
  { contentPatterns: [/Revenue Flash/i, /Occ\s*%.*ADR.*RevPAR/i], reportType: 'Revenue Flash', category: 'Revenue', priority: 100 },
  { contentPatterns: [/Revenue Activity/i], tableHeaderPatterns: [/Rate Plan/i], reportType: 'Revenue Activity', category: 'Revenue', priority: 90 },
  { contentPatterns: [/Revenue Summary/i], tableHeaderPatterns: [/Room.*Tax.*Phone/i], reportType: 'Revenue Summary', category: 'Revenue', priority: 90 },
  { contentPatterns: [/Revenue Report|revenue\s*report/i], reportType: 'Revenue Report', category: 'Revenue', priority: 80 },
  { contentPatterns: [/Daily Revenue/i], reportType: 'Daily Revenue Report', category: 'Revenue', priority: 85 },
  { contentPatterns: [/Rate Report|Rate Variance/i], reportType: 'Rate Report', category: 'Revenue', priority: 80 },
  { contentPatterns: [/Financial.*Payment.*Revenue|Financial.*Revenue/i], reportType: 'Financial Revenue', category: 'Revenue', priority: 80 },
  { contentPatterns: [/Market Segment/i], tableHeaderPatterns: [/Segment.*Code.*Stays.*ADR/i], reportType: 'Market Segment Summary', category: 'Revenue', priority: 90 },
  { contentPatterns: [/Daily Segmentation/i], reportType: 'Daily Segmentation', category: 'Revenue', priority: 80 },
  { contentPatterns: [/Booking Statistics/i], reportType: 'Booking Statistics', category: 'Revenue', priority: 80 },
  { contentPatterns: [/MARSHA Production|marsha production/i], reportType: 'Marsha Production', category: 'Revenue', priority: 80 },
  { contentPatterns: [/PTD.*YTD.*Management|PTDYTDMNGMNT/i], reportType: 'PTD/YTD Management', category: 'Revenue', priority: 85 },
  { contentPatterns: [/Combined Sales/i], reportType: 'Combined Sales', category: 'Revenue', priority: 80 },

  // Night Audit / Performance
  { contentPatterns: [/Hotel Statistics/i], tableHeaderPatterns: [/Room Statistics|Performance Statistics/i], reportType: 'Hotel Statistics', category: 'Night Audit', priority: 95 },
  { contentPatterns: [/Manager'?s?\s*Flash/i], reportType: 'Manager Flash', category: 'Night Audit', priority: 90 },
  { contentPatterns: [/Statistical Recap|Daily Report.*Statistical/i], tableHeaderPatterns: [/Occupancy\s*%.*ADR/i], reportType: 'Daily Statistical Recap', category: 'Night Audit', priority: 90 },
  { contentPatterns: [/Final Audit/i], tableHeaderPatterns: [/Room Revenue|Charge Type/i], reportType: 'Final Audit', category: 'Night Audit', priority: 85 },
  { contentPatterns: [/Daily Closing Report/i], reportType: 'Daily Closing Report', category: 'Night Audit', priority: 85 },
  { contentPatterns: [/Final.*Close\s*Out|Final Transaction/i], reportType: 'Final Close Out', category: 'Night Audit', priority: 85 },
  { contentPatterns: [/Shift Reconciliation/i], reportType: 'Shift Reconciliation', category: 'Night Audit', priority: 80 },
  { contentPatterns: [/Grata DSR/i], reportType: 'Grata DSR', category: 'Night Audit', priority: 80 },

  // Room Operations
  { contentPatterns: [/All Rooms/i], tableHeaderPatterns: [/Room.*Number.*Type.*OCC.*STATUS/i], reportType: 'All Rooms Report', category: 'Room Operations', priority: 85 },
  { contentPatterns: [/Room Detail/i], reportType: 'Room Detail', category: 'Room Operations', priority: 80 },
  { contentPatterns: [/Room Status/i], reportType: 'Room Status Report', category: 'Room Operations', priority: 80 },
  { contentPatterns: [/Vacant Room/i], reportType: 'Vacant Room List', category: 'Room Operations', priority: 80 },
  { contentPatterns: [/Out.of.Order|OOO/i], reportType: 'OOO Rooms', category: 'Room Operations', priority: 85 },
  { contentPatterns: [/Rooms?\s*Transferred/i], reportType: 'Rooms Transferred', category: 'Room Operations', priority: 80 },
  { contentPatterns: [/In.House\s*(List|Guest)/i], reportType: 'In House List', category: 'Room Operations', priority: 80 },
  { contentPatterns: [/House Count/i], reportType: 'House Count Report', category: 'Room Operations', priority: 80 },
  { contentPatterns: [/Occupancy Forecast|History.*Forecast/i], reportType: 'Occupancy Forecast', category: 'Room Operations', priority: 85 },
  { contentPatterns: [/Downtime Report/i], reportType: 'Downtime Report', category: 'Room Operations', priority: 80 },

  // Maintenance
  { contentPatterns: [/Engineering Flash|Engineer Flash/i], reportType: 'Engineering Flash', category: 'Maintenance', priority: 80 },
  { contentPatterns: [/Non.?Rentable|Maintenance/i], reportType: 'Maintenance Report', category: 'Maintenance', priority: 75 },

  // Reservations
  { contentPatterns: [/Reservation.*(Activity|Entered|Report)|Reservations by Operator/i], reportType: 'Reservation Report', category: 'Reservations', priority: 80 },
  { contentPatterns: [/No Show/i], reportType: 'No Show Report', category: 'Reservations', priority: 80 },
  { contentPatterns: [/Denial Tracking/i], reportType: 'Denial Tracking', category: 'Reservations', priority: 80 },
  { contentPatterns: [/Special Services/i], reportType: 'Special Services', category: 'Reservations', priority: 75 },

  // Accounting
  { contentPatterns: [/Aging.*Report|Account\s*Aging|Receivables?\s*Aging|City Ledger.*Aging/i], tableHeaderPatterns: [/Current.*30.*60.*90/i], reportType: 'Aging Report', category: 'Accounting', priority: 90 },
  { contentPatterns: [/Aging.*Type/i], reportType: 'Aging By Type', category: 'Accounting', priority: 85 },
  { contentPatterns: [/Direct Bill Aging/i], reportType: 'Direct Bill Aging', category: 'Accounting', priority: 85 },
  { contentPatterns: [/Direct Bill Ledger/i], reportType: 'Direct Bill Ledger', category: 'Accounting', priority: 85 },
  { contentPatterns: [/Guest Ledger/i], reportType: 'Guest Ledger', category: 'Accounting', priority: 80 },
  { contentPatterns: [/Trial Balance/i], reportType: 'Trial Balance', category: 'Accounting', priority: 80 },
  { contentPatterns: [/Over Credit Limit/i], reportType: 'Over Credit Limit', category: 'Accounting', priority: 80 },
  { contentPatterns: [/Ledger Activity/i], reportType: 'Ledger Activity', category: 'Accounting', priority: 80 },
  { contentPatterns: [/House Account|house.account/i], reportType: 'House Accounts', category: 'Accounting', priority: 75 },
  { contentPatterns: [/Closed Folio/i], reportType: 'Closed Folio Balances', category: 'Accounting', priority: 80 },
  { contentPatterns: [/ROTB/i], reportType: 'ROTB Report', category: 'Accounting', priority: 75 },

  // Payments
  { contentPatterns: [/Credit Card.*(Transaction|Reconcil|Batch)/i], tableHeaderPatterns: [/CC\s*#|Auth\s*#|Batch/i], reportType: 'Credit Card Transactions', category: 'Payments', priority: 85 },
  { contentPatterns: [/Credit Card.*Rebate/i], reportType: 'Credit Card Rebate', category: 'Payments', priority: 80 },
  { contentPatterns: [/Credit Card.*Activity/i], reportType: 'Credit Card Activity', category: 'Payments', priority: 80 },
  { contentPatterns: [/Credit Rebate/i], reportType: 'Credit Rebate', category: 'Payments', priority: 75 },
  { contentPatterns: [/Payment Activity/i], reportType: 'Payment Activity', category: 'Payments', priority: 80 },
  { contentPatterns: [/Negative Posting/i], reportType: 'Negative Postings', category: 'Payments', priority: 80 },

  // Cash & Deposits
  { contentPatterns: [/Operator.*Transaction/i], reportType: 'Operator Transactions', category: 'Cash & Deposits', priority: 80 },
  { contentPatterns: [/Operator.*Cash.*Out|Cash Out/i], reportType: 'Cash Out', category: 'Cash & Deposits', priority: 80 },
  { contentPatterns: [/Daily Cash Out/i], reportType: 'Daily Cash Out', category: 'Cash & Deposits', priority: 80 },
  { contentPatterns: [/Cash Dep(o|e|s)?(o|e)?s?it.*Log/i], reportType: 'Cash Deposit Log', category: 'Cash & Deposits', priority: 80 },
  { contentPatterns: [/Cash Drop/i], reportType: 'Cash Drop Log', category: 'Cash & Deposits', priority: 80 },
  { contentPatterns: [/Deposit.*(List|Report|Master|Ledger)|Daily Deposit|Bank Deposit/i], reportType: 'Deposit Report', category: 'Cash & Deposits', priority: 75 },

  // Tax
  { contentPatterns: [/Room.*Tax.*List/i], reportType: 'Room & Tax Listing', category: 'Tax', priority: 85 },
  { contentPatterns: [/Tax.Exempt/i], reportType: 'Tax Exempt', category: 'Tax', priority: 80 },
  { contentPatterns: [/Sales Tax Liability/i], reportType: 'Sales Tax Liability', category: 'Tax', priority: 80 },
  { contentPatterns: [/Tax Report/i], reportType: 'Tax Report', category: 'Tax', priority: 75 },

  // Transaction Logs
  { contentPatterns: [/Daily Transaction Log|Transaction Log/i], reportType: 'Daily Transaction Log', category: 'Transaction Logs', priority: 80 },
  { contentPatterns: [/All Transactions/i], tableHeaderPatterns: [/Transaction.*Code|Charge.*Type/i], reportType: 'All Transactions', category: 'Transaction Logs', priority: 80 },
  { contentPatterns: [/All Charges/i], reportType: 'All Charges', category: 'Transaction Logs', priority: 80 },
  { contentPatterns: [/Daily Variance Exception/i], reportType: 'Daily Variance Exception', category: 'Transaction Logs', priority: 80 },
  { contentPatterns: [/Adjust|Void/i], reportType: 'Adjustments / Voids', category: 'Transaction Logs', priority: 60 },
];

const SORTED_RULES = [...CONTENT_RULES].sort((a, b) => b.priority - a.priority);

const PROPERTY_ALIASES: Array<{ code: string; name: string; patterns: RegExp[] }> = [
  { code: 'BWTP',   name: 'Best Western Plus Tupelo',   patterns: [/best\s*western\s*plus?\s*tupelo|audit\s*for\s*best\s*western|tupelo\s*inn|bwtp/i] },
  { code: 'BWPOB',  name: 'BW Plus Desoto',             patterns: [/best\s*western\s*plus?\s*(desoto|olive\s*branch)|bw.*desoto|bwpob/i] },
  { code: 'DTBLX',  name: 'DoubleTree Biloxi',          patterns: [/bixdt|doubletree|double\s*tree|dtblx/i] },
  { code: 'HGIMD',  name: 'HGI Madison',                patterns: [/janmh|hgi\s*madison|hilton\s*garden.*madison|hgimd/i] },
  { code: 'HAMPVK', name: 'Hampton Inn Vicksburg',      patterns: [/vksbg|vicksburg|hampvk/i] },
  { code: 'HIETP',  name: 'HIE Tupelo',                 patterns: [/his\s*tupel|hiex?\s*tupelo|hi\s*express\s*tupelo|hietp/i] },
  { code: 'HIEMSW', name: 'HIE Memphis Southwind',      patterns: [/meims|hiex?\s*south\s*w?ind|memphis\s*south|hiemsw/i] },
  { code: 'HYPBX',  name: 'Hyatt Place Biloxi',         patterns: [/hyatt|hayatt|hypbx/i] },
  { code: 'HITP',   name: 'Holiday Inn Tupelo',         patterns: [/meihi|holiday\s*inn\s*tupelo|hitp/i] },
  { code: 'HIEFT',  name: 'HIE Fulton',                 patterns: [/fulton|hieft/i] },
  { code: 'HGIOB',  name: 'HGI Olive Branch',           patterns: [/olbgi|olive\s*branch|hgiob/i] },
  { code: 'CITP',   name: 'Comfort Inn Tupelo',         patterns: [/comfort\s*inn?|citp/i] },
  { code: 'FPMSW',  name: 'Four Points Memphis',        patterns: [/four\s*points|sheraton\s*memphis|fpmsw/i] },
  { code: 'CWSTP',  name: 'Candlewood Suites Tupelo',   patterns: [/candlewood|cwstp/i] },
  { code: 'SSTP',   name: 'SureStay Tupelo',            patterns: [/surestay|sure\s*stay|sstp/i] },
  { code: 'TUPGD',  name: 'Home2 Suites Tupelo',        patterns: [/tupgd|home2\s*suites/i] },
  { code: 'TRUTP',  name: 'Tru By Hilton Tupelo',       patterns: [/tupgs|tru\s*(by\s*)?hilton|trutp/i] },
  { code: 'HGIMR',  name: 'HGI Meridian',               patterns: [/hgi\s*meridian|hilton\s*garden.*meridian|hgimr/i] },
  { code: 'HAMPMR', name: 'Hampton Inn Meridian',       patterns: [/hampton.*meridian|hampmr/i] },
  { code: 'HIMRD',  name: 'Holiday Inn Meridian',       patterns: [/holiday\s*inn\s*meridian|himrd/i] },
];

export interface ClassifyResult {
  reportType: string;
  category: string;
  property: string | null;
  dateFolder: string | null;
}

/**
 * Match a property name from any text source. Returns the friendly name
 * (e.g. "HGI Madison") or null if nothing matched.
 */
function matchProperty(text: string): string | null {
  for (const prop of PROPERTY_ALIASES) {
    for (const pattern of prop.patterns) {
      if (pattern.test(text)) return prop.name;
    }
  }
  return null;
}

/**
 * Extract a YYYY-MM-DD date from a filename or text. Tries common formats:
 *   3-24, 03.24.2026, 03-24-26, 03_24_2026, "Mar 24, 2026"
 */
function extractDate(text: string): string | null {
  // Numeric patterns (MM.DD.YY or MM.DD.YYYY etc.)
  const numericPatterns = [
    /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/,
    /(\d{1,2})-(\d{1,2})-(\d{2,4})/,
    /(\d{1,2})_(\d{1,2})_(\d{2,4})/,
    /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/,
  ];
  for (const pattern of numericPatterns) {
    const match = text.match(pattern);
    if (match) {
      const m = parseInt(match[1]!, 10);
      const d = parseInt(match[2]!, 10);
      const yyyy = match[3]!.length === 2 ? `20${match[3]}` : match[3]!;
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && yyyy.length === 4) {
        return `${yyyy}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
  }

  // Month-name pattern: "Mar 24, 2026" / "March 24 2026"
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const monthMatch = text.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s*(\d{4})/i);
  if (monthMatch) {
    const m = monthNames.indexOf(monthMatch[1]!.toLowerCase()) + 1;
    const d = parseInt(monthMatch[2]!, 10);
    const yyyy = monthMatch[3]!;
    if (m >= 1 && d >= 1 && d <= 31) {
      return `${yyyy}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // Just MM-YY or MM/YY at end of name (e.g. "Manager Flash 3-24") → assume current decade.
  const shortMatch = text.match(/(?:^|[^\d])(\d{1,2})[-./_](\d{2})(?!\d)/);
  if (shortMatch) {
    const m = parseInt(shortMatch[1]!, 10);
    const yy = parseInt(shortMatch[2]!, 10);
    if (m >= 1 && m <= 12 && yy >= 0 && yy <= 99) {
      return `20${String(yy).padStart(2, '0')}-${String(m).padStart(2, '0')}-01`;
    }
  }

  return null;
}

/**
 * Match a CONTENT_RULE against the given text. Returns the highest-priority
 * matching rule, or null if nothing matched.
 */
function matchRule(text: string): { reportType: string; category: string; tableMatched: boolean } | null {
  for (const rule of SORTED_RULES) {
    const contentMatch = rule.contentPatterns.some((p) => p.test(text));
    if (!contentMatch) continue;
    const tableMatched = rule.tableHeaderPatterns
      ? rule.tableHeaderPatterns.some((p) => p.test(text))
      : false;
    return { reportType: rule.reportType, category: rule.category, tableMatched };
  }
  return null;
}

/**
 * Classify using filename only — used at upload time before OCR runs.
 * Uses lower-priority pass: a filename match alone is "weak" evidence.
 */
export function classifyFromFilename(filename: string): ClassifyResult {
  const matched = matchRule(filename);
  return {
    reportType: matched?.reportType ?? 'Unknown',
    category: matched?.category ?? 'Uncategorized',
    property: matchProperty(filename),
    dateFolder: extractDate(filename),
  };
}

/**
 * Classify using extracted document text (preferred — much more accurate).
 * Falls back to filename for property/date if not found in the body.
 */
export function classifyFromContent(filename: string, fullText: string): ClassifyResult {
  // Truncate — rules only need the first few KB to match a header.
  const head = fullText.slice(0, 8000);

  const contentMatch = matchRule(head);
  const filenameMatch = !contentMatch ? matchRule(filename) : null;

  return {
    reportType: contentMatch?.reportType ?? filenameMatch?.reportType ?? 'Unknown',
    category: contentMatch?.category ?? filenameMatch?.category ?? 'Uncategorized',
    // Property/date are far more reliable from the document body.
    property: matchProperty(head) ?? matchProperty(filename),
    dateFolder: extractDate(head) ?? extractDate(filename),
  };
}
