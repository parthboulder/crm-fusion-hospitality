/**
 * Local OCR hotel report scanner using OCR-V1 (Tesseract.js).
 *
 * Same classification logic as scanWithOCR.ts but uses local OCR instead of Mistral cloud.
 * Strategy:
 *   1. Spreadsheets (XLSX/CSV/ODS) -> direct read (instant)
 *   2. Text-based PDFs -> native pdfjs extraction (instant, 100% accurate)
 *   3. Scanned PDFs/images -> Tesseract.js OCR via OCR-V1 worker pool
 *
 * Usage:
 *   pnpm tsx scripts/scanWithOCR-local.ts <folder-path> [--out <path>] [--concurrency <n>] [--workers <n>]
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';

// OCR-V1 imports
import { extractPdfText } from '../OCR-V1-/lib/ocr/pdfTextExtractor.js';
import { extractPdfPages } from '../OCR-V1-/lib/ocr/pdfHandler.js';
import { TesseractWorkerPool } from '../OCR-V1-/lib/ocr/workerPool.js';
import { preprocessImage } from '../OCR-V1-/lib/ocr/preprocess.js';
import { postprocessText } from '../OCR-V1-/lib/ocr/postprocess.js';
import { extractSpreadsheet } from '../OCR-V1-/lib/ocr/spreadsheetHandler.js';
import { nvidiaOcrRecognize } from '../OCR-V1-/lib/ocr/nvidiaOcr.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ExtractedKPIs {
  occupancyPct?: number;
  adr?: number;
  revpar?: number;
  roomsSold?: number;
  totalRevenue?: number;
  roomRevenue?: number;
  oooRooms?: number;
  arTotal?: number;
  ar90Plus?: number;
}

interface ScannedFile {
  filePath: string;
  relativePath: string;
  fileName: string;
  displayName: string;
  extension: string;
  fileSizeBytes: number;
  reportType: string;
  reportTypeCategory: string;
  adrNumber: string | null;
  confidence: number;
  error: string | null;
  ocrPageCount: number;
  contentPreview: string;
  /** Full extracted text (stored for Revenue Flash reports) */
  fullText?: string;
  tableHeaders: string[];
  dataPatterns: string[];
  kpis: ExtractedKPIs;
  /** How the file content was extracted */
  extractionMethod: 'native-pdf' | 'ocr-pdf' | 'spreadsheet' | 'filename-only';
}

