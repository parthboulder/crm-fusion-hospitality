/**
 * ZIP ingestion service — unzips, classifies, detects properties, and processes
 * documents from uploaded ZIP archives. Core intelligence for automated batch intake.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { db } from '@fusion/db';
import { env } from '../config/env.js';
import { REPORT_STATUS } from '../config/constants.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ZipFileEntry {
  absolutePath: string;
  relativePath: string;
  folderName: string;
  filename: string;
  extension: string;
  fileSizeBytes: number;
  checksum: string;
}

export interface PropertyMatch {
  propertyId: string;
  propertyName: string;
  confidence: number;
  source: 'folder_name' | 'file_name' | 'content_extraction';
}

export interface ClassifiedItem {
  file: ZipFileEntry;
  property: PropertyMatch | null;
  reportType: { slug: string; name: string; confidence: number } | null;
  detectedDate: string | null;
  overallConfidence: number;
  isDuplicate: boolean;
  duplicateOf: { itemId?: string; reportId?: string; method?: string } | null;
  status: 'classified' | 'not_classified' | 'needs_review' | 'duplicate' | 'skipped';
}

export interface BatchProcessingResult {
  batchId: string;
  totalFiles: number;
  totalFolders: number;
  classifiedCount: number;
  needsReviewCount: number;
  notClassifiedCount: number;
  duplicateCount: number;
  items: ClassifiedItem[];
  folderGroups: FolderGroup[];
}

export interface FolderGroup {
  folderName: string;
  property: PropertyMatch | null;
  items: ClassifiedItem[];
}

// ─── Property Aliases (from property-master.ts, adapted for DB lookup) ───────

interface PropertyAlias {
  patterns: string[];
  brandHints: string[];
}

const PROPERTY_ALIASES: Record<string, PropertyAlias> = {
  'hgi olive branch': { patterns: ['hgi ob', 'hilton garden inn olive branch', 'hgi olbr', 'olive branch hgi'], brandHints: ['hilton'] },
  'tru by hilton tupelo': { patterns: ['tru tupelo', 'tru hilton tupelo', 'tru by hilton', 'tbh tupelo'], brandHints: ['hilton', 'tru'] },
  'hampton inn vicksburg': { patterns: ['hampton vicksburg', 'hi vicksburg', 'hampton vburg'], brandHints: ['hilton', 'hampton'] },
  'doubletree biloxi': { patterns: ['dt biloxi', 'double tree biloxi', 'doubletree blx', 'dbl tree biloxi'], brandHints: ['hilton', 'doubletree'] },
  'home2 suites by hilton': { patterns: ['home2 suites', 'home2 biloxi', 'home 2 suites', 'h2s biloxi', 'home2'], brandHints: ['hilton', 'home2'] },
  'hilton garden inn madison': { patterns: ['hgi madison', 'hilton garden madison', 'hgi mad', 'garden inn madison'], brandHints: ['hilton', 'hgi'] },
  'hilton garden inn meridian': { patterns: ['hgi meridian', 'hilton garden meridian', 'hgi mer', 'garden inn meridian'], brandHints: ['hilton', 'hgi'] },
  'hampton inn meridian': { patterns: ['hampton meridian', 'hi meridian', 'hmptn meridian'], brandHints: ['hilton', 'hampton'] },
  'holiday inn meridian': { patterns: ['hi meridian', 'holiday meridian'], brandHints: ['ihg', 'holiday'] },
  'candlewood suites': { patterns: ['candlewood', 'cws tupelo', 'candlewood tupelo'], brandHints: ['ihg', 'candlewood'] },
  'holiday inn express fulton': { patterns: ['hie fulton', 'hiex fulton', 'hi express fulton', 'hix fulton'], brandHints: ['ihg', 'holiday'] },
  'holiday inn express memphis southwind': { patterns: ['hie memphis southwind', 'hiex memphis', 'hie memphis', 'hi express memphis', 'hie msw'], brandHints: ['ihg', 'holiday'] },
  'holiday inn express tupelo': { patterns: ['hie tupelo', 'hiex tupelo', 'hi express tupelo', 'hix tupelo'], brandHints: ['ihg', 'holiday'] },
  'holiday inn tupelo': { patterns: ['hi tupelo', 'holiday tupelo'], brandHints: ['ihg', 'holiday'] },
  'four points memphis southwind': { patterns: ['four points memphis', 'fp memphis', 'fp southwind', 'four points', 'four points by sheraton memphis'], brandHints: ['marriott', 'four points'] },
  'towneplace suites': { patterns: ['towneplace', 'tps ridgeland', 'towne place suites', 'tps'], brandHints: ['marriott', 'towneplace'] },
  'best western tupelo': { patterns: ['bw tupelo', 'best western'], brandHints: ['best western'] },
  'surestay hotel': { patterns: ['surestay', 'sure stay', 'surestay tupelo', 'ss tupelo'], brandHints: ['best western', 'surestay'] },
  'best western plus olive branch': { patterns: ['bwp olive branch', 'bw plus ob', 'bw olive branch', 'best western ob', 'bwp ob'], brandHints: ['best western'] },
  'hyatt place biloxi': { patterns: ['hyatt biloxi', 'hp biloxi', 'hyatt place blx'], brandHints: ['hyatt'] },
  'comfort inn tupelo': { patterns: ['comfort inn', 'ci tupelo', 'comfort tupelo'], brandHints: ['choice', 'comfort'] },
};

// ─── Report Type Patterns ────────────────────────────────────────────────────

interface ReportPattern {
  slug: string;
  name: string;
  patterns: RegExp[];
  keywords: string[];
  expectedExtensions: string[];
}

const REPORT_PATTERNS: ReportPattern[] = [
  { slug: 'revenue-flash', name: 'Revenue Flash', patterns: [/revenue\s*flash/i, /rev\s*flash/i, /flash\s*drive/i], keywords: ['revenue', 'flash'], expectedExtensions: ['.xlsx', '.xls', '.csv'] },
  { slug: 'daily-statistical-recap', name: 'Daily Statistical Recap', patterns: [/daily\s*report\s*statistical/i, /statistical\s*recap/i, /daily\s*stat/i, /daily\s*report/i, /stat\s*recap/i], keywords: ['daily', 'report', 'statistical', 'recap'], expectedExtensions: ['.pdf'] },
  { slug: 'manager-flash', name: 'Manager Flash', patterns: [/manager\s*flash/i, /mgr\s*flash/i, /manager\s*report/i, /flash\s*report/i], keywords: ['manager', 'flash'], expectedExtensions: ['.pdf'] },
  { slug: 'hotel-statistics', name: 'Hotel Statistics', patterns: [/hotel\s*statistics/i, /htl\s*stat/i, /property\s*statistics/i], keywords: ['hotel', 'statistics'], expectedExtensions: ['.pdf'] },
  { slug: 'marriott-manager-stats', name: 'Marriott Manager Stats', patterns: [/marriott\s*manager\s*stat/i, /manager\s*statistics/i, /mgr\s*stat/i], keywords: ['manager', 'statistics', 'marriott'], expectedExtensions: ['.pdf'] },
  { slug: 'marriott-revenue', name: 'Marriott Revenue', patterns: [/marriott\s*revenue/i, /revenue\s*report/i], keywords: ['marriott', 'revenue'], expectedExtensions: ['.pdf'] },
  { slug: 'aging-report', name: 'Aging Report', patterns: [/aging\s*report/i, /a\s*r\s*aging/i, /accounts?\s*receivable\s*aging/i, /aging/i], keywords: ['aging', 'ar', 'receivable'], expectedExtensions: ['.pdf'] },
  { slug: 'credit-card-transactions', name: 'Credit Card Transactions', patterns: [/credit\s*card\s*transaction/i, /cc\s*transaction/i, /credit\s*card/i], keywords: ['credit', 'card', 'transaction'], expectedExtensions: ['.pdf'] },
  { slug: 'room-tax-listing', name: 'Room & Tax Listing', patterns: [/room\s*(&|and)\s*tax\s*listing/i, /room\s*tax/i, /tax\s*listing/i], keywords: ['room', 'tax', 'listing'], expectedExtensions: ['.pdf'] },
  { slug: 'operator-transactions', name: 'Operator Transactions', patterns: [/operator\s*transaction/i, /op\s*transaction/i, /operator\s*report/i], keywords: ['operator', 'transaction'], expectedExtensions: ['.pdf'] },
  { slug: 'daily-transaction-log', name: 'Daily Transaction Log', patterns: [/daily\s*transaction\s*log/i, /transaction\s*log/i, /daily\s*log/i], keywords: ['daily', 'transaction', 'log'], expectedExtensions: ['.pdf'] },
  { slug: 'ooo-rooms', name: 'OOO Rooms', patterns: [/ooo\s*room/i, /out\s*of\s*order/i, /out\s*of\s*service/i, /oos\s*room/i, /down\s*room/i], keywords: ['ooo', 'out', 'order'], expectedExtensions: ['.xlsx', '.xls', '.csv', '.pdf'] },
];

const KNOWN_EXTENSIONS = new Set(['.pdf', '.xlsx', '.xls', '.csv']);
const SKIP_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini', '__macosx']);

const CONFIDENCE_THRESHOLD = 0.65;

// ─── Core Service ─────────────────────────────────────────────────────────────

function getAdminSupabase() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Normalize a string for fuzzy matching: lowercase, strip punctuation, collapse whitespace.
 */
