/**
 * Adapts scan output (output.json) into the shapes that DocumentsPage expects.
 * This bridges our local file scanner data to the Document Library UI.
 */

import type { ScanSummary, FlatResult } from '../components/scanner/types';

let cachedScan: ScanSummary | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10_000;

export async function loadScanData(): Promise<ScanSummary | null> {
  if (cachedScan && Date.now() - cacheTimestamp < CACHE_TTL) return cachedScan;
  try {
    const res = await fetch('/data/output.json?t=' + Date.now());
    if (!res.ok) return null;
    cachedScan = await res.json();
    cacheTimestamp = Date.now();
    return cachedScan;
  } catch {
    return null;
  }
}

/** Map report type category to the doc type slugs used in DocumentsPage */
const CATEGORY_TO_DOC_TYPES: Record<string, string> = {
  'Manager Flash': 'manager_flash',
  'Daily Statistical Recap': 'daily_report',
  'Daily Closing Report': 'daily_report',
  'Grata DSR': 'daily_report',
  'Occupancy Forecast': 'occupancy_forecast',
  'Downtime Report': 'downtime_report',
  'OOO Rooms': 'out_of_order',
  'OOO By Reason': 'out_of_order',
  'Reservation Report': 'reservation_report',
  'Reservations by Operator': 'reservation_report',
  'Revenue Summary': 'revenue_summary',
  'Revenue Flash': 'financial_payment_revenue',
  'Revenue Report': 'financial_payment_revenue',
  'Daily Revenue Report': 'financial_payment_revenue',
  'Revenue Activity': 'financial_payment_revenue',
  'Financial Revenue': 'financial_payment_revenue',
  'Rate Report': 'str_report',
  'Aging Report': 'ar_aging',
  'Aging By Type': 'ar_aging',
  'Direct Bill Aging': 'ar_aging',
  'Guest Ledger': 'guest_ledger',
  'Trial Balance': 'trial_balance',
  'Cash Out': 'cash_out',
  'Daily Cash Out': 'cash_out',
  'Credit Card Transactions': 'credit_card_transactions',
  'Credit Card Rebate': 'credit_card_transactions',
  'Credit Card Activity': 'credit_card_transactions',
  'Adjustments / Voids': 'operator_adjustments_voids',
  'Operator Transactions': 'operator_adjustments_voids',
};

function toDocType(reportType: string | null): string {
  if (!reportType) return 'pending_detection';
  return CATEGORY_TO_DOC_TYPES[reportType] ?? 'other';
}

function toStatus(confidence: number): string {
  if (confidence >= 0.85) return 'classified';
  if (confidence >= 0.6) return 'needs_review';
  return 'not_classified';
}

/** Build properties list from scan data */
export function buildProperties(scan: ScanSummary) {
  const propMap = new Map<string, { id: string; name: string; brand: string | null; count: number }>();

  for (const r of scan.results) {
    if (!r.property) continue;
    const code = r.property.split(' - ')[0] ?? r.property;
    const name = r.property.split(' - ').slice(1).join(' - ') || r.property;
    if (!propMap.has(code)) {
      propMap.set(code, { id: code, name, brand: null, count: 0 });
    }
    propMap.get(code)!.count++;
  }

  return [...propMap.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      _count: { reports: p.count },
    }));
}

/** Build document list from scan data, with filtering */
export function buildDocuments(
  scan: ScanSummary,
  filters: { propertyId?: string; reportType?: string; status?: string; q?: string },
  limit = 60,
) {
  let results = scan.results;

  if (filters.propertyId) {
    results = results.filter((r) => r.property?.startsWith(filters.propertyId + ' '));
  }
  if (filters.reportType) {
    results = results.filter((r) => toDocType(r.reportType) === filters.reportType);
  }
  if (filters.status) {
    results = results.filter((r) => toStatus(r.confidence) === filters.status);
  }
  if (filters.q) {
    const q = filters.q.toLowerCase();
    results = results.filter((r) =>
      r.fileName.toLowerCase().includes(q) ||
      r.displayName.toLowerCase().includes(q) ||
      (r.property?.toLowerCase().includes(q) ?? false) ||
      (r.reportType?.toLowerCase().includes(q) ?? false)
    );
  }

  const docs = results.slice(0, limit).map((r, i) => scanResultToDocument(r, i));

  return {
    data: docs,
    total: results.length,
    page: 1,
    limit,
    totalPages: Math.ceil(results.length / limit),
  };
}

/** Convert a single FlatResult to the Document shape that DocumentsPage expects */
function scanResultToDocument(r: FlatResult, index: number) {
  const propCode = r.property?.split(' - ')[0] ?? '';
  const propName = r.property?.split(' - ').slice(1).join(' - ') ?? 'Unknown';

  return {
    id: `scan-${index}-${r.relativePath.replace(/[^a-z0-9]/gi, '-')}`,
    reportType: toDocType(r.reportType),
    reportDate: r.dateFolder || new Date().toISOString().split('T')[0]!,
    status: toStatus(r.confidence),
    confidenceScore: r.confidence.toString(),
    requiresReview: r.confidence < 0.85,
    source: 'local_scan',
    propertyId: propCode,
    property: { name: propName, brand: null },
    files: [{
      originalName: r.fileName,
      mimeType: r.extension === '.pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileSizeBytes: r.fileSizeBytes,
    }],
    _count: { alerts: 0 },
    extractedData: r.kpis ? {
      occupancyPct: r.kpis.occupancyPct ?? null,
      adr: r.kpis.adr ?? null,
      revpar: r.kpis.revpar ?? null,
      totalRevenue: r.kpis.totalRevenue ?? null,
      roomRevenue: r.kpis.roomRevenue ?? null,
      fbRevenue: null,
      cashVariance: null,
      cashSales: null,
      cashDeposits: null,
      arTotal: r.kpis.arTotal ?? null,
      ar90PlusDays: r.kpis.ar90Plus ?? null,
      voidsTotal: null,
      adjustmentsTotal: null,
      confidenceNote: r.contentPreview ? null : 'Data extracted from filename only',
    } : null,
    uploadedAt: scan?.scannedAt ?? new Date().toISOString(),
    uploadedBy: 'Scanner',
    reviewedAt: null,
    reviewedBy: null,
    hasFlag: r.confidence < 0.6,
    batchId: null,
    batchFolderName: r.propertyFolder !== '(standalone)' ? r.propertyFolder : null,
    uploadSource: 'scan',
  };
}

// Keep a ref so scanResultToDocument can access scan
let scan: ScanSummary | null = null;

export async function getProperties() {
  scan = await loadScanData();
  if (!scan) return [];
  return buildProperties(scan);
}

export async function getDocuments(params: URLSearchParams) {
  scan = await loadScanData();
  if (!scan) return { data: [], total: 0, page: 1, limit: 60, totalPages: 0 };
  const filters: { propertyId?: string; reportType?: string; status?: string; q?: string } = {};
  const pid = params.get('propertyId');
  if (pid) filters.propertyId = pid;
  const rt = params.get('reportType');
  if (rt) filters.reportType = rt;
  const st = params.get('status');
  if (st) filters.status = st;
  const q = params.get('q');
  if (q) filters.q = q;
  return buildDocuments(scan, filters, parseInt(params.get('limit') ?? '60', 10));
}
