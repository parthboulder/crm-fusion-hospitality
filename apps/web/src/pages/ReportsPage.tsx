/**
 * Reports page — list, upload, extraction review queue.
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import { api } from '../lib/api-client';
import { fmtDate, fmtRelative } from '../lib/formatters';
import { CloudArrowUpIcon, DocumentTextIcon, CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
import { SeverityBadge } from '../components/shared/SeverityBadge';
import { clsx } from 'clsx';

interface PropertiesResponse { data: Array<{ id: string; name: string }> }
interface ReportsResponse {
  data: Array<{
    id: string; reportType: string; reportDate: string; status: string;
    confidenceScore: string | null; requiresReview: boolean; source: string;
    property: { name: string; brand: string | null };
    files: Array<{ originalName: string }>;
    _count: { alerts: number };
  }>;
  total: number;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-gray-400 bg-gray-50',
  processing: 'text-blue-600 bg-blue-50',
  extracted: 'text-green-600 bg-green-50',
  review_required: 'text-orange-600 bg-orange-50',
  approved: 'text-success-600 bg-success-50',
  failed: 'text-danger-600 bg-danger-50',
};

export function ReportsPage() {
  const qc = useQueryClient();
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [filterStatus, setFilterStatus] = useState('');

  const { data: properties } = useQuery<PropertiesResponse>({
    queryKey: ['properties'],
    queryFn: () => api.get('/properties'),
  });

  const { data: reports, isLoading } = useQuery<ReportsResponse>({
    queryKey: ['reports', filterStatus],
    queryFn: () => api.get(`/reports?limit=30${filterStatus ? `&status=${filterStatus}` : ''}`),
    refetchInterval: 15_000,
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, action, notes }: { id: string; action: 'approve' | 'reject'; notes?: string }) =>
      api.patch(`/reports/${id}/review`, { action, notes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports'] }),
  });

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (!selectedPropertyId) {
        alert('Please select a property first.');
        return;
      }
      const file = acceptedFiles[0];
      if (!file) return;

      setUploadStatus('uploading');
      const formData = new FormData();
      formData.append('file', file);

      try {
        await api.upload(`/reports/upload?propertyId=${selectedPropertyId}`, formData);
        setUploadStatus('success');
        qc.invalidateQueries({ queryKey: ['reports'] });
        setTimeout(() => setUploadStatus('idle'), 3000);
      } catch {
        setUploadStatus('error');
        setTimeout(() => setUploadStatus('idle'), 4000);
      }
    },
    [selectedPropertyId, qc],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'text/csv': ['.csv'],
    },
    maxSize: 50 * 1024 * 1024,
    multiple: false,
  });

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Reports</h1>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Upload panel */}
        <div className="xl:col-span-1 space-y-4">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Upload Report</h2>

            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-600 mb-1">Property</label>
              <select
                value={selectedPropertyId}
                onChange={(e) => setSelectedPropertyId(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">Select property…</option>
                {properties?.data.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div
              {...getRootProps()}
              className={clsx(
                'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
                isDragActive ? 'border-brand-400 bg-brand-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50',
                uploadStatus === 'uploading' && 'opacity-60 pointer-events-none',
              )}
            >
              <input {...getInputProps()} />
              {uploadStatus === 'uploading' ? (
                <div className="flex flex-col items-center gap-2 text-gray-400">
                  <div className="w-6 h-6 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs">Uploading…</p>
                </div>
              ) : uploadStatus === 'success' ? (
                <div className="flex flex-col items-center gap-2 text-success-600">
                  <CheckCircleIcon className="w-8 h-8" />
                  <p className="text-xs font-medium">Uploaded! Processing…</p>
                </div>
              ) : uploadStatus === 'error' ? (
                <div className="flex flex-col items-center gap-2 text-danger-500">
                  <ExclamationCircleIcon className="w-8 h-8" />
                  <p className="text-xs font-medium">Upload failed. Try again.</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-gray-400">
                  <CloudArrowUpIcon className="w-8 h-8" />
                  <p className="text-xs font-medium text-gray-600">Drop file here</p>
                  <p className="text-xs">PDF, Excel, or CSV · Max 50 MB</p>
                </div>
              )}
            </div>
          </div>

          {/* Review queue */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Review Queue</h2>
            {(reports?.data ?? []).filter((r) => r.status === 'review_required').length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">No reports pending review.</p>
            ) : (
              <ul className="space-y-2">
                {(reports?.data ?? [])
                  .filter((r) => r.status === 'review_required')
                  .map((r) => (
                    <li key={r.id} className="p-3 bg-orange-50 rounded-lg border border-orange-100">
                      <p className="text-xs font-medium text-gray-800">
                        {r.property.name} — {r.reportType.replace(/_/g, ' ')}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Confidence: {r.confidenceScore ? `${(Number(r.confidenceScore) * 100).toFixed(0)}%` : 'N/A'}
                      </p>
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => reviewMutation.mutate({ id: r.id, action: 'approve' })}
                          className="text-xs font-medium text-success-600 hover:text-success-700"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => reviewMutation.mutate({ id: r.id, action: 'reject' })}
                          className="text-xs font-medium text-danger-600 hover:text-danger-700"
                        >
                          Reject
                        </button>
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </div>

        {/* Reports table */}
        <div className="xl:col-span-2">
          <div className="flex items-center gap-3 mb-4">
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="review_required">Review Required</option>
              <option value="approved">Approved</option>
              <option value="failed">Failed</option>
            </select>
            <span className="text-xs text-gray-400">{reports?.total ?? 0} reports</span>
          </div>

          <div className="card overflow-hidden">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-10 bg-gray-50 rounded animate-pulse" />
                ))}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-25 border-b border-gray-100">
                  <tr>
                    {['Property', 'Report Type', 'Date', 'Status', 'Confidence', 'Alerts', ''].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(reports?.data ?? []).map((r) => (
                    <tr key={r.id} className="hover:bg-slate-25">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 truncate max-w-[120px]">{r.property.name}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-600 capitalize">{r.reportType.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-3 text-gray-500 tabular-nums whitespace-nowrap">{fmtDate(r.reportDate)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${STATUS_COLORS[r.status] ?? 'text-gray-500 bg-gray-50'}`}>
                          {r.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-gray-500">
                        {r.confidenceScore ? `${(Number(r.confidenceScore) * 100).toFixed(0)}%` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {r._count.alerts > 0 ? (
                          <span className="text-xs font-medium text-danger-600">{r._count.alerts}</span>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => {/* TODO: open report detail modal */}}
                          className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