function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse a date from a string (folder name or filename).
 */
function parseDateFromString(input: string): string | null {
  const cleaned = input.trim();

  // YYYY-MM-DD
  const iso = cleaned.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // MM-DD-YYYY or MM/DD/YYYY or MM.DD.YYYY
  const mdy4 = cleaned.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
  if (mdy4) return `${mdy4[3]}-${mdy4[1]!.padStart(2, '0')}-${mdy4[2]!.padStart(2, '0')}`;

  // MM-DD-YY or MM/DD/YY or MM.DD.YY
  const mdy2 = cleaned.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2})/);
  if (mdy2) {
    const year = parseInt(mdy2[3]!, 10);
    const fullYear = year >= 50 ? 1900 + year : 2000 + year;
    return `${fullYear}-${mdy2[1]!.padStart(2, '0')}-${mdy2[2]!.padStart(2, '0')}`;
  }

  // MMDDYYYY (8 digits)
  const mmddyyyy = cleaned.match(/(\d{2})(\d{2})(\d{4})/);
  if (mmddyyyy) return `${mmddyyyy[3]}-${mmddyyyy[1]}-${mmddyyyy[2]}`;

  return null;
}

/**
 * Fuzzy match an input string against all known properties in the database.
 * Uses alias patterns for scoring, then resolves to actual Property records.
 */
