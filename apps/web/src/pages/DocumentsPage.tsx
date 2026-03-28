/**
 * Document Library — 3-panel attachment browser for hotel portfolio documents.
 * Left: property + category filters. Middle: searchable file list. Right: detail panel.
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import { clsx } from 'clsx';
import {
  MagnifyingGlassIcon,
  XMarkIcon,
  DocumentTextIcon,
  ArrowDownTrayIcon,
  CheckCircleIcon,
  XCircleIcon,
  CloudArrowUpIcon,
  ExclamationTriangleIcon,
  FunnelIcon,
} from '@heroicons/react/24/outline';
import { api } from '../lib/api-client';
import { fmtCurrency, fmtPct, fmtDate, fmtRelative } from '../lib/formatters';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DocFile {
  originalName: string;
  mimeType: string;
  fileSizeBytes: number | string;
}

interface ExtractedData {
  occupancyPct?: number | null;
  adr?: number | null;
  revpar?: number | null;
  totalRevenue?: number | null;
  roomRevenue?: number | null;
  fbRevenue?: number | null;
  otherRevenue?: number | null;
  cashVariance?: number | null;
  cashSales?: number | null;
  cashDeposits?: number | null;
  arTotal?: number | null;
  ar90PlusDays?: number | null;
  voidsTotal?: number | null;
  adjustmentsTotal?: number | null;
  confidenceNote?: string | null;
}

interface Document {
  id: string;
  reportType: string;
  reportDate: string;
  status: string;
  confidenceScore: string | null;
  requiresReview: boolean;
  source: string;
  propertyId?: string;
  property: { name: string; brand: string | null };
  files: DocFile[];
  _count: { alerts: number };
  extractedData?: ExtractedData | null;
  uploadedAt?: string;
  uploadedBy?: string;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  hasFlag?: boolean;
  batchId?: string | null;
  batchFolderName?: string | null;
  uploadSource?: string | null;
  // Prisma nested shape (real API returns these instead of top-level fields)
  dailyMetrics?: Array<Record<string, unknown>>;
  financialMetrics?: Array<Record<string, unknown>>;
}

interface DocsResponse {
  data: Document[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface PropertiesResponse {
  data: Array<{ id: string; name: string; brand: string | null; _count: { reports: number } }>;
}

interface SingleDocResponse {
  data: Document;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DOC_TYPE_LABELS: Record<string, string> = {
  manager_flash:            'Manager Flash',
  daily_report:             'Daily Report',
  ar_aging:                 'AR Aging',
  revenue_summary:          'Revenue Summary',
  trial_balance:            'Trial Balance',
  cash_out:                 'Cash Out',
  credit_card_transactions: 'Credit Card Trans.',
  occupancy_forecast:       'Occupancy Forecast',
  str_report:               'STR Report',
  p_l:                      'P&L',
  financial_payment_revenue:'Financial / Revenue',
  guest_ledger:             'Guest Ledger',
  downtime_report:          'Downtime Report',
  out_of_order:             'Out of Order',
  reservation_report:       'Reservation Report',
  operator_adjustments_voids:'Adjustments / Voids',
  invoice:                  'Invoice',
  other:                    'Other',
  pending_detection:        'Pending Detection',
};

const DOC_CATEGORY_GROUPS = [
  { label: 'Operations', types: ['manager_flash', 'daily_report', 'occupancy_forecast', 'downtime_report', 'out_of_order', 'reservation_report'] },
  { label: 'Revenue', types: ['revenue_summary', 'str_report', 'financial_payment_revenue'] },
  { label: 'Accounting', types: ['ar_aging', 'guest_ledger', 'trial_balance', 'p_l', 'cash_out', 'credit_card_transactions', 'operator_adjustments_voids'] },
  { label: 'Other', types: ['invoice', 'other', 'pending_detection'] },
];

const STATUS_COLORS: Record<string, string> = {
  pending:          'text-gray-500 bg-gray-50',
  processing:       'text-blue-600 bg-blue-50',
  extracted:        'text-green-600 bg-green-50',
  classified:       'text-green-600 bg-green-50',
  review_required:  'text-orange-600 bg-orange-50',
  needs_review:     'text-warning-600 bg-warning-50',
  not_classified:   'text-purple-600 bg-purple-50',
  approved:         'text-success-600 bg-success-50',
  failed:           'text-danger-600 bg-danger-50',
  duplicate:        'text-neutral-400 bg-neutral-50',
};

const ALLOWED_MIME = [
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
];

const ZIP_MIME = [
  'application/zip',
  'application/x-zip-compressed',
  'application/x-zip',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtFileSize(bytes: number | string): string {
  const n = Number(bytes);
  if (!n || isNaN(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function confidenceColor(score: string | null): string {
  if (!score) return 'text-gray-400';
  const n = Number(score) * 100;
  if (n >= 85) return 'text-success-600';
  if (n >= 70) return 'text-warning-600';
  return 'text-danger-600';
}

// ─── Left Panel ───────────────────────────────────────────────────────────────

interface PropertyListProps {
  properties: PropertiesResponse['data'];
  selectedPropertyId: string;
  onSelectProperty: (id: string) => void;
  selectedType: string;
  onSelectType: (type: string) => void;
}

function PropertyList({ properties, selectedPropertyId, onSelectProperty, selectedType, onSelectType }: PropertyListProps) {
  return (
    <div className="py-3">
      <p className="px-4 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-1">Properties</p>

      <button
        onClick={() => onSelectProperty('')}
        className={clsx(
          'w-full flex items-center gap-2 px-4 py-1.5 text-sm transition-colors',
          selectedPropertyId === ''
            ? 'bg-brand-50 text-brand-700 font-medium'
            : 'text-neutral-600 hover:bg-neutral-50',
        )}
      >
        <span className="flex-1 text-left">All Properties</span>
        <span className="text-xs text-neutral-400">{properties.reduce((s, p) => s + (p._count.reports ?? 0), 0)}</span>
      </button>

      {properties.map((p) => (
        <button
          key={p.id}
          onClick={() => onSelectProperty(p.id)}
          className={clsx(
            'w-full flex items-center gap-2 px-4 py-1.5 text-sm transition-colors',
            selectedPropertyId === p.id
              ? 'bg-brand-50 text-brand-700 font-medium'
              : 'text-neutral-600 hover:bg-neutral-50',
          )}
        >
          <span className="flex-1 text-left truncate">{p.name}</span>
          {p._count.reports > 0 && (
            <span className="text-xs text-neutral-400">{p._count.reports}</span>
          )}
        </button>
      ))}

      <div className="mt-4 mb-1 border-t border-neutral-100 pt-3">
        <p className="px-4 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-1">Categories</p>
      </div>

      <button
        onClick={() => onSelectType('')}
        className={clsx(
          'w-full flex items-center px-4 py-1.5 text-sm transition-colors',
          selectedType === ''
            ? 'bg-brand-50 text-brand-700 font-medium'
            : 'text-neutral-600 hover:bg-neutral-50',
        )}
      >
        All Documents
      </button>

      {DOC_CATEGORY_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="px-4 pt-2.5 pb-0.5 text-[10px] font-semibold text-neutral-300 uppercase tracking-widest">
            {group.label}
          </p>
          {group.types.map((type) => (
            <button
              key={type}
              onClick={() => onSelectType(type)}
              className={clsx(
                'w-full flex items-center px-4 py-1 text-sm transition-colors',
                selectedType === type
                  ? 'bg-brand-50 text-brand-700 font-medium'
                  : 'text-neutral-500 hover:bg-neutral-50',
              )}
            >
              {DOC_TYPE_LABELS[type] ?? type}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

interface DetailPanelProps {
  doc: Document;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  onDownload: () => void;
  onReclassify: (type: string) => void;
  isActing: boolean;
}

function DetailPanel({ doc, onClose, onApprove, onReject, onDownload, onReclassify, isActing }: DetailPanelProps) {
  const [reclassifyOpen, setReclassifyOpen] = useState(false);
  const [reclassifyType, setReclassifyType] = useState('');
  const file = doc.files[0];
  const isPdf = file?.mimeType === 'application/pdf';

  // Merge extractedData from Prisma nested shape (real API) or top-level (mock)
  const extracted: ExtractedData | null = (() => {
    if (doc.extractedData) return doc.extractedData;
    const dm = doc.dailyMetrics?.[0] as Record<string, unknown> | undefined;
    const fm = doc.financialMetrics?.[0] as Record<string, unknown> | undefined;
    if (!dm && !fm) return null;
    return {
      occupancyPct: dm?.['occupancyPct'] as number | null,
      adr: dm?.['adr'] as number | null,
      revpar: dm?.['revpar'] as number | null,
      totalRevenue: dm?.['totalRevenue'] as number | null,
      roomRevenue: dm?.['roomRevenue'] as number | null,
      fbRevenue: dm?.['fbRevenue'] as number | null,
      arTotal: fm?.['arTotal'] as number | null,
      ar90PlusDays: fm?.['ar90PlusDays'] as number | null,
      cashVariance: fm?.['cashVariance'] as number | null,
      voidsTotal: fm?.['voidsTotal'] as number | null,
    };
  })();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start gap-2 px-4 py-3 border-b border-neutral-200 shrink-0">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {file?.originalName ?? 'Document'}
          </p>
          <p className="text-xs text-neutral-400 mt-0.5">{DOC_TYPE_LABELS[doc.reportType] ?? doc.reportType}</p>
        </div>
        <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 mt-0.5 shrink-0">
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Preview */}
        <div className="mx-4 mt-4 h-44 bg-neutral-50 rounded-lg border border-neutral-200 flex items-center justify-center">
          {isPdf ? (
            <div className="text-center text-neutral-400 px-4">
              <DocumentTextIcon className="w-10 h-10 mx-auto mb-1.5" />
              <p className="text-xs font-medium text-neutral-500">PDF Document</p>
              <p className="text-xs mt-0.5">Use Download to open</p>
            </div>
          ) : (
            <div className="text-center text-neutral-400 px-4">
              <DocumentTextIcon className="w-10 h-10 mx-auto mb-1.5" />
              <p className="text-xs font-medium text-neutral-500 truncate max-w-[200px]">{file?.originalName}</p>
              <p className="text-xs mt-0.5">{fmtFileSize(file?.fileSizeBytes ?? 0)}</p>
            </div>
          )}
        </div>

        {/* Status + confidence strip */}
        <div className="mx-4 mt-3 flex items-center gap-2">
          <span className={clsx('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize', STATUS_COLORS[doc.status] ?? 'text-gray-500 bg-gray-50')}>
            {doc.status.replace(/_/g, ' ')}
          </span>
          {doc.confidenceScore && (
            <span className={clsx('text-xs font-medium tabular-nums', confidenceColor(doc.confidenceScore))}>
              {(Number(doc.confidenceScore) * 100).toFixed(0)}% confidence
            </span>
          )}
          {doc._count.alerts > 0 && (
            <span className="flex items-center gap-1 text-xs text-danger-600">
              <ExclamationTriangleIcon className="w-3.5 h-3.5" />
              {doc._count.alerts} alert{doc._count.alerts > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Metadata */}
        <div className="card mx-4 mt-3 p-3">
          <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-2">Details</p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-neutral-400">Property</dt>
            <dd className="text-neutral-800 font-medium truncate">{doc.property.name}</dd>

            <dt className="text-neutral-400">Brand</dt>
            <dd className="text-neutral-700">{doc.property.brand ?? '—'}</dd>

            <dt className="text-neutral-400">Report date</dt>
            <dd className="tabular-nums text-neutral-700">{fmtDate(doc.reportDate)}</dd>

            <dt className="text-neutral-400">File size</dt>
            <dd className="tabular-nums text-neutral-700">{fmtFileSize(file?.fileSizeBytes ?? 0)}</dd>

            <dt className="text-neutral-400">Source</dt>
            <dd className="text-neutral-700 capitalize">{doc.source.replace(/_/g, ' ')}</dd>

            {doc.batchFolderName && (
              <>
                <dt className="text-neutral-400">Folder</dt>
                <dd className="text-neutral-700 truncate">{doc.batchFolderName}</dd>
              </>
            )}

            {doc.uploadedAt && (
              <>
                <dt className="text-neutral-400">Uploaded</dt>
                <dd className="text-neutral-700">{fmtRelative(doc.uploadedAt)}</dd>
              </>
            )}

            {doc.uploadedBy && (
              <>
                <dt className="text-neutral-400">Uploaded by</dt>
                <dd className="text-neutral-700 truncate">{doc.uploadedBy}</dd>
              </>
            )}

            {doc.reviewedAt && (
              <>
                <dt className="text-neutral-400">Reviewed</dt>
                <dd className="text-neutral-700">{fmtDate(doc.reviewedAt)}</dd>
                <dt className="text-neutral-400">Reviewed by</dt>
                <dd className="text-neutral-700 truncate">{doc.reviewedBy ?? '—'}</dd>
              </>
            )}
          </dl>
        </div>

        {/* Extracted data */}
        {extracted && (
          <div className="card mx-4 mt-3 p-3">
            <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-2">Extracted Data</p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              {extracted.occupancyPct != null && (
                <><dt className="text-neutral-400">Occupancy</dt><dd className="tabular-nums font-medium text-neutral-800">{fmtPct(extracted.occupancyPct)}</dd></>
              )}
              {extracted.adr != null && (
                <><dt className="text-neutral-400">ADR</dt><dd className="tabular-nums font-medium text-neutral-800">{fmtCurrency(extracted.adr, 2)}</dd></>
              )}
              {extracted.revpar != null && (
                <><dt className="text-neutral-400">RevPAR</dt><dd className="tabular-nums font-medium text-neutral-800">{fmtCurrency(extracted.revpar, 2)}</dd></>
              )}
              {extracted.totalRevenue != null && (
                <><dt className="text-neutral-400">Total Revenue</dt><dd className="tabular-nums font-medium text-neutral-800">{fmtCurrency(extracted.totalRevenue)}</dd></>
              )}
              {extracted.roomRevenue != null && (
                <><dt className="text-neutral-400">Room Revenue</dt><dd className="tabular-nums text-neutral-700">{fmtCurrency(extracted.roomRevenue)}</dd></>
              )}
              {extracted.fbRevenue != null && (
                <><dt className="text-neutral-400">F&B Revenue</dt><dd className="tabular-nums text-neutral-700">{fmtCurrency(extracted.fbRevenue)}</dd></>
              )}
              {extracted.arTotal != null && (
                <><dt className="text-neutral-400">Total AR</dt><dd className="tabular-nums font-medium text-neutral-800">{fmtCurrency(extracted.arTotal)}</dd></>
              )}
              {extracted.ar90PlusDays != null && (
                <><dt className="text-neutral-400">AR 90+ Days</dt><dd className="tabular-nums text-danger-600 font-medium">{fmtCurrency(extracted.ar90PlusDays)}</dd></>
              )}
              {extracted.cashSales != null && (
                <><dt className="text-neutral-400">Cash Sales</dt><dd className="tabular-nums text-neutral-700">{fmtCurrency(extracted.cashSales)}</dd></>
              )}
              {extracted.cashDeposits != null && (
                <><dt className="text-neutral-400">Deposits</dt><dd className="tabular-nums text-neutral-700">{fmtCurrency(extracted.cashDeposits)}</dd></>
              )}
              {extracted.cashVariance != null && (
                <><dt className="text-neutral-400">Cash Variance</dt>
                <dd className={clsx('tabular-nums font-medium', Math.abs(Number(extracted.cashVariance)) > 500 ? 'text-danger-600' : 'text-neutral-700')}>
                  {fmtCurrency(extracted.cashVariance)}
                </dd></>
              )}
              {extracted.voidsTotal != null && (
                <><dt className="text-neutral-400">Voids</dt><dd className="tabular-nums text-warning-600 font-medium">{fmtCurrency(extracted.voidsTotal)}</dd></>
              )}
              {extracted.adjustmentsTotal != null && (
                <><dt className="text-neutral-400">Adjustments</dt><dd className="tabular-nums text-neutral-700">{fmtCurrency(extracted.adjustmentsTotal)}</dd></>
              )}
            </dl>
            {extracted.confidenceNote && (
              <div className="mt-2 flex gap-1.5 items-start rounded bg-warning-50 border border-warning-200 px-2 py-1.5">
                <ExclamationTriangleIcon className="w-3.5 h-3.5 text-warning-600 shrink-0 mt-0.5" />
                <p className="text-xs text-warning-600">{extracted.confidenceNote}</p>
              </div>
            )}
          </div>
        )}

        {/* Bottom padding */}
        <div className="h-4" />
      </div>

      {/* Actions — sticky footer */}
      <div className="shrink-0 border-t border-neutral-200 bg-white px-4 py-3 space-y-2">
        <div className="flex gap-2">
          <button
            onClick={onApprove}
            disabled={isActing || doc.status === 'approved'}
            className="btn-primary flex-1 justify-center gap-1.5 text-xs py-1.5"
          >
            <CheckCircleIcon className="w-3.5 h-3.5" />
            Approve
          </button>
          <button
            onClick={onReject}
            disabled={isActing}
            className="btn-secondary flex-1 justify-center gap-1.5 text-xs py-1.5 text-danger-600 border-danger-200 hover:bg-danger-50"
          >
            <XCircleIcon className="w-3.5 h-3.5" />
            Reject
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onDownload}
            className="btn-secondary flex-1 justify-center gap-1.5 text-xs py-1.5"
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" />
            Download
          </button>
          <button
            onClick={() => setReclassifyOpen((o) => !o)}
            className="btn-secondary flex-1 justify-center text-xs py-1.5"
          >
            Reclassify
          </button>
        </div>

        {reclassifyOpen && (
          <div className="flex gap-2 pt-1">
            <select
              value={reclassifyType}
              onChange={(e) => setReclassifyType(e.target.value)}
              className="flex-1 text-xs border border-neutral-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Pick type…</option>
              {Object.entries(DOC_TYPE_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
            <button
              disabled={!reclassifyType || isActing}
              onClick={() => { onReclassify(reclassifyType); setReclassifyOpen(false); setReclassifyType(''); }}
              className="btn-primary text-xs py-1.5 px-3 disabled:opacity-40"
            >
              Apply
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Batch Preview Types ─────────────────────────────────────────────────────

interface BatchFolderGroup {
  folderName: string;
  property: { propertyId: string; propertyName: string; confidence: number; source: string } | null;
  itemCount: number;
  items: BatchItem[];
}

interface BatchItem {
  filename: string;
  extension: string;
  fileSizeBytes: number;
  folderName: string;
  property: { propertyId: string; propertyName: string; confidence: number } | null;
  reportType: { slug: string; name: string; confidence: number } | null;
  detectedDate: string | null;
  overallConfidence: number;
  isDuplicate: boolean;
  status: string;
}

interface BatchUploadResponse {
  batchId: string;
  totalFiles: number;
  totalFolders: number;
  classifiedCount: number;
  needsReviewCount: number;
  notClassifiedCount: number;
  duplicateCount: number;
  folderGroups: BatchFolderGroup[];
}

// ─── Batch Preview Component ─────────────────────────────────────────────────

function BatchPreview({
  batch,
  onApproveAll,
  onClose,
  isProcessing,
}: {
  batch: BatchUploadResponse;
  onApproveAll: () => void;
  onClose: () => void;
  isProcessing: boolean;
}) {
  return (
    <div className="max-h-[70vh] overflow-y-auto">
      {/* Summary strip */}
      <div className="flex items-center gap-3 mb-4 p-3 bg-neutral-50 rounded-lg">
        <div className="text-center">
          <p className="text-lg font-bold text-neutral-900">{batch.totalFiles}</p>
          <p className="text-[10px] text-neutral-400 uppercase">Files</p>
        </div>
        <div className="w-px h-8 bg-neutral-200" />
        <div className="text-center">
          <p className="text-lg font-bold text-neutral-900">{batch.totalFolders}</p>
          <p className="text-[10px] text-neutral-400 uppercase">Properties</p>
        </div>
        <div className="w-px h-8 bg-neutral-200" />
        <div className="text-center">
          <p className="text-lg font-bold text-success-600">{batch.classifiedCount}</p>
          <p className="text-[10px] text-neutral-400 uppercase">Auto-classified</p>
        </div>
        {batch.needsReviewCount > 0 && (
          <>
            <div className="w-px h-8 bg-neutral-200" />
            <div className="text-center">
              <p className="text-lg font-bold text-warning-600">{batch.needsReviewCount}</p>
              <p className="text-[10px] text-neutral-400 uppercase">Needs Review</p>
            </div>
          </>
        )}
        {batch.notClassifiedCount > 0 && (
          <>
            <div className="w-px h-8 bg-neutral-200" />
            <div className="text-center">
              <p className="text-lg font-bold text-purple-600">{batch.notClassifiedCount}</p>
              <p className="text-[10px] text-neutral-400 uppercase">Not Classified</p>
            </div>
          </>
        )}
        {batch.duplicateCount > 0 && (
          <>
            <div className="w-px h-8 bg-neutral-200" />
            <div className="text-center">
              <p className="text-lg font-bold text-neutral-400">{batch.duplicateCount}</p>
              <p className="text-[10px] text-neutral-400 uppercase">Duplicates</p>
            </div>
          </>
        )}
      </div>

      {/* Folder groups */}
      {batch.folderGroups.map((fg) => (
        <div key={fg.folderName} className="mb-3">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-semibold text-neutral-700 truncate">
              {fg.folderName === '_root' ? 'Root' : fg.folderName}
            </span>
            {fg.property && (
              <span className={clsx(
                'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium',
                fg.property.confidence >= 0.8 ? 'bg-success-50 text-success-700' :
                fg.property.confidence >= 0.6 ? 'bg-warning-50 text-warning-700' :
                'bg-danger-50 text-danger-700',
              )}>
                → {fg.property.propertyName}
                <span className="ml-1 opacity-60">{(fg.property.confidence * 100).toFixed(0)}%</span>
              </span>
            )}
            {!fg.property && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-danger-50 text-danger-600">
                Property unknown
              </span>
            )}
          </div>

          <div className="border border-neutral-100 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-25 border-b border-neutral-100">
                <tr>
                  <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-neutral-400 uppercase">File</th>
                  <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-neutral-400 uppercase">Type</th>
                  <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-neutral-400 uppercase">Date</th>
                  <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-neutral-400 uppercase">Conf.</th>
                  <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-neutral-400 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50">
                {fg.items.map((item, idx) => (
                  <tr key={idx} className={clsx(
                    item.isDuplicate && 'opacity-50',
                    item.status === 'needs_review' && 'bg-warning-50/30',
                  )}>
                    <td className="px-2 py-1.5">
                      <span className="font-medium text-neutral-700 truncate max-w-[180px] block">{item.filename}</span>
                    </td>
                    <td className="px-2 py-1.5 text-neutral-500">
                      {item.reportType?.name ?? <span className="text-danger-500 italic">Unknown</span>}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums text-neutral-500">
                      {item.detectedDate ?? '—'}
                    </td>
                    <td className={clsx(
                      'px-2 py-1.5 tabular-nums font-medium',
                      item.overallConfidence >= 0.8 ? 'text-success-600' :
                      item.overallConfidence >= 0.6 ? 'text-warning-600' :
                      'text-danger-600',
                    )}>
                      {(item.overallConfidence * 100).toFixed(0)}%
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={clsx(
                        'inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium capitalize',
                        item.status === 'classified' && 'bg-success-50 text-success-700',
                        item.status === 'needs_review' && 'bg-warning-50 text-warning-700',
                        item.status === 'not_classified' && 'bg-purple-50 text-purple-700',
                        item.status === 'duplicate' && 'bg-neutral-100 text-neutral-500',
                        item.status === 'failed' && 'bg-danger-50 text-danger-700',
                      )}>
                        {item.status === 'needs_review' ? 'Review' : item.status === 'not_classified' ? 'Not Classified' : item.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* Actions */}
      <div className="flex gap-2 mt-4 pt-3 border-t border-neutral-200">
        <button
          onClick={onApproveAll}
          disabled={isProcessing}
          className="btn-primary flex-1 justify-center gap-1.5 text-xs py-2"
        >
          {isProcessing ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Processing…
            </>
          ) : (
            <>
              <CheckCircleIcon className="w-3.5 h-3.5" />
              Approve & Process All ({batch.classifiedCount + batch.needsReviewCount} files)
            </>
          )}
        </button>
        <button
          onClick={onClose}
          disabled={isProcessing}
          className="btn-secondary text-xs py-2 px-4"
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ─── Upload Drawer ────────────────────────────────────────────────────────────

interface UploadDrawerProps {
  properties: PropertiesResponse['data'];
  onClose: () => void;
  onSuccess: () => void;
}

function UploadDrawer({ properties, onClose, onSuccess }: UploadDrawerProps) {
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [isZipMode, setIsZipMode] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchUploadResponse | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;

      const isZip = file.name.toLowerCase().endsWith('.zip') || ZIP_MIME.includes(file.type);
      setIsZipMode(isZip);

      if (!isZip && !selectedPropertyId) {
        alert('Select a property first.');
        return;
      }

      setUploadStatus('uploading');
      const fd = new FormData();
      fd.append('file', file);

      try {
        if (isZip) {
          // ZIP upload — no property needed.
          const res = await api.upload<{ success: boolean; data: BatchUploadResponse }>(
            '/batches/upload-zip',
            fd,
          );
          setBatchResult(res.data);
          setUploadStatus('success');
        } else {
          // Single file upload — existing flow.
          await api.upload(`/reports/upload?propertyId=${selectedPropertyId}`, fd);
          setUploadStatus('success');
          setTimeout(() => { setUploadStatus('idle'); onSuccess(); }, 2000);
        }
      } catch {
        setUploadStatus('error');
        setTimeout(() => setUploadStatus('idle'), 3000);
      }
    },
    [selectedPropertyId, onSuccess],
  );

  const handleApproveAll = useCallback(async () => {
    if (!batchResult) return;
    setIsProcessing(true);
    try {
      await api.post(`/batches/${batchResult.batchId}/approve-all`);
      setTimeout(() => {
        setIsProcessing(false);
        onSuccess();
      }, 1000);
    } catch {
      setIsProcessing(false);
    }
  }, [batchResult, onSuccess]);

  const allMimeTypes = Object.fromEntries([
    ...ALLOWED_MIME.map((m) => [m, []] as [string, string[]]),
    ...ZIP_MIME.map((m) => [m, ['.zip']] as [string, string[]]),
  ]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: allMimeTypes,
    maxSize: 500 * 1024 * 1024, // 500 MB for ZIPs
    multiple: false,
  });

  // Show batch preview after successful ZIP upload.
  const showBatchPreview = isZipMode && uploadStatus === 'success' && batchResult;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
      <div className={clsx(
        'bg-white rounded-lg shadow-card-md p-6 max-h-[90vh] overflow-hidden flex flex-col',
        showBatchPreview ? 'w-[720px]' : 'w-[420px]',
      )}>
        <div className="flex items-center justify-between mb-4 shrink-0">
          <h3 className="text-sm font-semibold text-neutral-900">
            {showBatchPreview ? 'ZIP Upload — Batch Preview' : 'Upload Document'}
          </h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600">
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        {showBatchPreview ? (
          <BatchPreview
            batch={batchResult}
            onApproveAll={handleApproveAll}
            onClose={onClose}
            isProcessing={isProcessing}
          />
        ) : (
          <>
            {/* Property selector — hidden when a ZIP is detected */}
            {!isZipMode && (
              <div className="mb-4">
                <label className="block text-xs font-medium text-neutral-600 mb-1">Property</label>
                <select
                  value={selectedPropertyId}
                  onChange={(e) => setSelectedPropertyId(e.target.value)}
                  className="w-full text-sm border border-neutral-200 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">Select property…</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div
              {...getRootProps()}
              className={clsx(
                'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
                isDragActive ? 'border-brand-400 bg-brand-50' : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50',
                uploadStatus === 'uploading' && 'opacity-60 pointer-events-none',
              )}
            >
              <input {...getInputProps()} />
              {uploadStatus === 'uploading' && (
                <div className="flex flex-col items-center gap-2 text-neutral-400">
                  <div className="w-6 h-6 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs font-medium">
                    {isZipMode ? 'Processing ZIP — detecting properties & classifying documents…' : 'Uploading…'}
                  </p>
                  {isZipMode && (
                    <p className="text-[10px] text-neutral-300">This may take a moment for large archives</p>
                  )}
                </div>
              )}
              {uploadStatus === 'success' && !isZipMode && (
                <div className="flex flex-col items-center gap-2 text-success-600">
                  <CheckCircleIcon className="w-8 h-8" />
                  <p className="text-xs font-medium">Uploaded — processing in background</p>
                </div>
              )}
              {uploadStatus === 'error' && (
                <div className="flex flex-col items-center gap-2 text-danger-500">
                  <XCircleIcon className="w-8 h-8" />
                  <p className="text-xs font-medium">Upload failed. Try again.</p>
                </div>
              )}
              {uploadStatus === 'idle' && (
                <div className="flex flex-col items-center gap-2 text-neutral-400">
                  <CloudArrowUpIcon className="w-8 h-8" />
                  <p className="text-xs font-medium text-neutral-600">Drop file here, or click to browse</p>
                  <p className="text-xs">PDF, Excel, CSV · Max 50 MB</p>
                  <div className="mt-2 pt-2 border-t border-neutral-100">
                    <p className="text-xs font-medium text-brand-600">ZIP files supported</p>
                    <p className="text-[10px] text-neutral-400">
                      Properties auto-detected from folder structure · Max 500 MB
                    </p>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function DocumentsPage() {
  const qc = useQueryClient();

  // Filter state
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // UI state
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  // Properties list
  const { data: properties } = useQuery<PropertiesResponse>({
    queryKey: ['properties'],
    queryFn: () => api.get('/properties'),
  });

  // Document search
  const { data: docs, isLoading } = useQuery<DocsResponse>({
    queryKey: ['documents', selectedPropertyId, selectedType, filterStatus, search],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '60' });
      if (selectedPropertyId) params.set('propertyId', selectedPropertyId);
      if (selectedType)       params.set('reportType', selectedType);
      if (filterStatus)       params.set('status', filterStatus);
      if (search)             params.set('q', search);
      return api.get(`/reports/search?${params}`);
    },
    refetchInterval: 30_000,
  });

  // Selected doc full detail
  const { data: docDetail } = useQuery<SingleDocResponse>({
    queryKey: ['document', selectedDoc?.id],
    queryFn: () => api.get(`/reports/${selectedDoc!.id}`),
    enabled: !!selectedDoc,
  });

  // Use full detail when available, fall back to list row data
  const activeDoc: Document | null = docDetail?.data ?? selectedDoc;

  const reviewMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      api.patch(`/reports/${id}/review`, { action }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      qc.invalidateQueries({ queryKey: ['document', selectedDoc?.id] });
    },
  });

  const reclassifyMutation = useMutation({
    mutationFn: ({ id, reportType }: { id: string; reportType: string }) =>
      api.post(`/reports/${id}/reclassify`, { reportType }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      qc.invalidateQueries({ queryKey: ['document', selectedDoc?.id] });
    },
  });

  async function handleDownload() {
    if (!selectedDoc) return;
    const res = await api.get<{ data: { url: string } }>(`/reports/${selectedDoc.id}/download`);
    if (res.data?.url) window.open(res.data.url, '_blank');
  }

  const propList = properties?.data ?? [];
  const docList  = docs?.data ?? [];
  const total    = docs?.total ?? 0;
  const isActing = reviewMutation.isPending || reclassifyMutation.isPending;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 bg-white shrink-0">
        <div>
          <h1 className="text-base font-semibold text-neutral-900 tracking-tight">Document Library</h1>
          <p className="text-xs text-neutral-400 mt-0.5">{total} document{total !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => setShowUpload(true)} className="btn-primary text-xs py-1.5 px-3 gap-1.5">
          <CloudArrowUpIcon className="w-3.5 h-3.5" />
          Upload
        </button>
      </div>

      {/* 3-panel body */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left panel — properties + categories */}
        <aside className="w-[220px] shrink-0 border-r border-neutral-200 bg-white overflow-y-auto">
          <PropertyList
            properties={propList}
            selectedPropertyId={selectedPropertyId}
            onSelectProperty={(id) => { setSelectedPropertyId(id); setSelectedDoc(null); }}
            selectedType={selectedType}
            onSelectType={(type) => { setSelectedType(type); setSelectedDoc(null); }}
          />
        </aside>

        {/* Middle panel — search + file table */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Search / filter bar */}
          <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-neutral-200 bg-white">
            <div className="relative flex-1 max-w-xs">
              <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Search by filename, property…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-neutral-200 rounded focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <FunnelIcon className="w-3.5 h-3.5 text-neutral-300 shrink-0" />
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="text-sm border border-neutral-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">All statuses</option>
              <option value="not_classified">Not Classified</option>
              <option value="needs_review">Needs Review</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="classified">Classified</option>
              <option value="extracted">Extracted</option>
              <option value="review_required">Review Required</option>
              <option value="approved">Approved</option>
              <option value="failed">Failed</option>
              <option value="duplicate">Duplicate</option>
            </select>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="h-10 bg-neutral-50 rounded animate-pulse" />
                ))}
              </div>
            ) : docList.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-neutral-300 gap-3 px-8">
                <CloudArrowUpIcon className="w-12 h-12 text-neutral-200" />
                <p className="text-sm font-medium text-neutral-500">No documents uploaded yet</p>
                <p className="text-xs text-neutral-400 text-center max-w-xs">
                  {filterStatus || selectedType || search
                    ? 'No documents match your current filters. Try adjusting your search criteria.'
                    : 'Upload reports to begin organizing your document library. ZIP files with folder structures are supported.'}
                </p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-25 border-b border-neutral-100 z-10">
                  <tr>
                    {['Filename', 'Type', 'Property', 'Date', 'Status', 'Conf.', 'Folder / Batch', 'Size', ''].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-left text-[10px] font-semibold text-neutral-400 uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-50">
                  {docList.map((doc) => {
                    const file = doc.files[0];
                    const isSelected = selectedDoc?.id === doc.id;
                    return (
                      <tr
                        key={doc.id}
                        onClick={() => setSelectedDoc(doc)}
                        className={clsx(
                          'cursor-pointer transition-colors',
                          isSelected ? 'bg-brand-50' : 'hover:bg-slate-25',
                        )}
                      >
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            {doc.hasFlag && <ExclamationTriangleIcon className="w-3.5 h-3.5 text-warning-500 shrink-0" />}
                            <span className="font-medium text-neutral-800 truncate max-w-[180px]">
                              {file?.originalName ?? '—'}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className="text-neutral-600 text-xs">{DOC_TYPE_LABELS[doc.reportType] ?? doc.reportType}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-neutral-600 truncate max-w-[140px] block">{doc.property.name}</span>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums whitespace-nowrap text-neutral-500 text-xs">
                          {fmtDate(doc.reportDate)}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={clsx('inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium capitalize whitespace-nowrap', STATUS_COLORS[doc.status] ?? 'text-gray-500 bg-gray-50')}>
                            {doc.status.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className={clsx('px-3 py-2.5 tabular-nums text-xs', confidenceColor(doc.confidenceScore))}>
                          {doc.confidenceScore ? `${(Number(doc.confidenceScore) * 100).toFixed(0)}%` : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-neutral-400 truncate max-w-[120px]">
                          {doc.batchFolderName ?? doc.uploadSource?.replace(/_/g, ' ') ?? '—'}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-xs text-neutral-400 whitespace-nowrap">
                          {fmtFileSize(file?.fileSizeBytes ?? 0)}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-xs text-brand-600 font-medium">View</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right panel — document detail */}
        {activeDoc && (
          <aside className="w-[380px] shrink-0 border-l border-neutral-200 bg-white overflow-hidden flex flex-col">
            <DetailPanel
              doc={activeDoc}
              onClose={() => setSelectedDoc(null)}
              onApprove={() => reviewMutation.mutate({ id: activeDoc.id, action: 'approve' })}
              onReject={() => reviewMutation.mutate({ id: activeDoc.id, action: 'reject' })}
              onDownload={handleDownload}
              onReclassify={(type) => reclassifyMutation.mutate({ id: activeDoc.id, reportType: type })}
              isActing={isActing}
            />
          </aside>
        )}
      </div>

      {/* Upload modal */}
      {showUpload && (
        <UploadDrawer
          properties={propList}
          onClose={() => setShowUpload(false)}
          onSuccess={() => {
            setShowUpload(false);
            qc.invalidateQueries({ queryKey: ['documents'] });
          }}
        />
      )}
    </div>
  );
}