interface PropertyFolder {
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

interface DateFolder {
  rawName: string;
  normalizedDate: string;
  propertyFolders: PropertyFolder[];
  standaloneFiles: ScannedFile[];
  totalFiles: number;
  totalProperties: number;
}

interface FlatResult extends ScannedFile {
  dateFolder: string;
  propertyFolder: string;
  property: string | null;
}

interface ScanSummary {
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
  results: FlatResult[];
}

// ─── Content-first classification rules ──────────────────────────────────────

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

// ─── Property matching ───────────────────────────────────────────────────────

const PROPERTY_ALIASES: Array<{ code: string; name: string; patterns: RegExp[] }> = [
  { code: 'BWTP', name: 'Best Western Plus Tupelo', patterns: [/best\s*western\s*plus?\s*tupelo|audit\s*for\s*best\s*western|tupelo\s*inn/i] },
  { code: 'BWPOB', name: 'BW Plus Desoto', patterns: [/best\s*western\s*plus?\s*(desoto|olive\s*branch)|bw.*desoto/i] },
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
  { code: 'TUPGD', name: 'TUPGD Property', patterns: [/tupgd|home2\s*suites/i] },
  { code: 'TRUTP', name: 'Tru By Hilton Tupelo', patterns: [/tupgs|tru\s*(by\s*)?hilton/i] },
  { code: 'MEMNP', name: 'MEMNP Property', patterns: [/memnp/i] },
  { code: 'HGIMR', name: 'HGI Meridian', patterns: [/hgi\s*meridian|hilton\s*garden.*meridian/i] },
  { code: 'HAMPMR', name: 'Hampton Inn Meridian', patterns: [/hampton.*meridian/i] },
  { code: 'HIMRD', name: 'Holiday Inn Meridian', patterns: [/holiday\s*inn\s*meridian/i] },
];

// ─── Core functions ──────────────────────────────────────────────────────────

function parseDateFolder(name: string): string | null {
  const match = name.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[1]}-${match[2]}`;
}

// ─── Zip extraction & nested folder flattening ─────────────────────────────

const ZIP_EXTS = new Set(['.zip']);

/**
 * Extract all zip files in a directory into subfolders (in-place, inside a
 * temp working copy).  Each zip `Foo.zip` is extracted to `Foo/`.
 * Only extracts scannable file types to avoid dumping gigabytes of irrelevant
 * data.  Returns the number of zips processed.
 */
function extractZipsInDir(dirPath: string): number {
  let count = 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!ZIP_EXTS.has(ext)) continue;

    const zipPath = path.join(dirPath, entry.name);
    const destName = entry.name.replace(/\.zip$/i, '');
    const destDir = path.join(dirPath, destName);

    try {
      const zip = new AdmZip(zipPath);
      const zipEntries = zip.getEntries();
      const SCANNABLE = new Set(['.pdf', '.xlsx', '.xls', '.csv', '.ods', '.tsv']);

      for (const ze of zipEntries) {
        if (ze.isDirectory) continue;
        const zeExt = path.extname(ze.entryName).toLowerCase();
        if (!SCANNABLE.has(zeExt)) continue;

        // Flatten nested dirs inside the zip — put all files directly in destDir
        const baseName = path.basename(ze.entryName);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(path.join(destDir, baseName), ze.getData());
      }
      count++;
    } catch (err) {
      console.warn(`  ⚠ Failed to extract ${entry.name}: ${(err as Error).message}`);
    }
  }
  return count;
}

/**
 * Resolve the effective content directory for a date folder.
 * Handles the case where a date folder contains a single nested subfolder
 * with the same MMDDYYYY name (e.g. `03312026/03312026/`).
 * Returns the path that actually contains property folders / files.
 */
function resolveNestedDateDir(dateFolderPath: string, rawName: string): string {
  const inner = path.join(dateFolderPath, rawName);
  if (fs.existsSync(inner) && fs.statSync(inner).isDirectory()) {
    // Check that the inner folder actually has content (dirs or scannable files)
    const innerEntries = fs.readdirSync(inner, { withFileTypes: true });
    const hasContent = innerEntries.some((e) =>
      e.isDirectory() || ['.pdf', '.xlsx', '.xls', '.csv', '.ods', '.tsv'].includes(path.extname(e.name).toLowerCase()),
    );
    if (hasContent) {
      console.log(`    ↳ Nested date folder detected — using ${rawName}/${rawName}/`);
      return inner;
    }
  }
  return dateFolderPath;
}

function matchProperty(folderName: string): { code: string; name: string; confidence: number } | null {
  for (const prop of PROPERTY_ALIASES) {
    for (const pattern of prop.patterns) {
      if (pattern.test(folderName)) return { code: prop.code, name: prop.name, confidence: 0.9 };
    }
  }
  return null;
}

function makeDisplayName(fileName: string): string {
  return fileName
    .replace(/^\d{2}[\.\-_]\d{2}[\.\-_]\d{2,4}\s*/, '')
    .replace(/^(Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s*\d{4}[\s\-]*/i, '')
    .replace(/\s*\(\d+\)/, '')
    .replace(/[\s_]+\d{6}[\s_]+\d{6}$/, '')
    .replace(/\s+\d{1,2}[\.\-]\d{1,2}[\.\-]\d{2,4}$/, '')
    .replace(/\s+\d{1,2}[\-]\d{1,2}$/, '')
    .replace(/\.[^.]+$/, '')
    .replace(/^[\s\-_]+|[\s\-_]+$/g, '')
    || fileName.replace(/\.[^.]+$/, '');
}

function extractDateFromName(name: string): string | null {
  const patterns = [/(\d{2})\.(\d{2})\.(\d{2,4})/, /(\d{2})-(\d{2})-(\d{2,4})/, /(\d{2})_(\d{2})_(\d{2,4})/];
  for (const pattern of patterns) {
    const match = name.match(pattern);
    if (match) {
      const yyyy = match[3]!.length === 2 ? `20${match[3]}` : match[3];
      const m = parseInt(match[1]!, 10), d = parseInt(match[2]!, 10);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${yyyy}-${match[1]!.padStart(2, '0')}-${match[2]!.padStart(2, '0')}`;
    }
  }
  return null;
}