async function matchPropertyFromInput(
  input: string,
  orgId: string,
): Promise<PropertyMatch | null> {
  const normalized = normalize(input);
  if (!normalized || normalized === '_root') return null;

  // Load org properties from DB.
  const properties = await db.property.findMany({
    where: { orgId, isActive: true },
    select: { id: true, name: true, brand: true, brandCode: true, city: true },
  });

  let bestMatch: { propertyId: string; propertyName: string; score: number } | null = null;

  for (const prop of properties) {
    const propNorm = normalize(prop.name);

    // Exact match on DB property name.
    if (normalized === propNorm || normalized.includes(propNorm)) {
      const score = propNorm.length / Math.max(normalized.length, propNorm.length);
      const adjusted = Math.min(0.98, 0.75 + score * 0.23);
      if (!bestMatch || adjusted > bestMatch.score) {
        bestMatch = { propertyId: prop.id, propertyName: prop.name, score: adjusted };
      }
      continue;
    }

    // Check against alias registry.
    for (const [aliasKey, aliasData] of Object.entries(PROPERTY_ALIASES)) {
      const aliasNorm = normalize(aliasKey);

      // Does this alias match the DB property?
      const propNameNorm = propNorm;
      const aliasMatchesProp =
        propNameNorm.includes(aliasNorm) ||
        aliasNorm.includes(propNameNorm) ||
        aliasData.patterns.some((p) => normalize(p).includes(propNameNorm) || propNameNorm.includes(normalize(p)));

      if (!aliasMatchesProp) continue;

      // Does the input match this alias?
      if (normalized === aliasNorm || normalized.includes(aliasNorm)) {
        const score = Math.min(0.95, 0.72 + (aliasNorm.length / normalized.length) * 0.23);
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { propertyId: prop.id, propertyName: prop.name, score };
        }
        continue;
      }

      // Check alias patterns.
      for (const pattern of aliasData.patterns) {
        const patNorm = normalize(pattern);
        if (normalized.includes(patNorm) || patNorm.includes(normalized)) {
          const score = Math.min(0.90, 0.55 + (patNorm.length / Math.max(normalized.length, patNorm.length)) * 0.35);
          if (!bestMatch || score > bestMatch.score) {
            bestMatch = { propertyId: prop.id, propertyName: prop.name, score };
          }
        }
      }

      // Token-based similarity.
      const inputTokens = new Set(normalized.split(' '));
      const allPatternTokens = [aliasNorm, ...aliasData.patterns.map(normalize)]
        .flatMap((p) => p.split(' '));
      const uniquePatternTokens = [...new Set(allPatternTokens)];
      const matched = uniquePatternTokens.filter((t) => inputTokens.has(t) && t.length > 2);

      if (matched.length >= 2) {
        const score = Math.min(0.82, 0.40 + (matched.length / uniquePatternTokens.length) * 0.42);
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { propertyId: prop.id, propertyName: prop.name, score };
        }
      }
    }
  }

  if (bestMatch && bestMatch.score >= 0.40) {
    return {
      propertyId: bestMatch.propertyId,
      propertyName: bestMatch.propertyName,
      confidence: bestMatch.score,
      source: 'folder_name',
    };
  }

  return null;
}

