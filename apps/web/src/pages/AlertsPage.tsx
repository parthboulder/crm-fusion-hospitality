/**
 * Alerts page — full list with acknowledge / resolve actions.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api-client';
import { fmtRelative, fmtCurrency } from '../lib/formatters';
import { SeverityBadge } from '../components/shared/SeverityBadge';
import { CheckIcon, EyeIcon } from '@heroicons/react/20/solid';
import { clsx } from 'clsx';

interface AlertsResponse {
  data: Alert[];
  total: number;
}

interface Alert {
  id: string;
  alertType: string;
  severity: string;
  title: string;
  description: string;
  status: string;
  metricName: string | null;
  metricValue: string | null;
  thresholdValue: string | null;
  pctChange: string | null;
  createdAt: string;
  property: { name: string; brand: string | null };
  tasks: Array<{ id: string; status: string }>;
}

export function AlertsPage() {
  const qc = useQueryClient();
  const [severity, setSeverity] = useState('');
  const [status, setStatus] = useState('open');
  const [selected, setSelected] = useState<Alert | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');

  const { data, isLoading } = useQuery<AlertsResponse>({
    queryKey: ['alerts', severity, status],
    queryFn: () => api.get(
      `/alerts?limit=50${severity ? `&severity=${severity}` : ''}${status ? `&status=${status}` : ''}`,
    ),
    refetchInterval: 30_000,
  });

  const ackMutation = useMutation({
    mutationFn: (id: string) => api.post(`/alerts/${id}/acknowledge`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
      setSelected(null);
    },
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) =>
      api.post(`/alerts/${id}/resolve`, { resolutionNotes: notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
      setSelected(null);
      setResolutionNotes('');
    },
  });

  const SEVERITIES = ['', 'critical', 'high', 'medium', 'low'];
  const STATUSES = ['open', 'acknowledged', 'resolved'];

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Alerts</h1>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={clsx(
                'px-3 py-2 capitalize transition-colors',
                status === s
                  ? 'bg-brand-600 text-white font-semibold'
                  : 'bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              {s || 'All'}
            </button>
          ))}
        </div>

        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">All severities</option>
          {SEVERITIES.slice(1).map((s) => (
            <option key={s} value={s} className="capitalize">{s}</option>
          ))}
        </select>

        <span className="text-xs text-gray-400">{data?.total ?? 0} alerts</span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Alerts list */}
        <div className={clsx('space-y-2', selected ? 'xl:col-span-2' : 'xl:col-span-3')}>
          {isLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="card h-16 animate-pulse" />
            ))
          ) : (data?.data ?? []).length === 0 ? (
            <div className="card px-6 py-16 text-center">
              <CheckIcon className="w-10 h-10 text-success-400 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-600">No alerts match your filters.</p>
            </div>
          ) : (
            (data?.data ?? []).map((alert) => (
              <button
                key={alert.id}
                onClick={() => setSelected(alert)}
                className={clsx(
                  'card w-full text-left px-4 py-3.5 hover:shadow-card-md transition-all',
                  selected?.id === alert.id && 'ring-2 ring-brand-400',
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    <SeverityBadge severity={alert.severity} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-gray-900 leading-snug">{alert.title}</p>
                      <span className="text-xs text-gray-300 shrink-0">{fmtRelative(alert.createdAt)}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{alert.property.name}</p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="xl:col-span-1">
            <div className="card p-5 sticky top-6">
              <div className="flex items-center justify-between mb-4">
                <SeverityBadge severity={selected.severity} />
                <button
                  onClick={() => setSelected(null)}
                  className="text-gray-300 hover:text-gray-500 text-xs"
                >
                  Close
                </button>
              </div>

              <h2 className="text-sm font-bold text-gray-900 mb-1">{selected.title}</h2>
              <p className="text-xs text-gray-500 mb-1">{selected.property.name}</p>
              <p className="text-xs text-gray-400 mb-4">{selected.description}</p>

              {/* Metric detail */}
              {selected.metricValue && (
                <dl className="grid grid-cols-2 gap-3 mb-4 p-3 bg-slate-25 rounded-lg">
                  <div>
                    <dt className="text-xs text-gray-400">Current</dt>
                    <dd className="text-sm font-semibold tabular-nums">{fmtCurrency(selected.metricValue)}</dd>
                  </div>
                  {selected.thresholdValue && (
                    <div>
                      <dt className="text-xs text-gray-400">Threshold</dt>
                      <dd className="text-sm font-semibold tabular-nums">{fmtCurrency(selected.thresholdValue)}</dd>
                    </div>
                  )}
                  {selected.pctChange && (
                    <div className="col-span-2">
                      <dt className="text-xs text-gray-400">Change</dt>
                      <dd className={clsx('text-sm font-semibold', Number(selected.pctChange) < 0 ? 'text-danger-600' : 'text-success-600')}>
                        {Number(selected.pctChange) >= 0 ? '+' : ''}{Number(selected.pctChange).toFixed(1)}%
                      </dd>
                    </div>
                  )}
                </dl>
              )}

              {/* Linked tasks */}
              {selected.tasks.length > 0 && (
                <p className="text-xs text-gray-400 mb-4">
                  {selected.tasks.length} linked task{selected.tasks.length > 1 ? 's' : ''}
                </p>
              )}

              {/* Actions */}
              {selected.status === 'open' && (
                <button
                  onClick={() => ackMutation.mutate(selected.id)}
                  disabled={ackMutation.isPending}
                  className="btn-secondary w-full justify-center mb-2 text-xs"
                >
                  <EyeIcon className="w-3.5 h-3.5" />
                  Acknowledge
                </button>
              )}

              {selected.status !== 'resolved' && (
                <div className="space-y-2">
                  <textarea
                    value={resolutionNotes}
                    onChange={(e) => setResolutionNotes(e.target.value)}
                    placeholder="Resolution notes (required)…"
                    rows={3}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
                  />
                  <button
                    onClick={() => resolveMutation.mutate({ id: selected.id, notes: resolutionNotes })}
                    disabled={resolutionNotes.length < 10 || resolveMutation.isPending}
                    className="btn-primary w-full justify-center text-xs"
                  >
                    <CheckIcon className="w-3.5 h-3.5" />
                    Mark Resolved
                  </button>
                </div>
              )}

              {selected.status === 'resolved' && (
                <span className="text-xs text-success-600 font-medium">✓ Resolved</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