function classifyFromContent(
  markdown: string,
  tableContents: string[],
  fileName: string,
): { reportType: string; category: string; confidence: number; dataPatterns: string[]; tableHeaders: string[] } {
  const fullText = markdown + '\n' + tableContents.join('\n');
  const dataPatterns: string[] = [];
  const tableHeaders: string[] = [];

  const headerMatches = fullText.matchAll(/\|\s*([A-Z][A-Za-z\s&\/]+)\s*\|/g);
  for (const m of headerMatches) {
    const h = m[1]!.trim();
    if (h.length > 3 && h.length < 50 && !tableHeaders.includes(h)) tableHeaders.push(h);
  }

  if (/Occ(upancy)?\s*%/i.test(fullText)) dataPatterns.push('occupancy');
  if (/\bADR\b/i.test(fullText)) dataPatterns.push('adr');
  if (/RevPAR/i.test(fullText)) dataPatterns.push('revpar');
  if (/Room Revenue/i.test(fullText)) dataPatterns.push('room_revenue');
  if (/Current.*30.*60.*90/i.test(fullText)) dataPatterns.push('aging_buckets');
  if (/Credit Card|CC\s*#/i.test(fullText)) dataPatterns.push('credit_card');
  if (/Folio/i.test(fullText)) dataPatterns.push('folio');
  if (/Check In.*Check Out/i.test(fullText)) dataPatterns.push('reservation');
  if (/Room.*Number.*Type/i.test(fullText)) dataPatterns.push('room_listing');
  if (/Transaction.*Code/i.test(fullText)) dataPatterns.push('transactions');
  if (/Tax/i.test(fullText)) dataPatterns.push('tax');
  if (/Deposit/i.test(fullText)) dataPatterns.push('deposit');
  if (/Maintenance|Non.?Rentable/i.test(fullText)) dataPatterns.push('maintenance');

  for (const rule of SORTED_RULES) {
    const contentMatch = rule.contentPatterns.some((p) => p.test(fullText));
    if (contentMatch) {
      if (rule.tableHeaderPatterns) {
        const tableMatch = rule.tableHeaderPatterns.some((p) => p.test(fullText));
        if (tableMatch) {
          return { reportType: rule.reportType, category: rule.category, confidence: 0.95, dataPatterns, tableHeaders };
        }
      }
      return { reportType: rule.reportType, category: rule.category, confidence: 0.85, dataPatterns, tableHeaders };
    }
  }

  for (const rule of SORTED_RULES) {
    if (rule.contentPatterns.some((p) => p.test(fileName))) {
      return { reportType: rule.reportType, category: rule.category, confidence: 0.6, dataPatterns, tableHeaders };
    }
  }

  return { reportType: 'Unknown', category: 'Uncategorized', confidence: 0.2, dataPatterns, tableHeaders };
}

function extractKPIs(markdown: string): ExtractedKPIs {
  const kpis: ExtractedKPIs = {};

  const adrMatch = markdown.match(/ADR[^|]*?\$?\s*([\d,]+\.?\d*)/i);
  if (adrMatch) { const v = parseFloat(adrMatch[1]!.replace(/,/g, '')); if (v >= 30 && v <= 1000) kpis.adr = v; }

  const occMatch = markdown.match(/Occupancy[^|]*?([\d.]+)\s*%/i) || markdown.match(/Occ\s*%[^|]*?([\d.]+)/i);
  if (occMatch) { const v = parseFloat(occMatch[1]!); if (v > 0 && v <= 100) kpis.occupancyPct = v; }

  const revparMatch = markdown.match(/RevPAR[^|]*?\$?\s*([\d,]+\.?\d*)/i);
  if (revparMatch) { const v = parseFloat(revparMatch[1]!.replace(/,/g, '')); if (v > 0 && v < 1000) kpis.revpar = v; }

  const soldMatch = markdown.match(/ROOM\s*SOLD[^|]*?([\d,]+)/i);
  if (soldMatch) kpis.roomsSold = parseInt(soldMatch[1]!.replace(/,/g, ''), 10);

  const oooMatch = markdown.match(/OUT OF ORDER[^|]*?([\d,]+)/i);
  if (oooMatch) kpis.oooRooms = parseInt(oooMatch[1]!.replace(/,/g, ''), 10);

  return kpis;
}

// ─── OCR processing (using OCR-V1 locally) ──────────────────────────────────

// No page limit — process all pages like OCR-V1 does
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || '';

async function processFileWithLocalOCR(
  pool: TesseractWorkerPool,
  filePath: string,
  rootPath: string,
  fileName: string,
  ext: string,
  sizeBytes: number,
): Promise<ScannedFile> {
  const displayName = makeDisplayName(fileName);
  const base: Omit<ScannedFile, 'reportType' | 'reportTypeCategory' | 'confidence' | 'ocrPageCount' | 'contentPreview' | 'tableHeaders' | 'dataPatterns' | 'kpis'> = {
    filePath: filePath.replace(/\\/g, '/'),
    relativePath: path.relative(rootPath, filePath).replace(/\\/g, '/'),
    fileName,
    displayName,
    extension: ext,
    fileSizeBytes: sizeBytes,
    adrNumber: null,
    error: null,
    extractionMethod: 'filename-only',
  };

  // Spreadsheets: direct read
  if (['.xlsx', '.xls', '.csv', '.ods', '.tsv'].includes(ext)) {
    try {
      const result = extractSpreadsheet(filePath);
      const markdown = result.totalText;
      const { reportType, category, confidence, dataPatterns, tableHeaders } = classifyFromContent(markdown, [], fileName);
      const kpis = extractKPIs(markdown);
      return {
        ...base,
        reportType, reportTypeCategory: category, confidence,
        ocrPageCount: 0, contentPreview: markdown.substring(0, 500),
        tableHeaders, dataPatterns, kpis,
        adrNumber: kpis.adr ? kpis.adr.toFixed(2) : null,
        fullText: markdown,
        extractionMethod: 'spreadsheet' as const,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const { reportType, category, confidence, dataPatterns, tableHeaders } = classifyFromContent('', [], fileName);
      return { ...base, reportType, reportTypeCategory: category, confidence: Math.min(confidence, 0.5), error: errorMsg, ocrPageCount: 0, contentPreview: '', tableHeaders, dataPatterns, kpis: {}, extractionMethod: 'spreadsheet' as const };
    }
  }

  // Non-PDF/spreadsheet: classify by filename only
  if (ext !== '.pdf') {
    const { reportType, category, confidence, dataPatterns, tableHeaders } = classifyFromContent('', [], fileName);
    return { ...base, reportType, reportTypeCategory: category, confidence, ocrPageCount: 0, contentPreview: '', tableHeaders, dataPatterns, kpis: {} };
  }

  // PDF: try native text extraction first, fallback to Tesseract OCR
  try {
    let markdown = '';
    let ocrPageCount = 0;
    let method: 'native' | 'ocr' = 'native';

    // Try native text extraction
    let nativeResult: Awaited<ReturnType<typeof extractPdfText>> | null = null;
    try {
      nativeResult = await extractPdfText(filePath);
    } catch {
      // Fall through to OCR
    }

    if (nativeResult?.isTextBased) {
      markdown = nativeResult.pages.map((p) => p.text).join('\n\n');
      ocrPageCount = nativeResult.pages.length;
      method = 'native';
    } else {
      // Scanned PDF: use NVIDIA NIM OCR if available, else Tesseract
      method = 'ocr';
      try {
        const pdfPages = await extractPdfPages(filePath, 1.5);

        if (pdfPages.length > 0) {
          if (NVIDIA_API_KEY) {
            // NVIDIA NIM OCR (cloud, ~96% accuracy)
            const ocrTexts: string[] = [];
            for (const page of pdfPages) {
              const ocr = await nvidiaOcrRecognize(page.imageBuffer, {
                apiKey: NVIDIA_API_KEY,
                mergeLevel: 'paragraph',
              });
              ocrTexts.push(ocr.text);
            }
            markdown = ocrTexts.map((text, i) =>
              pdfPages.length > 1 ? `--- Page ${pdfPages[i]!.pageNumber} ---\n${text}` : text
            ).join('\n\n');
          } else {
            // Tesseract.js fallback (local, no API key needed)
            const preprocessed = await Promise.all(
              pdfPages.map((p) => preprocessImage(p.imageBuffer))
            );
            const ocrResults = await pool.recognizeBatch(preprocessed);
            markdown = ocrResults.map((r, i) => {
              const text = postprocessText(r.text);
              return pdfPages.length > 1 ? `--- Page ${pdfPages[i]!.pageNumber} ---\n${text}` : text;
            }).join('\n\n');
          }
          ocrPageCount = pdfPages.length;
        }
      } catch (ocrErr) {
        const errorMsg = ocrErr instanceof Error ? ocrErr.message : String(ocrErr);
        const { reportType, category, confidence, dataPatterns, tableHeaders } = classifyFromContent('', [], fileName);
        return { ...base, reportType, reportTypeCategory: category, confidence: Math.min(confidence, 0.5), error: `OCR failed: ${errorMsg}`, ocrPageCount: 0, contentPreview: '', tableHeaders, dataPatterns, kpis: {}, extractionMethod: 'ocr-pdf' as const };
      }
    }

    const { reportType, category, confidence, dataPatterns, tableHeaders } = classifyFromContent(markdown, [], fileName);
    const kpis = extractKPIs(markdown);
    const adrNumber = kpis.adr ? kpis.adr.toFixed(2) : null;
    const contentPreview = markdown.substring(0, 500);

    return {
      ...base, reportType, reportTypeCategory: category, confidence,
      adrNumber, ocrPageCount, contentPreview, tableHeaders, dataPatterns, kpis,
      fullText: markdown,
      extractionMethod: method === 'native' ? 'native-pdf' as const : 'ocr-pdf' as const,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const { reportType, category, confidence, dataPatterns, tableHeaders } = classifyFromContent('', [], fileName);
    return {
      ...base, reportType, reportTypeCategory: category,
      confidence: Math.min(confidence, 0.5), error: errorMsg,
      ocrPageCount: 0, contentPreview: '', tableHeaders, dataPatterns, kpis: {},
    };
  }
}

// ─── Concurrency helper ──────────────────────────────────────────────────────

async function processWithConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
  onProgress?: (completed: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let completed = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await fn(items[idx]!, idx);
      completed++;
      onProgress?.(completed, items.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

// ─── Main scan ───────────────────────────────────────────────────────────────

const PROGRESS_FILE = path.join(process.cwd(), 'apps', 'web', 'public', 'data', 'scan-progress.json');

interface ScanProgress {
  status: 'scanning' | 'done' | 'error';
  startedAt: string;
  currentDate: string;
  currentDateIndex: number;
  totalDateFolders: number;
  filesProcessed: number;
  filesInCurrentDate: number;
  totalFilesEstimate: number;
  elapsedMs: number;
  currentFile: string;
  errorMessage?: string;
  /** Per-type estimates (counted at start) */
  totalPdfEstimate: number;
  totalSpreadsheetEstimate: number;
  /** Categorized processed counts */
  nativePdfCount: number;
  ocrPdfCount: number;
  spreadsheetCount: number;
}

function writeProgress(progress: ScanProgress): void {
  try {
    const dir = path.dirname(PROGRESS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Atomic write: write to temp file then rename to avoid partial reads
    const tmpFile = PROGRESS_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(progress));
    fs.renameSync(tmpFile, PROGRESS_FILE);
  } catch { /* ignore */ }
}

async function scanFolder(rootPath: string, concurrency: number, numWorkers: number): Promise<ScanSummary> {
  const startTime = Date.now();
  const startedAt = new Date().toISOString();

  // Initialize Tesseract worker pool
  const pool = new TesseractWorkerPool({ numWorkers, language: 'eng' });
  let poolInitialized = false;

  const dateFolders: DateFolder[] = [];
  const flatResults: FlatResult[] = [];
  let totalFiles = 0, totalPdfs = 0, totalParsed = 0, totalErrors = 0, totalWithAdr = 0;
  let globalFilesProcessed = 0;
  let nativePdfCount = 0, ocrPdfCount = 0, spreadsheetCount = 0;
  const categoryCounts: Record<string, number> = {};
  const reportTypeCounts: Record<string, number> = {};
  const propertyCounts: Record<string, number> = {};

  // Find Revenue Flash folder
  let scanBase = rootPath;
  const rfPath = path.join(rootPath, 'Revenue Flash');
  if (fs.existsSync(rfPath) && fs.statSync(rfPath).isDirectory()) scanBase = rfPath;

  const topEntries = fs.readdirSync(scanBase, { withFileTypes: true });
  const dateDirs = topEntries.filter((e) => e.isDirectory() && /^\d{8}$/.test(e.name));

  // Estimate total file count (only valid extensions), split by type
  const PDF_EXTS = new Set(['.pdf']);
  const SPREADSHEET_EXTS = new Set(['.xlsx', '.xls', '.csv', '.ods', '.tsv']);
  const VALID_EXTS = new Set([...PDF_EXTS, ...SPREADSHEET_EXTS]);
  let totalFilesEstimate = 0;
  let totalPdfEstimate = 0;
  let totalSpreadsheetEstimate = 0;

  // Pre-pass: extract zips and resolve nested date folders before estimation
  for (const dd of dateDirs) {
    const dp = path.join(scanBase, dd.name);
    try {
      // 1. Flatten nested date folder (e.g. 03312026/03312026/ → use inner)
      const effective = resolveNestedDateDir(dp, dd.name);

      // 2. Extract zips in the effective directory
      const zipsExtracted = extractZipsInDir(effective);
      if (zipsExtracted > 0) console.log(`    ↳ Extracted ${zipsExtracted} zip(s) in ${dd.name}`);
    } catch (err) {
      console.warn(`  ⚠ Pre-pass error for ${dd.name}: ${(err as Error).message}`);
    }
  }

  // Count files after zip extraction & nested folder resolution
  for (const dd of dateDirs) {
    const dp = resolveNestedDateDir(path.join(scanBase, dd.name), dd.name);
    try {
      const entries = fs.readdirSync(dp, { withFileTypes: true });
      for (const e of entries.filter((e) => e.isFile())) {
        const ext = path.extname(e.name).toLowerCase();
        if (!VALID_EXTS.has(ext)) continue;
        totalFilesEstimate++;
        if (PDF_EXTS.has(ext)) totalPdfEstimate++;
        else if (SPREADSHEET_EXTS.has(ext)) totalSpreadsheetEstimate++;
      }
      for (const sub of entries.filter((e) => e.isDirectory())) {
        try {
          const subFiles = fs.readdirSync(path.join(dp, sub.name));
          for (const f of subFiles) {
            const ext = path.extname(f).toLowerCase();
            if (!VALID_EXTS.has(ext)) continue;
            totalFilesEstimate++;
            if (PDF_EXTS.has(ext)) totalPdfEstimate++;
            else if (SPREADSHEET_EXTS.has(ext)) totalSpreadsheetEstimate++;
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  const ocrEngine = NVIDIA_API_KEY ? 'NVIDIA NIM' : `Tesseract.js (${numWorkers} workers)`;
  console.log(`  Found ${dateDirs.length} date folders (~${totalFilesEstimate} files)`);
  console.log(`  OCR Engine: ${ocrEngine}\n`);

  writeProgress({ status: 'scanning', startedAt, currentDate: '', currentDateIndex: 0, totalDateFolders: dateDirs.length, filesProcessed: 0, filesInCurrentDate: 0, totalFilesEstimate, elapsedMs: 0, currentFile: '', totalPdfEstimate, totalSpreadsheetEstimate, nativePdfCount: 0, ocrPdfCount: 0, spreadsheetCount: 0 });

  let dateIndex = 0;
  for (const dateDir of dateDirs.sort((a, b) => a.name.localeCompare(b.name))) {
    const normalizedDate = parseDateFolder(dateDir.name);
    if (!normalizedDate) continue;
    dateIndex++;

    console.log(`  Processing ${dateDir.name} (${normalizedDate})...`);
    const rawDateFolderPath = path.join(scanBase, dateDir.name);
    // Resolve nested date folders (e.g. 03312026/03312026/) and use extracted zip content
    const dateFolderPath = resolveNestedDateDir(rawDateFolderPath, dateDir.name);
    const dateEntries = fs.readdirSync(dateFolderPath, { withFileTypes: true });

    const propertyFolders: PropertyFolder[] = [];
    const standaloneFiles: ScannedFile[] = [];

    interface FileJob { filePath: string; fileName: string; ext: string; size: number; propLabel: string | null; propFolderName: string }
    const jobs: FileJob[] = [];

    // Standalone files at date level
    for (const entry of dateEntries.filter((e) => e.isFile())) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!['.pdf', '.xlsx', '.xls', '.csv', '.ods'].includes(ext)) continue;
      const filePath = path.join(dateFolderPath, entry.name);
      const stat = fs.statSync(filePath);
      jobs.push({ filePath, fileName: entry.name, ext, size: stat.size, propLabel: null, propFolderName: '(standalone)' });
    }

    // Property subfolders
    for (const propDir of dateEntries.filter((e) => e.isDirectory())) {
      const propFolderPath = path.join(dateFolderPath, propDir.name);
      const propMatch = matchProperty(propDir.name);
      const propLabel = propMatch ? `${propMatch.code} - ${propMatch.name}` : null;

      let propFileEntries: fs.Dirent[];
      try { propFileEntries = fs.readdirSync(propFolderPath, { withFileTypes: true }); } catch { continue; }

      for (const fileEntry of propFileEntries.filter((e) => e.isFile())) {
        const ext = path.extname(fileEntry.name).toLowerCase();
        if (!['.pdf', '.xlsx', '.xls', '.csv', '.ods'].includes(ext)) continue;
        const filePath = path.join(propFolderPath, fileEntry.name);
        const stat = fs.statSync(filePath);
        jobs.push({ filePath, fileName: fileEntry.name, ext, size: stat.size, propLabel, propFolderName: propDir.name });
      }
    }

    // Initialize pool lazily (only when we have PDFs that might need OCR)
    const hasPdfs = jobs.some((j) => j.ext === '.pdf');
    if (hasPdfs && !poolInitialized) {
      await pool.initialize();
      poolInitialized = true;
    }

    // Process all files with concurrency
    const results = await processWithConcurrency(
      jobs,
      async (job) => {
        const file = await processFileWithLocalOCR(pool, job.filePath, rootPath, job.fileName, job.ext, job.size);
        return { file, job };
      },
      concurrency,
      (done, total) => {
        globalFilesProcessed++;
        if (done % 5 === 0 || done === total) {
          process.stdout.write(`\r    ${done}/${total} files...`);
          writeProgress({
            status: 'scanning',
            startedAt,
            currentDate: normalizedDate,
            currentDateIndex: dateIndex,
            totalDateFolders: dateDirs.length,
            filesProcessed: globalFilesProcessed,
            filesInCurrentDate: done,
            totalFilesEstimate,
            elapsedMs: Date.now() - startTime,
            currentFile: `${normalizedDate} (${done}/${total})`,
            totalPdfEstimate,
            totalSpreadsheetEstimate,
            nativePdfCount,
            ocrPdfCount,
            spreadsheetCount,
          });
        }
      },
    );
    console.log('');

    // Organize results into property folders
    const propFolderMap = new Map<string, { match: ReturnType<typeof matchProperty>; files: ScannedFile[] }>();

    for (const { file, job } of results) {
      totalFiles++;
      if (job.ext === '.pdf') totalPdfs++;
      if (file.error) totalErrors++;
      else if (job.ext === '.pdf') totalParsed++;
      if (file.adrNumber) totalWithAdr++;

      // Track extraction method counts
      if (file.extractionMethod === 'native-pdf') nativePdfCount++;
      else if (file.extractionMethod === 'ocr-pdf') ocrPdfCount++;
      else if (file.extractionMethod === 'spreadsheet') spreadsheetCount++;

      categoryCounts[file.reportTypeCategory] = (categoryCounts[file.reportTypeCategory] ?? 0) + 1;
      reportTypeCounts[file.reportType] = (reportTypeCounts[file.reportType] ?? 0) + 1;
      if (job.propLabel) propertyCounts[job.propLabel] = (propertyCounts[job.propLabel] ?? 0) + 1;

      flatResults.push({ ...file, dateFolder: normalizedDate, propertyFolder: job.propFolderName, property: job.propLabel });

      if (job.propFolderName === '(standalone)') {
        standaloneFiles.push(file);
      } else {
        if (!propFolderMap.has(job.propFolderName)) {
          propFolderMap.set(job.propFolderName, { match: matchProperty(job.propFolderName), files: [] });
        }
        propFolderMap.get(job.propFolderName)!.files.push(file);
      }
    }

    for (const [folderName, { match, files }] of propFolderMap) {
      const rtCounts: Record<string, number> = {};
      for (const f of files) rtCounts[f.reportType] = (rtCounts[f.reportType] ?? 0) + 1;

      propertyFolders.push({
        folderName,
        folderPath: path.join(dateFolderPath, folderName),
        propertyCode: match?.code ?? null,
        propertyName: match?.name ?? null,
        propertyConfidence: match?.confidence ?? 0,
        reportDate: extractDateFromName(folderName) ?? normalizedDate,
        files,
        fileCount: files.length,
        reportTypeCounts: rtCounts,
      });
    }

    dateFolders.push({
      rawName: dateDir.name,
      normalizedDate,
      propertyFolders,
      standaloneFiles,
      totalFiles: standaloneFiles.length + propertyFolders.reduce((s, p) => s + p.fileCount, 0),
      totalProperties: propertyFolders.length,
    });

    console.log(`    -> ${propertyFolders.length} properties, ${results.length} files`);
  }

  // Cleanup
  if (poolInitialized) {
    await pool.terminate();
  }

  const execTime = Date.now() - startTime;

  writeProgress({
    status: 'done',
    startedAt,
    currentDate: '',
    currentDateIndex: dateDirs.length,
    totalDateFolders: dateDirs.length,
    filesProcessed: totalFiles,
    filesInCurrentDate: 0,
    totalFilesEstimate: totalFiles,
    elapsedMs: execTime,
    currentFile: '',
    totalPdfEstimate,
    totalSpreadsheetEstimate,
    nativePdfCount,
    ocrPdfCount,
    spreadsheetCount,
  });

  return {
    scanRoot: rootPath.replace(/\\/g, '/'),
    scannedAt: new Date().toISOString(),
    executionTimeMs: execTime,
    totalFiles, totalPdfs, totalParsed, totalErrors, totalWithAdr,
    dateFolders,
    categoryCounts,
    reportTypeCounts,
    propertyCounts,
    allDates: dateFolders.map((d) => d.normalizedDate),
    allProperties: [...new Set(flatResults.map((r) => r.property).filter(Boolean))] as string[],
    results: flatResults,
  };
}

// ─── Merge logic — preserve previous scan data ─────────────────────────────

function mergeScanSummaries(existing: ScanSummary, incoming: ScanSummary): ScanSummary {
  // New scan dates replace old data for the same dates (re-scan updates);
  // dates that only exist in the old scan are preserved.
  const incomingDates = new Set(incoming.allDates);

  // Keep old results whose date is NOT in the new scan
  const preservedResults = existing.results.filter((r) => !incomingDates.has(r.dateFolder));
  const mergedResults = [...preservedResults, ...incoming.results];

  // Merge dateFolders the same way
  const preservedDateFolders = existing.dateFolders.filter((df) => !incomingDates.has(df.normalizedDate));
  const mergedDateFolders = [...preservedDateFolders, ...incoming.dateFolders].sort((a, b) => a.normalizedDate.localeCompare(b.normalizedDate));

  // Recompute aggregate counts
  const categoryCounts: Record<string, number> = {};
  const reportTypeCounts: Record<string, number> = {};
  const propertyCounts: Record<string, number> = {};
  for (const r of mergedResults) {
    categoryCounts[r.reportTypeCategory] = (categoryCounts[r.reportTypeCategory] ?? 0) + 1;
    reportTypeCounts[r.reportType] = (reportTypeCounts[r.reportType] ?? 0) + 1;
    if (r.property) propertyCounts[r.property] = (propertyCounts[r.property] ?? 0) + 1;
  }

  return {
    scanRoot: incoming.scanRoot,
    scannedAt: incoming.scannedAt,
    executionTimeMs: incoming.executionTimeMs,
    totalFiles: mergedResults.length,
    totalPdfs: mergedResults.filter((r) => r.extension === '.pdf').length,
    totalParsed: existing.totalParsed + incoming.totalParsed,
    totalErrors: mergedResults.filter((r) => r.error !== null).length,
    totalWithAdr: mergedResults.filter((r) => r.adrNumber !== null).length,
    dateFolders: mergedDateFolders,
    categoryCounts,
    reportTypeCounts,
    propertyCounts,
    allDates: mergedDateFolders.map((d) => d.normalizedDate),
    allProperties: [...new Set(mergedResults.map((r) => r.property).filter(Boolean))] as string[],
    results: mergedResults,
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const scanPath = args[0];
  const outIdx = args.indexOf('--out');
  const outputPath = outIdx !== -1 && args[outIdx + 1] ? args[outIdx + 1]! : path.join(process.cwd(), 'apps', 'web', 'public', 'data', 'output.json');
  const concIdx = args.indexOf('--concurrency');
  const concurrency = concIdx !== -1 && args[concIdx + 1] ? parseInt(args[concIdx + 1]!, 10) : 3;
  const workIdx = args.indexOf('--workers');
  const numWorkers = workIdx !== -1 && args[workIdx + 1] ? parseInt(args[workIdx + 1]!, 10) : Math.min(os.cpus().length, 4);

  if (!scanPath) {
    console.log(`
  Local OCR Content Scanner (Tesseract.js)
  ${'='.repeat(50)}

  Usage:
    pnpm tsx scripts/scanWithOCR-local.ts <folder-path> [options]

  Options:
    --out <path>         Output JSON path (default: apps/web/public/data/output.json)
    --concurrency <n>    Files processed in parallel (default: 3)
    --workers <n>        Tesseract worker threads (default: min(CPU cores, 4))

  Strategy:
    1. Spreadsheets (XLSX/CSV/ODS) -> direct read (instant)
    2. Text-based PDFs -> native text extraction (instant, 100% accurate)
    3. Scanned PDFs/images -> Tesseract.js OCR (local, no API key needed)
    `);
    process.exit(1);
  }

  const resolvedPath = path.resolve(scanPath);
  if (!fs.existsSync(resolvedPath)) { console.error(`Path does not exist: ${resolvedPath}`); process.exit(1); }

  console.log(`\n  Local OCR Content Scanner`);
  console.log(`  ${'─'.repeat(50)}`);
  console.log(`  Root:        ${resolvedPath}`);
  console.log(`  Output:      ${outputPath}`);
  console.log(`  Concurrency: ${concurrency}`);
  console.log(`  Workers:     ${numWorkers}\n`);

  const newSummary = await scanFolder(resolvedPath, concurrency, numWorkers);

  // Merge with existing output.json — preserve data from previous scans
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  let summary = newSummary;
  try {
    if (fs.existsSync(outputPath)) {
      const existing: ScanSummary = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      if (existing.results?.length > 0) {
        summary = mergeScanSummaries(existing, newSummary);
        console.log(`  Merged with previous scan: ${existing.results.length} existing + ${newSummary.results.length} new → ${summary.results.length} total`);
      }
    }
  } catch (err) {
    console.warn(`  ⚠ Could not merge with existing output.json, overwriting: ${(err as Error).message}`);
  }

  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2), 'utf-8');

  const elapsed = (summary.executionTimeMs / 1000).toFixed(1);
  console.log(`\n  ${'─'.repeat(50)}`);
  console.log(`  Results`);
  console.log(`  ${'─'.repeat(50)}`);
  console.log(`  Total files:     ${summary.totalFiles}`);
  console.log(`  PDFs OCR'd:      ${summary.totalParsed}/${summary.totalPdfs}`);
  console.log(`  ADR extracted:   ${summary.totalWithAdr}`);
  console.log(`  Errors:          ${summary.totalErrors}`);
  console.log(`  Time:            ${elapsed}s`);
  console.log(`\n  Categories:`);
  for (const [cat, count] of Object.entries(summary.categoryCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${cat.padEnd(20)} ${count}`);
  }
  console.log(`\n  Report Types: ${Object.keys(summary.reportTypeCounts).length}`);
  console.log(`  Properties:   ${summary.allProperties.length}`);
  console.log(`\n  Output: ${outputPath}\n`);
}

main().catch((err) => { console.error('Fatal error:', err); process.exit(1); });