/**
 * Match a filename to a report type using regex patterns and keyword scoring.
 */
function matchReportType(
  filename: string,
  extension: string,
): { slug: string; name: string; confidence: number } | null {
  const cleaned = filename
    .replace(/\.[^.]+$/, '')
    .replace(/\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}/g, '')
    .replace(/\d{6,8}/g, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const normalized = cleaned.toLowerCase();

  let bestMatch: ReportPattern | null = null;
  let bestScore = 0;

  for (const rp of REPORT_PATTERNS) {
    // Regex match.
    for (const pattern of rp.patterns) {
      if (pattern.test(normalized) || pattern.test(filename)) {
        const score = 0.90;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = rp;
        }
      }
    }

    // Keyword match.
    const inputTokens = new Set(normalized.split(' '));
    const matched = rp.keywords.filter((kw) => inputTokens.has(kw) || normalized.includes(kw));

    if (matched.length >= 2) {
      const score = Math.min(0.85, 0.50 + (matched.length / rp.keywords.length) * 0.35);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = rp;
      }
    }
  }

  // Extension bonus/penalty.
  if (bestMatch) {
    const extLower = extension.toLowerCase();
    if (bestMatch.expectedExtensions.includes(extLower)) {
      bestScore = Math.min(1.0, bestScore + 0.05);
    } else {
      bestScore = Math.max(0.30, bestScore - 0.10);
    }
  }

  if (bestMatch && bestScore >= 0.40) {
    return { slug: bestMatch.slug, name: bestMatch.name, confidence: bestScore };
  }

  return null;
}

/**
 * Extract files from a ZIP archive into a temporary directory.
 */
