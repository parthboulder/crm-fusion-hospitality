/**
 * Batch Review Page — review and approve ZIP batch items that need manual attention.
 * Shows batch overview, folder groups, and individual item review controls.
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import {
  CheckCircleIcon,
  XMarkIcon,
  ExclamationTriangleIcon,
  DocumentTextIcon,
  FolderIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { api } from '../lib/api-client';
import { fmtDate, fmtRelative } from '../lib/formatters';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BatchItem {
  id: string;
  batch_id: string;
  original_filename: string;
  relative_path: string;
  folder_name: string;
  file_extension: string;
  file_size_bytes: number;
  detected_property_id: string | null;
  detected_property_name: string | null;
  property_confidence: number | null;
  property_source: string | null;
  detected_report_type: string | null;
  report_type_slug: string | null;
  type_confidence: number | null;
  detected_date: string | null;
  overall_confidence: number | null;
  status: string;
  is_duplicate: boolean;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

interface Batch {
  id: string;
  original_filename: string;
  status: string;
  total_files: number;
  total_folders: number;
  classified_count: number;
  needs_review_count: number;
  not_classified_count: number;
  completed_count: number;
  failed_count: number;
  duplicate_count: number;
  created_at: string;
}

interface BatchDetailResponse {
  data: {
    batch: Batch;
    items: BatchItem[];
    folderGroups: Record<string, BatchItem[]>;
  };
}

interface BatchListResponse {
  data: Batch[];
  total: number;
}

interface PropertyOption {
  id: string;
  name: string;
  brand: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  uploaded:                'text-gray-500 bg-gray-50',
  extracting:              'text-blue-500 bg-blue-50',
  classifying:             'text-blue-600 bg-blue-50',
  classified:              'text-green-600 bg-green-50',
  processing:              'text-blue-600 bg-blue-50',
  completed:               'text-success-600 bg-success-50',
  completed_with_review:   'text-warning-600 bg-warning-50',
  failed:                  'text-danger-600 bg-danger-50',
  needs_review:            'text-warning-600 bg-warning-50',
  not_classified:          'text-purple-600 bg-purple-50',
  approved:                'text-success-600 bg-success-50',
  duplicate:               'text-neutral-400 bg-neutral-50',
  skipped:                 'text-neutral-400 bg-neutral-50',
  pending:                 'text-gray-500 bg-gray-50',
};

const DOC_TYPE_LABELS: Record<string, string> = {
  'revenue-flash':           'Revenue Flash',
  'daily-statistical-recap': 'Daily Statistical Recap',
  'manager-flash':           'Manager Flash',
  'hotel-statistics':        'Hotel Statistics',
  'marriott-manager-stats':  'Marriott Manager Stats',
  'marriott-revenue':        'Marriott Revenue',
  'aging-report':            'Aging Report',
  'credit-card-transactions':'Credit Card Transactions',
  'room-tax-listing':        'Room & Tax Listing',
  'operator-transactions':   'Operator Transactions',
  'daily-transaction-log':   'Daily Transaction Log',
  'ooo-rooms':               'OOO Rooms',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function confidenceBadge(score: number | null): JSX.Element {
  if (score == null) return <span className="text-neutral-300 text-xs">—</span>;
  const pct = (score * 100).toFixed(0);
  const color = score >= 0.8 ? 'text-success-600' : score >= 0.6 ? 'text-warning-600' : 'text-danger-600';
  return <span className={clsx('text-xs tabular-nums font-medium', color)}>{pct}%</span>;
}

function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Item Review Row ──────────────────────────────────────────────────────────

function ItemReviewRow({
  item,
  properties,
  onAction,
  isActing,
}: {
  item: BatchItem;
  properties: PropertyOption[];
  onAction: (itemId: string, action: string, overrides?: Record<string, string>) => void;
  isActing: boolean;
}) {
  const [editMode, setEditMode] = useState(false);
  const [editPropertyId, setEditPropertyId] = useState(item.detected_property_id ?? '');
  const [editReportType, setEditReportType] = useState(item.report_type_slug ?? '');

  const isReviewable = item.status === 'needs_review' || item.status === 'not_classified';

  return (
    <tr className={clsx(
      'transition-colors',
      isReviewable && 'bg-warning-50/20',
      item.is_duplicate && 'opacity-50',
    )}>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          {isReviewable && <ExclamationTriangleIcon className="w-3.5 h-3.5 text-warning-500 shrink-0" />}
          <span className="text-xs font-medium text-neutral-700 truncate max-w-[200px]">{item.original_filename}</span>
        </div>
        <p className="text-[10px] text-neutral-400 mt-0.5">{fmtFileSize(item.file_size_bytes)}</p>
      </td>

      <td className="px-3 py-2">
        {editMode ? (
          <select
            value={editPropertyId}
            onChange={(e) => setEditPropertyId(e.target.value)}
            className="text-xs border border-neutral-200 rounded px-1.5 py-1 w-full"
          >
            <option value="">Select…</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        ) : (
          <div>
            <span className="text-xs text-neutral-700">{item.detected_property_name ?? '—'}</span>
            <div className="mt-0.5">{confidenceBadge(item.property_confidence)}</div>
          </div>
        )}
      </td>

      <td className="px-3 py-2">
        {editMode ? (
          <select
            value={editReportType}
            onChange={(e) => setEditReportType(e.target.value)}
            className="text-xs border border-neutral-200 rounded px-1.5 py-1 w-full"
          >
            <option value="">Select…</option>
            {Object.entries(DOC_TYPE_LABELS).map(([slug, label]) => (
              <option key={slug} value={slug}>{label}</option>
            ))}
          </select>
        ) : (
          <div>
            <span className="text-xs text-neutral-700">
              {item.report_type_slug ? (DOC_TYPE_LABELS[item.report_type_slug] ?? item.detected_report_type) : '—'}
            </span>
            <div className="mt-0.5">{confidenceBadge(item.type_confidence)}</div>
          </div>
        )}
      </td>

      <td className="px-3 py-2 tabular-nums text-xs text-neutral-500">
        {item.detected_date ?? '—'}
      </td>

      <td className="px-3 py-2">
        {confidenceBadge(item.overall_confidence)}
      </td>

      <td className="px-3 py-2">
        <span className={clsx(
          'inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium capitalize',
          STATUS_STYLES[item.status] ?? 'text-gray-500 bg-gray-50',
        )}>
          {item.status.replace(/_/g, ' ')}
        </span>
      </td>

      <td className="px-3 py-2">
        {isReviewable && (
          <div className="flex items-center gap-1">
            {editMode ? (
              <>
                <button
                  disabled={isActing}
                  onClick={() => {
                    const overrides: Record<string, string> = {};
                    if (editPropertyId) {
                      overrides.propertyId = editPropertyId;
                      const prop = properties.find((p) => p.id === editPropertyId);
                      if (prop) overrides.propertyName = prop.name;
                    }
                    if (editReportType) {
                      overrides.reportTypeSlug = editReportType;
                      overrides.reportTypeName = DOC_TYPE_LABELS[editReportType] ?? editReportType;
                    }
                    onAction(item.id, 'update', overrides);
                    setEditMode(false);
                  }}
                  className="text-[10px] font-medium text-success-600 hover:text-success-700 px-1.5 py-0.5 rounded hover:bg-success-50"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditMode(false)}
                  className="text-[10px] text-neutral-400 hover:text-neutral-600 px-1 py-0.5"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  disabled={isActing}
                  onClick={() => onAction(item.id, 'approve')}
                  className="text-[10px] font-medium text-success-600 hover:text-success-700 px-1.5 py-0.5 rounded hover:bg-success-50"
                  title="Approve as-is"
                >
                  Approve
                </button>
                <button
                  onClick={() => setEditMode(true)}
                  className="text-[10px] font-medium text-brand-600 hover:text-brand-700 px-1.5 py-0.5 rounded hover:bg-brand-50"
                  title="Edit classification"
                >
                  Edit
                </button>
                <button
                  disabled={isActing}
                  onClick={() => onAction(item.id, 'skip')}
                  className="text-[10px] text-neutral-400 hover:text-neutral-600 px-1 py-0.5"
                  title="Skip this file"
                >
                  Skip
                </button>
              </>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

// ─── Folder Group ─────────────────────────────────────────────────────────────

function FolderGroupSection({
  folderName,
  items,
  properties,
  onItemAction,
  isActing,
}: {
  folderName: string;
  items: BatchItem[];
  properties: PropertyOption[];
  onItemAction: (itemId: string, action: string, overrides?: Record<string, string>) => void;
  isActing: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const reviewCount = items.filter((i) => i.status === 'needs_review' || i.status === 'not_classified').length;
  const displayName = folderName === '_root' ? 'Root (no folder)' : folderName;
  const folderProperty = items[0]?.detected_property_name;

  return (
    <div className="mb-4">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-neutral-50 rounded-t-lg hover:bg-neutral-100 transition-colors"
      >
        {collapsed ? <ChevronRightIcon className="w-3.5 h-3.5 text-neutral-400" /> : <ChevronDownIcon className="w-3.5 h-3.5 text-neutral-400" />}
        <FolderIcon className="w-4 h-4 text-neutral-400" />
        <span className="text-xs font-semibold text-neutral-700 flex-1 text-left truncate">{displayName}</span>
        {folderProperty && (
          <span className="text-[10px] text-neutral-500">→ {folderProperty}</span>
        )}
        <span className="text-[10px] text-neutral-400">{items.length} files</span>
        {reviewCount > 0 && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-warning-100 text-warning-700">
            {reviewCount} review
          </span>
        )}
      </button>

      {!collapsed && (
        <div className="border border-t-0 border-neutral-200 rounded-b-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-25 border-b border-neutral-100">
              <tr>
                {['File', 'Property', 'Type', 'Date', 'Conf.', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="px-3 py-1.5 text-left text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {items.map((item) => (
                <ItemReviewRow
                  key={item.id}
                  item={item}
                  properties={properties}
                  onAction={onItemAction}
                  isActing={isActing}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Batch Detail View ────────────────────────────────────────────────────────

function BatchDetail({
  batchId,
  onBack,
}: {
  batchId: string;
  onBack: () => void;
}) {
  const qc = useQueryClient();

  const { data: batchData, isLoading } = useQuery<BatchDetailResponse>({
    queryKey: ['batch', batchId],
    queryFn: () => api.get(`/batches/${batchId}`),
    refetchInterval: 10_000,
  });

  const { data: propertiesData } = useQuery<{ data: PropertyOption[] }>({
    queryKey: ['properties'],
    queryFn: () => api.get('/properties'),
  });

  const itemMutation = useMutation({
    mutationFn: ({ itemId, action, overrides }: { itemId: string; action: string; overrides?: Record<string, string> }) =>
      api.patch(`/batches/${batchId}/items/${itemId}`, { action, ...overrides }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['batch', batchId] });
    },
  });

  const approveAllMutation = useMutation({
    mutationFn: () => api.post(`/batches/${batchId}/approve-all`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['batch', batchId] });
      qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });

  const processMutation = useMutation({
    mutationFn: () => api.post(`/batches/${batchId}/process`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['batch', batchId] });
      qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });

  if (isLoading || !batchData) {
    return (
      <div className="p-8 text-center text-neutral-400">
        <ArrowPathIcon className="w-6 h-6 animate-spin mx-auto mb-2" />
        <p className="text-sm">Loading batch…</p>
      </div>
    );
  }

  const { batch, items, folderGroups } = batchData.data;
  const properties = propertiesData?.data ?? [];
  const reviewItems = items.filter((i) => i.status === 'needs_review' || i.status === 'not_classified');
  const isActing = itemMutation.isPending || approveAllMutation.isPending || processMutation.isPending;

  const handleItemAction = useCallback((itemId: string, action: string, overrides?: Record<string, string>) => {
    itemMutation.mutate({ itemId, action, overrides: overrides ?? {} });
  }, [itemMutation]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-neutral-200 bg-white shrink-0">
        <button onClick={onBack} className="text-xs text-brand-600 hover:text-brand-700 font-medium">
          ← All Batches
        </button>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-neutral-900">{batch.original_filename}</h2>
          <p className="text-xs text-neutral-400 mt-0.5">
            Uploaded {fmtRelative(batch.created_at)} · {batch.total_files} files · {batch.total_folders} properties
          </p>
        </div>
        <span className={clsx(
          'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize',
          STATUS_STYLES[batch.status] ?? 'text-gray-500 bg-gray-50',
        )}>
          {batch.status.replace(/_/g, ' ')}
        </span>
      </div>

      {/* Summary bar */}
      <div className="flex items-center gap-4 px-6 py-3 bg-neutral-50 border-b border-neutral-200 shrink-0">
        <div className="text-xs"><span className="font-semibold text-neutral-900">{batch.total_files}</span> <span className="text-neutral-400">total</span></div>
        <div className="text-xs"><span className="font-semibold text-success-600">{batch.classified_count}</span> <span className="text-neutral-400">classified</span></div>
        <div className="text-xs"><span className="font-semibold text-warning-600">{batch.needs_review_count}</span> <span className="text-neutral-400">needs review</span></div>
        {batch.not_classified_count > 0 && (
          <div className="text-xs"><span className="font-semibold text-purple-600">{batch.not_classified_count}</span> <span className="text-neutral-400">not classified</span></div>
        )}
        <div className="text-xs"><span className="font-semibold text-success-600">{batch.completed_count}</span> <span className="text-neutral-400">completed</span></div>
        {batch.duplicate_count > 0 && (
          <div className="text-xs"><span className="font-semibold text-neutral-400">{batch.duplicate_count}</span> <span className="text-neutral-400">duplicates</span></div>
        )}

        <div className="flex-1" />

        {reviewItems.length > 0 && (
          <button
            onClick={() => approveAllMutation.mutate()}
            disabled={isActing}
            className="btn-primary text-xs py-1.5 px-3 gap-1.5"
          >
            <CheckCircleIcon className="w-3.5 h-3.5" />
            Approve All & Process
          </button>
        )}

        {reviewItems.length === 0 && ['classified', 'completed_with_review'].includes(batch.status) && (
          <button
            onClick={() => processMutation.mutate()}
            disabled={isActing}
            className="btn-primary text-xs py-1.5 px-3 gap-1.5"
          >
            <CheckCircleIcon className="w-3.5 h-3.5" />
            Process All
          </button>
        )}
      </div>

      {/* Folder groups */}
      <div className="flex-1 overflow-y-auto p-6">
        {Object.entries(folderGroups).map(([folderName, folderItems]) => (
          <FolderGroupSection
            key={folderName}
            folderName={folderName}
            items={folderItems}
            properties={properties}
            onItemAction={handleItemAction}
            isActing={isActing}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function BatchReviewPage() {
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  const { data: batchList, isLoading } = useQuery<BatchListResponse>({
    queryKey: ['batches'],
    queryFn: () => api.get('/batches'),
    refetchInterval: 15_000,
  });

  if (selectedBatchId) {
    return <BatchDetail batchId={selectedBatchId} onBack={() => setSelectedBatchId(null)} />;
  }

  const batches = batchList?.data ?? [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 bg-white shrink-0">
        <div>
          <h1 className="text-base font-semibold text-neutral-900 tracking-tight">ZIP Batch Review</h1>
          <p className="text-xs text-neutral-400 mt-0.5">{batches.length} batch{batches.length !== 1 ? 'es' : ''}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 bg-neutral-50 rounded animate-pulse" />
            ))}
          </div>
        ) : batches.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-neutral-300 gap-3 px-8">
            <FolderIcon className="w-12 h-12 text-neutral-200" />
            <p className="text-sm font-medium text-neutral-500">No ZIP batches uploaded yet</p>
            <p className="text-xs text-neutral-400 text-center max-w-xs">
              Upload a ZIP file containing hotel reports to begin batch processing. Folder structures will be preserved.
            </p>
          </div>
        ) : (
          <div className="p-6 space-y-2">
            {batches.map((batch) => (
              <button
                key={batch.id}
                onClick={() => setSelectedBatchId(batch.id)}
                className="w-full flex items-center gap-4 p-4 rounded-lg border border-neutral-200 hover:border-brand-300 hover:bg-brand-50/30 transition-colors text-left"
              >
                <FolderIcon className="w-8 h-8 text-neutral-300 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-neutral-900 truncate">{batch.original_filename}</p>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    {fmtRelative(batch.created_at)} · {batch.total_files} files · {batch.total_folders} properties
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {batch.needs_review_count > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-warning-100 text-warning-700">
                      <ExclamationTriangleIcon className="w-3 h-3" />
                      {batch.needs_review_count} review
                    </span>
                  )}
                  {batch.not_classified_count > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                      {batch.not_classified_count} unclassified
                    </span>
                  )}
                  <span className={clsx(
                    'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize',
                    STATUS_STYLES[batch.status] ?? 'text-gray-500 bg-gray-50',
                  )}>
                    {batch.status.replace(/_/g, ' ')}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
