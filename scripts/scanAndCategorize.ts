/**
 * Hotel report scanner — scans the OneDrive folder structure, parses PDFs,
 * extracts ADR numbers, and categorizes files by date/property/report type.
 *
 * Expected folder structure:
 *   <root>/Revenue Flash/<MMDDYYYY>/<property-subfolder>/<report-files>
 *
 * Usage:
 *   pnpm tsx scripts/scanAndCategorize.ts <folder-path> [--out <output-path>]
 *
 * Output: apps/web/public/data/output.json (default)
 */

import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';

const PADDLE_OCR_CACHE = path.join(process.cwd(), 'data', 'ocr-cache.json');

/** Load PaddleOCR cache if available (populated by scripts/paddle_ocr_batch.py) */
let ocrCache: Record<string, string> | null = null;
function getOcrCache(): Record<string, string> {
  if (ocrCache === null) {
    try {
      ocrCache = JSON.parse(fs.readFileSync(PADDLE_OCR_CACHE, 'utf-8'));
      console.log(`  Loaded OCR cache: ${Object.keys(ocrCache!).length} entries`);
    } catch {
      ocrCache = {};
    }
  }
  return ocrCache!;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScannedFile {
  filePath: string;
  relativePath: string;
  fileName: string;
  /** File name with date prefix and extension stripped, e.g. "Hotel Statistics" */
  displayName: string;
  extension: string;
  fileSizeBytes: number;
  reportType: string | null;
  reportTypeCategory: string;
  adrNumber: string | null;
  confidence: number;
  error: string | null;
}

export interface PropertyFolder {
  folderName: string;
  folderPath: string;
  propertyCode: string | null;
  propertyName: string | null;
  propertyConfidence: number;
  reportDate: string;
  files: ScannedFile[];
  fileCount: number;
  reportTypeCounts: Record<string, number>;
}

export interface DateFolder {
  rawName: string;
  normalizedDate: string;
  propertyFolders: PropertyFolder[];
  standaloneFiles: ScannedFile[];
  totalFiles: number;
  totalProperties: number;
}

export interface ScanSummary {
  scanRoot: string;
  scannedAt: string;
  executionTimeMs: number;
  totalFiles: number;
  totalPdfs: number;
  totalParsed: number;
  totalErrors: number;
  totalWithAdr: number;
  dateFolders: DateFolder[];
  categoryCounts: Record<string, number>;
  reportTypeCounts: Record<string, number>;
  propertyCounts: Record<string, number>;
  allDates: string[];
  allProperties: string[];
  /** Flat list of every file for table view */
  results: Array<ScannedFile & { dateFolder: string; propertyFolder: string; property: string | null }>;
}

// ─── Report type classification ──────────────────────────────────────────────

const REPORT_CLASSIFIERS: Array<{ patterns: RegExp[]; reportType: string; category: string }> = [
  // ── Revenue & Performance ────────────────────────────────────────────────
  { patterns: [/revenue\s*flash|rev\s*flash|flash\s*drive/i], reportType: 'Revenue Flash', category: 'Revenue' },
  { patterns: [/revenue\s*summary/i], reportType: 'Revenue Summary', category: 'Revenue' },
  { patterns: [/revenue\s*report/i], reportType: 'Revenue Report', category: 'Revenue' },
  { patterns: [/daily\s*revenue\s*report/i], reportType: 'Daily Revenue Report', category: 'Revenue' },
  { patterns: [/rate\s*report|rate\s*variance/i], reportType: 'Rate Report', category: 'Revenue' },
  { patterns: [/financial\s*(payment|revenue)|financial\s*&?\s*revenue/i], reportType: 'Financial Revenue', category: 'Revenue' },
  { patterns: [/market[\s-]*segment\s*summary/i], reportType: 'Market Segment Summary', category: 'Revenue' },
  { patterns: [/daily\s*segmentation/i], reportType: 'Daily Segmentation', category: 'Revenue' },
  { patterns: [/booking\s*statistics/i], reportType: 'Booking Statistics', category: 'Revenue' },
  { patterns: [/marsha\s*production/i], reportType: 'Marsha Production', category: 'Revenue' },

  // ── Operations / Night Audit ─────────────────────────────────────────────
  { patterns: [/hotel\s*statistics/i], reportType: 'Hotel Statistics', category: 'Night Audit' },
  { patterns: [/manager'?s?\s*flash|mgr\s*flash/i], reportType: 'Manager Flash', category: 'Night Audit' },
  { patterns: [/daily\s*report\s*statistical|statistical\s*recap|daily\s*stat/i], reportType: 'Daily Statistical Recap', category: 'Night Audit' },
  { patterns: [/grata\s*dsr/i], reportType: 'Grata DSR', category: 'Night Audit' },
  { patterns: [/daily\s*closing\s*report/i], reportType: 'Daily Closing Report', category: 'Night Audit' },
  { patterns: [/final\s*(transaction\s*)?close\s*out/i], reportType: 'Final Close Out', category: 'Night Audit' },
  { patterns: [/final\s*audit/i], reportType: 'Final Audit', category: 'Night Audit' },
  { patterns: [/shift\s*reconciliation/i], reportType: 'Shift Reconciliation', category: 'Night Audit' },
  { patterns: [/flash\s*report|flash$/i], reportType: 'Flash Report', category: 'Night Audit' },

  // ── Room Operations ──────────────────────────────────────────────────────
  { patterns: [/all\s*rooms/i], reportType: 'All Rooms Report', category: 'Room Operations' },
  { patterns: [/room\s*detail/i], reportType: 'Room Detail', category: 'Room Operations' },
  { patterns: [/room\s*status/i], reportType: 'Room Status Report', category: 'Room Operations' },
  { patterns: [/daily\s*room\s*status/i], reportType: 'Daily Room Status', category: 'Room Operations' },
  { patterns: [/vacant\s*room/i], reportType: 'Vacant Room List', category: 'Room Operations' },
  { patterns: [/ooo\s*room|out\s*of\s*order/i], reportType: 'OOO Rooms', category: 'Room Operations' },
  { patterns: [/rooms?\s*transferred/i], reportType: 'Rooms Transferred', category: 'Room Operations' },
  { patterns: [/in\s*house\s*(list|guest)/i], reportType: 'In House List', category: 'Room Operations' },
  { patterns: [/house\s*count/i], reportType: 'House Count Report', category: 'Room Operations' },
  { patterns: [/occupancy\s*forecast|history\s*(&|and)\s*forecast/i], reportType: 'Occupancy Forecast', category: 'Room Operations' },
  { patterns: [/downtime\s*report/i], reportType: 'Downtime Report', category: 'Room Operations' },

  // ── Maintenance & Engineering ────────────────────────────────────────────
  { patterns: [/engineer(ing)?\s*flash|eneginerring\s*flash/i], reportType: 'Engineering Flash', category: 'Maintenance' },
  { patterns: [/maintenance|non[\s-]*rentable/i], reportType: 'Maintenance Report', category: 'Maintenance' },

  // ── Reservations & Guest ─────────────────────────────────────────────────
  { patterns: [/reservation\s*(activity|entered|report)/i], reportType: 'Reservation Report', category: 'Reservations' },
  { patterns: [/no\s*show/i], reportType: 'No Show Report', category: 'Reservations' },
  { patterns: [/denial\s*tracking/i], reportType: 'Denial Tracking', category: 'Reservations' },
  { patterns: [/special\s*services/i], reportType: 'Special Services', category: 'Reservations' },

  // ── Accounting / AR ──────────────────────────────────────────────────────
  { patterns: [/aging\s*(by\s*type)?\s*(only\s*)?report|a[\s_]*r[\s_]*aging|ar[\s-]*aging|aging\s*summary|detailed\s*receivables?\s*aging/i], reportType: 'Aging Report', category: 'Accounting' },
  { patterns: [/aging\s*by\s*type/i], reportType: 'Aging By Type', category: 'Accounting' },
  { patterns: [/direct\s*bill\s*aging/i], reportType: 'Direct Bill Aging', category: 'Accounting' },
  { patterns: [/direct\s*bill\s*ledger/i], reportType: 'Direct Bill Ledger', category: 'Accounting' },
  { patterns: [/guest\s*ledger/i], reportType: 'Guest Ledger', category: 'Accounting' },
  { patterns: [/trial\s*balance/i], reportType: 'Trial Balance', category: 'Accounting' },
  { patterns: [/over\s*credit\s*limit/i], reportType: 'Over Credit Limit', category: 'Accounting' },
  { patterns: [/ledger\s*activity/i], reportType: 'Ledger Activity', category: 'Accounting' },
  { patterns: [/house\s*account/i], reportType: 'House Accounts', category: 'Accounting' },
  { patterns: [/ROTB|rotb/], reportType: 'ROTB Report', category: 'Accounting' },

  // ── Credit Card & Payments ───────────────────────────────────────────────
  { patterns: [/credit\s*card\s*(transaction|reconcil|batch)/i], reportType: 'Credit Card Transactions', category: 'Payments' },
  { patterns: [/credit[\s_]*card[\s_]*rebate/i], reportType: 'Credit Card Rebate', category: 'Payments' },
  { patterns: [/credit\s*card\s*activity/i], reportType: 'Credit Card Activity', category: 'Payments' },
  { patterns: [/credit\s*rebate/i], reportType: 'Credit Rebate', category: 'Payments' },
  { patterns: [/payment\s*activity/i], reportType: 'Payment Activity', category: 'Payments' },
  { patterns: [/negative\s*posting/i], reportType: 'Negative Postings', category: 'Payments' },

  // ── Cash & Deposits ──────────────────────────────────────────────────────
  { patterns: [/operator[\s_]*transaction/i], reportType: 'Operator Transactions', category: 'Cash & Deposits' },
  { patterns: [/operator\s*cash\s*out/i], reportType: 'Cash Out', category: 'Cash & Deposits' },
  { patterns: [/daily\s*cash\s*out/i], reportType: 'Daily Cash Out', category: 'Cash & Deposits' },
  { patterns: [/cash\s*dep[oesi]*t\s*log/i], reportType: 'Cash Deposit Log', category: 'Cash & Deposits' },
  { patterns: [/cash\s*drop\s*log/i], reportType: 'Cash Drop Log', category: 'Cash & Deposits' },
  { patterns: [/deposit\s*(master\s*)?list|deposit\s*report|daily\s*deposit|deposit\s*ledger|deposit\s*slip/i], reportType: 'Deposit Report', category: 'Cash & Deposits' },
  { patterns: [/bank\s*deposit/i], reportType: 'Bank Deposit', category: 'Cash & Deposits' },

  // ── Tax ──────────────────────────────────────────────────────────────────
  { patterns: [/room\s*[&and]*\s*tax\s*list/i], reportType: 'Room & Tax Listing', category: 'Tax' },
  { patterns: [/tax[\s-]*exempt/i], reportType: 'Tax Exempt', category: 'Tax' },
  { patterns: [/tax\s*report/i], reportType: 'Tax Report', category: 'Tax' },
  { patterns: [/sales\s*tax\s*liability/i], reportType: 'Sales Tax Liability', category: 'Tax' },

  // ── Transaction Logs ─────────────────────────────────────────────────────
  { patterns: [/daily\s*transaction\s*log|transaction\s*log|journal\s*by\s*cashier/i], reportType: 'Daily Transaction Log', category: 'Transaction Logs' },
  { patterns: [/all\s*trans(actions)?(?!\s*code)/i], reportType: 'All Transactions', category: 'Transaction Logs' },
  { patterns: [/all\s*charges/i], reportType: 'All Charges', category: 'Transaction Logs' },
  { patterns: [/daily\s*variance\s*exception/i], reportType: 'Daily Variance Exception', category: 'Transaction Logs' },
  { patterns: [/adjust|void/i], reportType: 'Adjustments / Voids', category: 'Transaction Logs' },

  // ── Abbreviations (MEIME property uses short codes) ────────────────────
  { patterns: [/^ALL\s*RMS\b/i], reportType: 'All Rooms Report', category: 'Room Operations' },
  { patterns: [/^RM\s*DET(AIL)?\b/i], reportType: 'Room Detail', category: 'Room Operations' },
  { patterns: [/^HOTEL\s*STATS\b/i], reportType: 'Hotel Statistics', category: 'Night Audit' },
  { patterns: [/^DBA\b/], reportType: 'Direct Bill Aging', category: 'Accounting' },
  { patterns: [/^DBL\b/], reportType: 'Direct Bill Ledger', category: 'Accounting' },
  { patterns: [/^MAINT\s*ACT\b/i], reportType: 'Maintenance Report', category: 'Maintenance' },
  { patterns: [/^OCC\s*FORECAST\b/i], reportType: 'Occupancy Forecast', category: 'Room Operations' },
  { patterns: [/^PAYMENT\s*ACT\b/i], reportType: 'Payment Activity', category: 'Payments' },

  // ── Remaining uncategorized patterns ───────────────────────────────────
  { patterns: [/closed[\s-]*folio/i], reportType: 'Closed Folio Balances', category: 'Accounting' },
  { patterns: [/revenue[\s-]*activity/i], reportType: 'Revenue Activity', category: 'Revenue' },
  { patterns: [/combined\s*sales/i], reportType: 'Combined Sales', category: 'Revenue' },
  { patterns: [/PTDYTDMNGMNT|ptd\s*ytd\s*management/i], reportType: 'PTD/YTD Management', category: 'Revenue' },
  { patterns: [/reservations?\s*by\s*operator/i], reportType: 'Reservations by Operator', category: 'Reservations' },
  { patterns: [/ooo\s*by\s*reason/i], reportType: 'OOO By Reason', category: 'Room Operations' },
  { patterns: [/^deposits?(\.pdf)?$/i], reportType: 'Deposit Report', category: 'Cash & Deposits' },
  { patterns: [/^\d{2}\.\d{2}\.\d{2}\s*flash\.(xlsx?|csv)$/i], reportType: 'Flash Report', category: 'Night Audit' },
  { patterns: [/revenue\s*all\b/i], reportType: 'Revenue All', category: 'Revenue' },
];

// ─── Property matching ───────────────────────────────────────────────────────

const PROPERTY_ALIASES: Array<{ code: string; name: string; patterns: RegExp[] }> = [
  { code: 'BWTP', name: 'Best Western Plus Tupelo', patterns: [/best\s*western\s*plus?\s*tupelo|audit\s*for\s*best\s*western/i] },
  { code: 'BWPOB', name: 'BW Plus Desoto', patterns: [/best\s*western\s*plus?\s*desoto|bw.*desoto/i] },
  { code: 'DTBLX', name: 'DoubleTree Biloxi', patterns: [/bixdt|doubletree|double\s*tree/i] },
  { code: 'HGIMD', name: 'HGI Madison', patterns: [/janmh|hgi\s*madison|hilton\s*garden.*madison|corporate.*janmh/i] },
  { code: 'HAMPVK', name: 'Hampton Inn Vicksburg', patterns: [/vksbg|vicksburg|corporate.*vksbg|corporate.*vkbgs/i] },
  { code: 'HIETP', name: 'HIE Tupelo', patterns: [/his\s*tupel|hiex?\s*tupelo|hi\s*express\s*tupelo/i] },
  { code: 'MEMTO', name: 'MEMTO Property', patterns: [/memto/i] },
  { code: 'HIEMSW', name: 'HIE Memphis Southwind', patterns: [/meims|hiex?\s*south\s*w?ind|memphis\s*south/i] },
  { code: 'MEIME', name: 'MEIME Property', patterns: [/meime/i] },
  { code: 'HYPBX', name: 'Hyatt Place Biloxi', patterns: [/hyatt|hayatt/i] },
  { code: 'HITP', name: 'Holiday Inn Tupelo', patterns: [/meihi|holiday\s*inn\s*tupelo/i] },
  { code: 'HIEFT', name: 'HIE Fulton', patterns: [/fulton/i] },
  { code: 'HGIOB', name: 'HGI Olive Branch', patterns: [/olbgi|olive\s*branch/i] },
  { code: 'CITP', name: 'Comfort Inn Tupelo', patterns: [/comfort\s*inn?/i] },
  { code: 'FPMSW', name: 'Four Points Memphis', patterns: [/four\s*points|sheraton\s*memphis/i] },
  { code: 'CWSTP', name: 'Candlewood Suites Tupelo', patterns: [/candlewood/i] },
  { code: 'SSTP', name: 'SureStay Tupelo', patterns: [/surestay|sure\s*stay/i] },
  { code: 'TUPGD', name: 'TUPGD Property', patterns: [/tupgd/i] },
  { code: 'TRUTP', name: 'Tru By Hilton Tupelo', patterns: [/tupgs|tru\s*(by\s*)?hilton/i] },
  { code: 'MEMNP', name: 'MEMNP Property', patterns: [/memnp/i] },
  { code: 'HGIMR', name: 'HGI Meridian', patterns: [/hgi\s*meridian|hilton\s*garden.*meridian/i] },
  { code: 'HAMPMR', name: 'Hampton Inn Meridian', patterns: [/hampton.*meridian/i] },
  { code: 'HIMRD', name: 'Holiday Inn Meridian', patterns: [/holiday\s*inn\s*meridian/i] },
];

// ─── Core functions ──────────────────────────────────────────────────────────

/** Parse MMDDYYYY folder name to YYYY-MM-DD. */
function parseDateFolder(name: string): string | null {
  const match = name.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (!match) return null;
  const [, mm, dd, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

/** Match a property subfolder name to a known property. */
function matchProperty(folderName: string): { code: string; name: string; confidence: number } | null {
  for (const prop of PROPERTY_ALIASES) {
    for (const pattern of prop.patterns) {
      if (pattern.test(folderName)) {
        return { code: prop.code, name: prop.name, confidence: 0.9 };
      }
    }
  }
  return null;
}

/** Classify a file by its name (and optionally text content). */
function classifyFile(fileName: string, textContent: string): { reportType: string | null; category: string; confidence: number } {
  // Try filename-based match first (highest confidence)
  for (const entry of REPORT_CLASSIFIERS) {
    for (const pattern of entry.patterns) {
      if (pattern.test(fileName)) {
        return { reportType: entry.reportType, category: entry.category, confidence: 0.95 };
      }
    }
  }

  // Try content-based deep scan — look for report title headers in the PDF text
  if (textContent) {
    const header = textContent.substring(0, 3000);

    // Content-specific header patterns (what the report title says inside the PDF)
    const CONTENT_HEADERS: Array<{ pattern: RegExp; reportType: string; category: string }> = [
      { pattern: /Hotel Statistics/i, reportType: 'Hotel Statistics', category: 'Night Audit' },
      { pattern: /Manager'?s?\s*Flash/i, reportType: 'Manager Flash', category: 'Night Audit' },
      { pattern: /Final Audit/i, reportType: 'Final Audit', category: 'Night Audit' },
      { pattern: /Daily Closing Report/i, reportType: 'Daily Closing Report', category: 'Night Audit' },
      { pattern: /Shift Reconciliation/i, reportType: 'Shift Reconciliation', category: 'Night Audit' },
      { pattern: /Closed Folio Balance/i, reportType: 'Closed Folio Balances', category: 'Accounting' },
      { pattern: /Market Segment/i, reportType: 'Market Segment Summary', category: 'Revenue' },
      { pattern: /Revenue Activity/i, reportType: 'Revenue Activity', category: 'Revenue' },
      { pattern: /PTD\/YTD Management/i, reportType: 'PTD/YTD Management', category: 'Revenue' },
      { pattern: /Combined Sales/i, reportType: 'Combined Sales', category: 'Revenue' },
      { pattern: /Revenue Summary/i, reportType: 'Revenue Summary', category: 'Revenue' },
      { pattern: /All Rooms/i, reportType: 'All Rooms Report', category: 'Room Operations' },
      { pattern: /Room Detail/i, reportType: 'Room Detail', category: 'Room Operations' },
      { pattern: /Occupancy Forecast/i, reportType: 'Occupancy Forecast', category: 'Room Operations' },
      { pattern: /Out.of.Order/i, reportType: 'OOO Rooms', category: 'Room Operations' },
      { pattern: /In House/i, reportType: 'In House List', category: 'Room Operations' },
      { pattern: /Room Status/i, reportType: 'Room Status Report', category: 'Room Operations' },
      { pattern: /Vacant Room/i, reportType: 'Vacant Room List', category: 'Room Operations' },
      { pattern: /All Transactions/i, reportType: 'All Transactions', category: 'Transaction Logs' },
      { pattern: /All Charges/i, reportType: 'All Charges', category: 'Transaction Logs' },
      { pattern: /Daily Transaction Log/i, reportType: 'Daily Transaction Log', category: 'Transaction Logs' },
      { pattern: /Direct Bill Aging/i, reportType: 'Direct Bill Aging', category: 'Accounting' },
      { pattern: /Direct Bill Ledger/i, reportType: 'Direct Bill Ledger', category: 'Accounting' },
      { pattern: /Guest Ledger/i, reportType: 'Guest Ledger', category: 'Accounting' },
      { pattern: /Trial Balance/i, reportType: 'Trial Balance', category: 'Accounting' },
      { pattern: /Credit Card Transaction/i, reportType: 'Credit Card Transactions', category: 'Payments' },
      { pattern: /Payment Activity/i, reportType: 'Payment Activity', category: 'Payments' },
      { pattern: /Operator Transaction/i, reportType: 'Operator Transactions', category: 'Cash & Deposits' },
      { pattern: /Cash Deposit/i, reportType: 'Cash Deposit Log', category: 'Cash & Deposits' },
      { pattern: /Room & Tax|Room and Tax/i, reportType: 'Room & Tax Listing', category: 'Tax' },
      { pattern: /Tax Exempt/i, reportType: 'Tax Exempt', category: 'Tax' },
      { pattern: /Non.?Rentable/i, reportType: 'Maintenance Report', category: 'Maintenance' },
      { pattern: /Reservation/i, reportType: 'Reservation Report', category: 'Reservations' },
      { pattern: /No Show/i, reportType: 'No Show Report', category: 'Reservations' },
      { pattern: /Denial Tracking/i, reportType: 'Denial Tracking', category: 'Reservations' },
      { pattern: /Occ\s*%.*ADR.*RevPAR/i, reportType: 'Revenue Flash', category: 'Revenue' },
      { pattern: /Occupancy\s*%.*ADR/i, reportType: 'Daily Statistical Recap', category: 'Night Audit' },
      { pattern: /Aging|Receivable/i, reportType: 'Aging Report', category: 'Accounting' },
    ];

    for (const entry of CONTENT_HEADERS) {
      if (entry.pattern.test(header)) {
        return { reportType: entry.reportType, category: entry.category, confidence: 0.75 };
      }
    }

    // Fallback: try the filename-based classifiers on content
    for (const entry of REPORT_CLASSIFIERS) {
      for (const pattern of entry.patterns) {
        if (pattern.test(header)) {
          return { reportType: entry.reportType, category: entry.category, confidence: 0.65 };
        }
      }
    }
  }

  return { reportType: null, category: 'Uncategorized', confidence: 0.2 };
}

/** Extract ADR number from PDF text. */
function extractADR(text: string): string | null {
  const patterns = [
    /ADR\s*[:\-]?\s*\$?\s*([\d,]+\.?\d*)/i,
    /Average\s*Daily\s*Rate\s*[:\-]?\s*\$?\s*([\d,]+\.?\d*)/i,
    /Avg\.?\s*Rate\s*[:\-]?\s*\$?\s*([\d,]+\.?\d*)/i,
    /Net\s*Avg\s*Rate\s*[:\-]?\s*\$?\s*([\d,]+\.?\d*)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const num = parseFloat(match[1].replace(/,/g, ''));
      if (num >= 30 && num <= 1000) {
        return num.toFixed(2);
      }
    }
  }
  return null;
}

/** Extract a date from a file or folder name. */
function extractDateFromName(name: string): string | null {
  const patterns = [
    /(\d{2})\.(\d{2})\.(\d{2,4})/,
    /(\d{2})-(\d{2})-(\d{2,4})/,
    /(\d{2})_(\d{2})_(\d{2,4})/,
  ];
  for (const pattern of patterns) {
    const match = name.match(pattern);
    if (match) {
      const [, mm, dd, rawYy] = match;
      const yyyy = rawYy!.length === 2 ? `20${rawYy}` : rawYy;
      const m = parseInt(mm!, 10);
      const d = parseInt(dd!, 10);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        return `${yyyy}-${mm!.padStart(2, '0')}-${dd!.padStart(2, '0')}`;
      }
    }
  }
  return null;
}

// ─── Main scan logic ─────────────────────────────────────────────────────────

async function scanFolder(rootPath: string): Promise<ScanSummary> {
  const startTime = Date.now();
  const dateFolders: DateFolder[] = [];
  const flatResults: ScanSummary['results'] = [];
  let totalFiles = 0;
  let totalPdfs = 0;
  let totalParsed = 0;
  let totalErrors = 0;
  let totalWithAdr = 0;
  const categoryCounts: Record<string, number> = {};
  const reportTypeCounts: Record<string, number> = {};
  const propertyCounts: Record<string, number> = {};

  // Find the "Revenue Flash" folder or use root directly
  let scanBase = rootPath;
  const rfPath = path.join(rootPath, 'Revenue Flash');
  if (fs.existsSync(rfPath) && fs.statSync(rfPath).isDirectory()) {
    scanBase = rfPath;
  }

  // Get date folders (MMDDYYYY pattern)
  const topEntries = fs.readdirSync(scanBase, { withFileTypes: true });
  const dateDirs = topEntries.filter((e) => e.isDirectory() && /^\d{8}$/.test(e.name));
  const topFiles = topEntries.filter((e) => e.isFile());

  console.log(`  Found ${dateDirs.length} date folders and ${topFiles.length} top-level files\n`);

  for (const dateDir of dateDirs.sort((a, b) => a.name.localeCompare(b.name))) {
    const normalizedDate = parseDateFolder(dateDir.name);
    if (!normalizedDate) continue;

    console.log(`  Processing ${dateDir.name} (${normalizedDate})...`);

    const dateFolderPath = path.join(scanBase, dateDir.name);
    const dateEntries = fs.readdirSync(dateFolderPath, { withFileTypes: true });

    const propertyFolders: PropertyFolder[] = [];
    const standaloneFiles: ScannedFile[] = [];

    // Process standalone files at date level
    for (const entry of dateEntries.filter((e) => e.isFile())) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!['.pdf', '.xlsx', '.xls', '.csv', '.ods'].includes(ext)) continue;

      const filePath = path.join(dateFolderPath, entry.name);
      const stat = fs.statSync(filePath);
      const scannedFile = await processFile(filePath, rootPath, entry.name, ext, stat.size);

      standaloneFiles.push(scannedFile);
      totalFiles++;
      if (ext === '.pdf') totalPdfs++;
      if (scannedFile.error) totalErrors++;
      else if (ext === '.pdf') totalParsed++;
      if (scannedFile.adrNumber) totalWithAdr++;

      categoryCounts[scannedFile.reportTypeCategory] = (categoryCounts[scannedFile.reportTypeCategory] ?? 0) + 1;
      if (scannedFile.reportType) {
        reportTypeCounts[scannedFile.reportType] = (reportTypeCounts[scannedFile.reportType] ?? 0) + 1;
      }

      flatResults.push({
        ...scannedFile,
        dateFolder: normalizedDate,
        propertyFolder: '(standalone)',
        property: null,
      });
    }

    // Process property subfolders
    for (const propDir of dateEntries.filter((e) => e.isDirectory())) {
      const propFolderPath = path.join(dateFolderPath, propDir.name);
      const propMatch = matchProperty(propDir.name);
      const propLabel = propMatch ? `${propMatch.code} - ${propMatch.name}` : null;

      if (propLabel) {
        propertyCounts[propLabel] = (propertyCounts[propLabel] ?? 0) + 1;
      }

      const files: ScannedFile[] = [];
      const reportTypesInFolder: Record<string, number> = {};

      let propFileEntries: fs.Dirent[];
      try {
        propFileEntries = fs.readdirSync(propFolderPath, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const fileEntry of propFileEntries.filter((e) => e.isFile())) {
        const ext = path.extname(fileEntry.name).toLowerCase();
        if (!['.pdf', '.xlsx', '.xls', '.csv', '.ods'].includes(ext)) continue;

        const filePath = path.join(propFolderPath, fileEntry.name);
        const stat = fs.statSync(filePath);
        const scannedFile = await processFile(filePath, rootPath, fileEntry.name, ext, stat.size);

        files.push(scannedFile);
        totalFiles++;
        if (ext === '.pdf') totalPdfs++;
        if (scannedFile.error) totalErrors++;
        else if (ext === '.pdf') totalParsed++;
        if (scannedFile.adrNumber) totalWithAdr++;

        categoryCounts[scannedFile.reportTypeCategory] = (categoryCounts[scannedFile.reportTypeCategory] ?? 0) + 1;
        if (scannedFile.reportType) {
          reportTypeCounts[scannedFile.reportType] = (reportTypeCounts[scannedFile.reportType] ?? 0) + 1;
          reportTypesInFolder[scannedFile.reportType] = (reportTypesInFolder[scannedFile.reportType] ?? 0) + 1;
        }

        flatResults.push({
          ...scannedFile,
          dateFolder: normalizedDate,
          propertyFolder: propDir.name,
          property: propLabel,
        });
      }

      propertyFolders.push({
        folderName: propDir.name,
        folderPath: propFolderPath,
        propertyCode: propMatch?.code ?? null,
        propertyName: propMatch?.name ?? null,
        propertyConfidence: propMatch?.confidence ?? 0,
        reportDate: extractDateFromName(propDir.name) ?? normalizedDate,
        files,
        fileCount: files.length,
        reportTypeCounts: reportTypesInFolder,
      });
    }

    const dateFolder: DateFolder = {
      rawName: dateDir.name,
      normalizedDate,
      propertyFolders,
      standaloneFiles,
      totalFiles: standaloneFiles.length + propertyFolders.reduce((s, p) => s + p.fileCount, 0),
      totalProperties: propertyFolders.length,
    };

    dateFolders.push(dateFolder);
    console.log(`    → ${dateFolder.totalProperties} properties, ${dateFolder.totalFiles} files`);
  }

  return {
    scanRoot: rootPath.replace(/\\/g, '/'),
    scannedAt: new Date().toISOString(),
    executionTimeMs: Date.now() - startTime,
    totalFiles,
    totalPdfs,
    totalParsed,
    totalErrors,
    totalWithAdr,
    dateFolders,
    categoryCounts,
    reportTypeCounts,
    propertyCounts,
    allDates: dateFolders.map((d) => d.normalizedDate),
    allProperties: [...new Set(flatResults.map((r) => r.property).filter(Boolean))] as string[],
    results: flatResults,
  };
}

/** Process a single file: parse if PDF, classify, extract ADR. */
async function processFile(
  filePath: string,
  rootPath: string,
  fileName: string,
  ext: string,
  sizeBytes: number,
): Promise<ScannedFile> {
  let textContent = '';
  let adrNumber: string | null = null;
  let error: string | null = null;

  if (ext === '.pdf') {
    // Try pdf-parse first (fast, works for text PDFs)
    try {
      const buffer = fs.readFileSync(filePath);
      const parsed = await pdfParse(buffer);
      textContent = parsed.text ?? '';
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    // If pdf-parse returned empty text, check PaddleOCR cache (for image-only PDFs)
    if (!textContent.trim()) {
      const cache = getOcrCache();
      const normalizedPath = filePath.replace(/\\/g, '/');
      if (cache[normalizedPath]) {
        textContent = cache[normalizedPath]!;
        error = null; // Clear any pdf-parse error since OCR succeeded
      }
    }

    if (textContent) {
      adrNumber = extractADR(textContent);
    }
  }

  const { reportType, category, confidence } = classifyFile(fileName, textContent);

  // Strip date prefix + extension for a clean display name
  const displayName = fileName
    .replace(/^\d{2}[\.\-_]\d{2}[\.\-_]\d{2,4}\s*/,'')     // "03.17.26 " prefix
    .replace(/^(Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s*\d{4}[\s\-]*/i, '') // "Mar 18, 2026-" prefix
    .replace(/\s*\(\d+\)/, '')                                // trailing " (2)"
    .replace(/[\s_]+\d{6}[\s_]+\d{6}$/, '')                  // trailing "_260318_015912"
    .replace(/\s+\d{1,2}[\.\-]\d{1,2}[\.\-]\d{2,4}$/, '')   // trailing " 3.17.26"
    .replace(/\s+\d{1,2}[\-]\d{1,2}[\-]\d{2,4}$/, '')        // trailing " 3-17-26"
    .replace(/\s+\d{1,2}[\-]\d{1,2}$/, '')                   // trailing " 3-17"
    .replace(/\.[^.]+$/, '')                                  // extension
    .replace(/^[\s\-_]+|[\s\-_]+$/g, '')                      // trim junk
    || fileName.replace(/\.[^.]+$/, '');

  return {
    filePath: filePath.replace(/\\/g, '/'),
    relativePath: path.relative(rootPath, filePath).replace(/\\/g, '/'),
    fileName,
    displayName,
    extension: ext,
    fileSizeBytes: sizeBytes,
    reportType,
    reportTypeCategory: category,
    adrNumber,
    confidence,
    error,
  };
}

// ─── CLI entry point ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const scanPath = args[0];
  const outFlagIdx = args.indexOf('--out');
  const outputPath = outFlagIdx !== -1 && args[outFlagIdx + 1]
    ? args[outFlagIdx + 1]!
    : path.join(process.cwd(), 'apps', 'web', 'public', 'data', 'output.json');

  if (!scanPath) {
    console.error('Usage: pnpm tsx scripts/scanAndCategorize.ts <folder-path> [--out <output-path>]');
    process.exit(1);
  }

  const resolvedPath = path.resolve(scanPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Path does not exist: ${resolvedPath}`);
    process.exit(1);
  }

  console.log(`\n  Scan & Categorize`);
  console.log(`  ${'─'.repeat(50)}`);
  console.log(`  Root:   ${resolvedPath}`);
  console.log(`  Output: ${outputPath}\n`);

  const summary = await scanFolder(resolvedPath);

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2), 'utf-8');

  // Print summary
  const elapsed = (summary.executionTimeMs / 1000).toFixed(1);
  console.log(`\n  ${'─'.repeat(50)}`);
  console.log(`  Results`);
  console.log(`  ${'─'.repeat(50)}`);
  console.log(`  Total files:     ${summary.totalFiles}`);
  console.log(`  PDFs parsed:     ${summary.totalParsed}/${summary.totalPdfs}`);
  console.log(`  ADR extracted:   ${summary.totalWithAdr}`);
  console.log(`  Errors:          ${summary.totalErrors}`);
  console.log(`  Time:            ${elapsed}s`);
  console.log(`\n  Categories:`);
  for (const [cat, count] of Object.entries(summary.categoryCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${cat.padEnd(20)} ${count}`);
  }
  console.log(`\n  Report Types:`);
  for (const [type, count] of Object.entries(summary.reportTypeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type.padEnd(30)} ${count}`);
  }
  console.log(`\n  Properties: ${summary.allProperties.length} detected`);
  for (const [prop, count] of Object.entries(summary.propertyCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${prop.padEnd(35)} ${count} folders`);
  }
  console.log(`\n  Output: ${outputPath}\n`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