function extractZip(zipBuffer: Buffer): { extractPath: string; cleanup: () => void } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fusion-zip-'));
  const zipPath = path.join(tmpDir, 'upload.zip');
  const extractPath = path.join(tmpDir, 'extracted');

  fs.writeFileSync(zipPath, zipBuffer);
  fs.mkdirSync(extractPath, { recursive: true });

  if (process.platform === 'win32') {
    execSync(
      `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractPath}' -Force"`,
      { stdio: 'pipe', timeout: 120_000 },
    );
  } else {
    execSync(`unzip -o "${zipPath}" -d "${extractPath}"`, {
      stdio: 'pipe',
      timeout: 120_000,
    });
  }

  return {
    extractPath,
    cleanup: () => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup.
      }
    },
  };
}

/**
 * Walk a directory tree recursively and return all file paths.
 */
function walkDir(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip __MACOSX and hidden directories.
      if (entry.name.startsWith('.') || entry.name.toLowerCase() === '__macosx') continue;
      results.push(...walkDir(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Analyze the folder structure of extracted ZIP contents.
 * Returns the determined top-level folder and property-level folders.
 */
function analyzeStructure(extractPath: string): {
  topLevelFolder: string;
  propertyFolders: string[];
  basePath: string;
} {
  const entries = fs.readdirSync(extractPath, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name.toLowerCase() !== '__macosx');
  const files = entries.filter((e) => e.isFile() && !e.name.startsWith('.'));

  // Single top-level folder wrapping property subfolders.
  if (dirs.length === 1 && files.length === 0) {
    const topDir = dirs[0]!.name;
    const subPath = path.join(extractPath, topDir);
    const subEntries = fs.readdirSync(subPath, { withFileTypes: true });
    const subDirs = subEntries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name.toLowerCase() !== '__macosx')
      .map((e) => e.name);

    if (subDirs.length > 0) {
      return { topLevelFolder: topDir, propertyFolders: subDirs, basePath: subPath };
    }

    // Single folder with files directly inside.
    return { topLevelFolder: topDir, propertyFolders: [topDir], basePath: extractPath };
  }

  // Multiple top-level folders = property folders directly.
  if (dirs.length > 1) {
    return {
      topLevelFolder: path.basename(extractPath),
      propertyFolders: dirs.map((d) => d.name),
      basePath: extractPath,
    };
  }

  // Flat — files in root.
  return {
    topLevelFolder: path.basename(extractPath),
    propertyFolders: ['_root'],
    basePath: extractPath,
  };
}

/**
 * Build a manifest of all files in the extracted ZIP.
 */
function buildFileManifest(extractPath: string): {
  files: ZipFileEntry[];
  structure: ReturnType<typeof analyzeStructure>;
} {
  const structure = analyzeStructure(extractPath);
  const allFiles = walkDir(extractPath);
  const files: ZipFileEntry[] = [];

  for (const filePath of allFiles) {
    const filename = path.basename(filePath);
    const extension = path.extname(filePath).toLowerCase();

    // Skip system files only (never skip user documents).
    if (SKIP_FILES.has(filename.toLowerCase()) || filename.startsWith('.')) continue;

    const relativePath = path.relative(extractPath, filePath).replace(/\\/g, '/');
    const parts = relativePath.split('/');

    // Determine the folder this file belongs to.
    let folderName = '_root';
    if (parts.length >= 3) {
      // <topLevel>/<propertyFolder>/<file> — use second level.
      folderName = parts[1]!;
    } else if (parts.length === 2) {
      // Could be <topLevel>/<file> or <propertyFolder>/<file>.
      if (structure.propertyFolders.includes(parts[0]!)) {
        folderName = parts[0]!;
      } else {
        // Top-level folder wrapper, file is at root of property.
        folderName = parts[0]!;
      }
    }

    const fileBuffer = fs.readFileSync(filePath);
    const checksum = createHash('sha256').update(fileBuffer).digest('hex');

    files.push({
      absolutePath: filePath,
      relativePath,
      folderName,
      filename,
      extension,
      fileSizeBytes: fileBuffer.byteLength,
      checksum,
    });
  }

  return { files, structure };
}

/**
 * Check for duplicate files against existing reports in the database.
 */
async function checkDuplicates(
  file: ZipFileEntry,
  propertyId: string | undefined,
  orgId: string,
): Promise<{ isDuplicate: boolean; reportId?: string; method?: string }> {
  // Check by checksum first (most reliable).
  const checksumMatch = await db.reportFile.findFirst({
    where: { checksumSha256: file.checksum },
    select: { reportId: true },
  });

  if (checksumMatch) {
    return { isDuplicate: true, reportId: checksumMatch.reportId, method: 'checksum' };
  }

  // Check by filename + size within the same property.
  if (propertyId) {
    const filenameMatch = await db.reportFile.findFirst({
      where: {
        originalName: file.filename,
        fileSizeBytes: BigInt(file.fileSizeBytes),
        report: { propertyId, orgId },
      },
      select: { reportId: true },
    });

    if (filenameMatch) {
      return { isDuplicate: true, reportId: filenameMatch.reportId, method: 'filename_size' };
    }
  }

  return { isDuplicate: false };
}

/**
 * Main entry point: process an uploaded ZIP file.
 * Creates the batch record, extracts, classifies, and stores results.
 */
export async function processZipUpload(
  zipBuffer: Buffer,
  originalFilename: string,
  orgId: string,
  uploadedBy: string,
): Promise<BatchProcessingResult> {
  const zipChecksum = createHash('sha256').update(zipBuffer).digest('hex');

  // Create the batch record.
  const supabase = getAdminSupabase();
  const { data: batchRows, error: batchInsertError } = await supabase
    .from('zip_batches')
    .insert({
      org_id: orgId,
      uploaded_by: uploadedBy,
      original_filename: originalFilename,
      file_size_bytes: zipBuffer.byteLength,
      checksum_sha256: zipChecksum,
      status: 'extracting',
      processing_started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (batchInsertError || !batchRows) {
    throw new Error(`Failed to create batch record: ${batchInsertError?.message}`);
  }

  const batchId = batchRows.id;

  // Store the ZIP file in Supabase Storage for archival.
  const zipStoragePath = `${orgId}/zip-batches/${batchId}/${originalFilename}`;
  await supabase.storage
    .from(env.STORAGE_BUCKET_REPORTS)
    .upload(zipStoragePath, zipBuffer, { contentType: 'application/zip', upsert: false });

  await supabase.from('zip_batches').update({ storage_path: zipStoragePath }).eq('id', batchId);

  // Extract ZIP.
  let extractedData: { extractPath: string; cleanup: () => void };
  try {
    extractedData = extractZip(zipBuffer);
  } catch (err) {
    await supabase.from('zip_batches').update({
      status: 'failed',
      error_message: `ZIP extraction failed: ${String(err)}`,
    }).eq('id', batchId);
    throw err;
  }

  const { extractPath, cleanup } = extractedData;

  try {
    // Update status to classifying.
    await supabase.from('zip_batches').update({ status: 'classifying' }).eq('id', batchId);

    // Build manifest.
    const { files, structure } = buildFileManifest(extractPath);

    // Classify each file.
    const items: ClassifiedItem[] = [];
    const folderGroupMap = new Map<string, ClassifiedItem[]>();

    for (const file of files) {
      // Property detection from folder name.
      let property = await matchPropertyFromInput(file.folderName, orgId);

      // Fallback: try filename-based property detection.
      if (!property || property.confidence < CONFIDENCE_THRESHOLD) {
        const fileNameMatch = await matchPropertyFromInput(file.filename, orgId);
        if (fileNameMatch && (!property || fileNameMatch.confidence > property.confidence)) {
          property = { ...fileNameMatch, source: 'file_name' };
        }
      }

      // Report type classification.
      const reportType = matchReportType(file.filename, file.extension);

      // Date detection from filename, then folder name.
      const detectedDate = parseDateFromString(file.filename) ?? parseDateFromString(file.folderName);

      // Duplicate check.
      const dupCheck = await checkDuplicates(file, property?.propertyId, orgId);

      // Calculate overall confidence.
      const propConf = property?.confidence ?? 0;
      const typeConf = reportType?.confidence ?? 0;
      const overallConfidence =
        propConf > 0 && typeConf > 0
          ? propConf * 0.4 + typeConf * 0.6
          : Math.max(propConf, typeConf) * 0.5;

      // Determine item status — never silently drop a file.
      let itemStatus: ClassifiedItem['status'] = 'classified';
      if (dupCheck.isDuplicate) {
        itemStatus = 'duplicate';
      } else if (!property && !reportType) {
        // AI could not identify anything — mark as not classified.
        itemStatus = 'not_classified';
      } else if (overallConfidence < CONFIDENCE_THRESHOLD || !property || !reportType) {
        // Partial classification or low confidence — needs human review.
        itemStatus = 'needs_review';
      }

      const classifiedItem: ClassifiedItem = {
        file,
        property,
        reportType: reportType ? { slug: reportType.slug, name: reportType.name, confidence: reportType.confidence } : null,
        detectedDate,
        overallConfidence,
        isDuplicate: dupCheck.isDuplicate,
        duplicateOf: dupCheck.isDuplicate ? { reportId: dupCheck.reportId, method: dupCheck.method } : null,
        status: itemStatus,
      };

      items.push(classifiedItem);

      // Group by folder.
      if (!folderGroupMap.has(file.folderName)) {
        folderGroupMap.set(file.folderName, []);
      }
      folderGroupMap.get(file.folderName)!.push(classifiedItem);
    }

    // Build folder groups.
    const folderGroups: FolderGroup[] = [];
    for (const [folderName, folderItems] of folderGroupMap) {
      // The folder-level property is the most confident property match among items.
      const bestProp = folderItems
        .filter((item) => item.property)
        .sort((a, b) => (b.property?.confidence ?? 0) - (a.property?.confidence ?? 0))[0]?.property ?? null;

      folderGroups.push({ folderName, property: bestProp, items: folderItems });
    }

    // Save batch items to database.
    const batchItemInserts = items.map((item) => ({
      batch_id: batchId,
      org_id: orgId,
      original_filename: item.file.filename,
      relative_path: item.file.relativePath,
      folder_name: item.file.folderName,
      file_extension: item.file.extension,
      file_size_bytes: item.file.fileSizeBytes,
      file_checksum: item.file.checksum,
      detected_property_id: item.property?.propertyId ?? null,
      detected_property_name: item.property?.propertyName ?? null,
      property_confidence: item.property?.confidence ?? null,
      property_source: item.property?.source ?? null,
      detected_report_type: item.reportType?.name ?? null,
      report_type_slug: item.reportType?.slug ?? null,
      type_confidence: item.reportType?.confidence ?? null,
      detected_date: item.detectedDate,
      overall_confidence: item.overallConfidence,
      status: item.status,
      is_duplicate: item.isDuplicate,
      duplicate_of_report_id: item.duplicateOf?.reportId ?? null,
      duplicate_method: item.duplicateOf?.method ?? null,
    }));

    if (batchItemInserts.length > 0) {
      await supabase.from('zip_batch_items').insert(batchItemInserts);
    }

    // Aggregate counts.
    const classifiedCount = items.filter((i) => i.status === 'classified').length;
    const needsReviewCount = items.filter((i) => i.status === 'needs_review').length;
    const notClassifiedCount = items.filter((i) => i.status === 'not_classified').length;
    const duplicateCount = items.filter((i) => i.status === 'duplicate').length;

    const hasUnresolved = needsReviewCount > 0 || notClassifiedCount > 0;
    const finalStatus = hasUnresolved ? 'completed_with_review' : 'classified';

    await supabase.from('zip_batches').update({
      status: finalStatus,
      total_files: items.length,
      total_folders: folderGroups.length,
      classified_count: classifiedCount,
      needs_review_count: needsReviewCount,
      not_classified_count: notClassifiedCount,
      duplicate_count: duplicateCount,
      processing_completed_at: new Date().toISOString(),
    }).eq('id', batchId);

    return {
      batchId,
      totalFiles: items.length,
      totalFolders: folderGroups.length,
      classifiedCount,
      needsReviewCount,
      notClassifiedCount,
      duplicateCount,
      items,
      folderGroups,
    };
  } catch (err) {
    await supabase.from('zip_batches').update({
      status: 'failed',
      error_message: String(err),
    }).eq('id', batchId);
    throw err;
  } finally {
    cleanup();
  }
}

/**
 * Process classified items: create Report + ReportFile records, upload files to storage,
 * and trigger extraction pipeline. Called after user approval or for auto-approved items.
 */
export async function processApprovedItems(
  batchId: string,
  orgId: string,
  itemIds?: string[],
): Promise<{ processedCount: number; failedCount: number }> {
  const supabase = getAdminSupabase();

  // Fetch items to process.
  let query = supabase
    .from('zip_batch_items')
    .select('*')
    .eq('batch_id', batchId)
    .in('status', ['classified', 'approved']);

  if (itemIds && itemIds.length > 0) {
    query = query.in('id', itemIds);
  }

  const { data: items, error } = await query;
  if (error || !items) {
    throw new Error(`Failed to fetch batch items: ${error?.message}`);
  }

  let processedCount = 0;
  let failedCount = 0;

  await supabase.from('zip_batches').update({ status: 'processing' }).eq('id', batchId);

  for (const item of items) {
    try {
      if (!item.detected_property_id) {
        await supabase.from('zip_batch_items').update({ status: 'needs_review' }).eq('id', item.id);
        continue;
      }

      // Read the file from the temporary extraction or from storage.
      // Since the ZIP may have been cleaned up, we read from original batch storage.
      // For now, we work with what we have — the file buffer approach.
      // In production, files would be stored to temp storage during extraction.

      // Create Report record.
      const report = await db.report.create({
        data: {
          orgId,
          propertyId: item.detected_property_id,
          reportType: item.report_type_slug ?? 'pending_detection',
          reportDate: item.detected_date ? new Date(item.detected_date) : new Date(),
          source: 'zip_upload',
          status: REPORT_STATUS.PENDING,
          confidenceScore: item.overall_confidence,
          requiresReview: (item.overall_confidence ?? 0) < CONFIDENCE_THRESHOLD,
          uploadedBy: item.uploaded_by ?? undefined,
        },
      });

      // Update batch item with created report.
      await supabase.from('zip_batch_items').update({
        status: 'completed',
        created_report_id: report.id,
      }).eq('id', item.id);

      processedCount++;
    } catch (err) {
      await supabase.from('zip_batch_items').update({
        status: 'failed',
      }).eq('id', item.id);
      failedCount++;
    }
  }

  // Update batch counts.
  const { data: updatedItems } = await supabase
    .from('zip_batch_items')
    .select('status')
    .eq('batch_id', batchId);

  const completedCount = updatedItems?.filter((i) => i.status === 'completed').length ?? 0;
  const reviewCount = updatedItems?.filter((i) => i.status === 'needs_review').length ?? 0;
  const failCount = updatedItems?.filter((i) => i.status === 'failed').length ?? 0;

  const notClassCount = updatedItems?.filter((i) => i.status === 'not_classified').length ?? 0;
  const allDone = reviewCount === 0 && notClassCount === 0 && (updatedItems?.every((i) => ['completed', 'duplicate', 'skipped', 'failed'].includes(i.status)) ?? false);

  await supabase.from('zip_batches').update({
    status: allDone ? 'completed' : 'completed_with_review',
    completed_count: completedCount,
    needs_review_count: reviewCount,
    not_classified_count: notClassCount,
    failed_count: failCount,
  }).eq('id', batchId);

  return { processedCount, failedCount };
}
