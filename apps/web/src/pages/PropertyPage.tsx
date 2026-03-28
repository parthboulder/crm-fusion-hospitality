/**
 * Property drill-down — metrics, reports, alerts, tasks, AI summary.
 */

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api-client';
import { KpiCard } from '../components/dashboard/KpiCard';
import { fmtCurrency, fmtPct, fmtDate, yoyChange } from '../lib/formatters';
import { SparklesIcon, ArrowLeftIcon } from '@heroicons/react/24/outline';
import { SeverityBadge } from '../components/shared/SeverityBadge';

export function PropertyPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'metrics' | 'reports' | 'alerts' | 'tasks'>('metrics');

  const { data: propData, isLoading } = useQuery({
    queryKey: ['property', id],
    queryFn: () => api.get<{ data: { property: PropertyDetail; recentMetrics: MetricRow[] } }>(`/properties/${id!}`),
    enabled: !!id,
  });

  const { data: summaryData, isLoading: summaryLoading } = useQuery({
    queryKey: ['ai-summary', id],
    queryFn: () => api.post<{ data: { content: string }; cached: boolean }>(`/ai/property/${id!}/summary`, { period: 'daily' }),
    enabled: !!id,
    staleTime: 3_600_000,
  });

  const { data: alerts } = useQuery({
    queryKey: ['alerts', id],
    queryFn: () => api.get<{ data: AlertRow[] }>(`/alerts?propertyId=${id!}&limit=20`),
    enabled: !!id && activeTab === 'alerts',
  });

  const { data: reports } = useQuery({
    queryKey: ['reports', id],
    queryFn: () => api.get<{ data: ReportRow[] }>(`/reports?propertyId=${id!}&limit=20`),
    enabled: !!id && activeTab === 'reports',
  });

  const { data: tasks } = useQuery({
    queryKey: ['tasks', id],
    queryFn: () => api.get<{ data: TaskRow[] }>(`/tasks?propertyId=${id!}&limit=20`),
    enabled: !!id && activeTab === 'tasks',
  });

  if (isLoading || !propData) {
    return (
      <div className="p-6">
        <div className="h-6 w-48 bg-gray-100 rounded animate-pulse mb-6" />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card h-24 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const { property, recentMetrics } = propData.data;
  const latest = recentMetrics[0];
  const revChange = yoyChange(latest?.totalRevenue ?? null, latest?.pyTotalRevenue ?? null);

  const TABS = ['metrics', 'reports', 'alerts', 'tasks'] as const;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Back + header */}
      <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-4">
        <ArrowLeftIcon className="w-4 h-4" /> Portfolio
      </Link>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{property.name}</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {[property.brand, property.city, property.state].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {property._count.alerts > 0 && (
            <span className="px-3 py-1.5 text-xs font-semibold text-danger-600 bg-danger-50 rounded-full ring-1 ring-danger-100">
              {property._count.alerts} open alerts
            </span>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Occupancy"   value={fmtPct(latest?.occupancyPct)}   change={yoyChange(latest?.occupancyPct ?? null, latest?.pyOccupancyPct ?? null)} />
        <KpiCard label="ADR"         value={fmtCurrency(latest?.adr)}        change={yoyChange(latest?.adr ?? null, latest?.pyAdr ?? null)} />
        <KpiCard label="RevPAR"      value={fmtCurrency(latest?.revpar)}     change={yoyChange(latest?.revpar ?? null, latest?.pyRevpar ?? null)} />
        <KpiCard label="Revenue"     value={fmtCurrency(latest?.totalRevenue)} change={revChange} />
      </div>

      {/* AI Summary */}
      <div className="card p-4 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <SparklesIcon className="w-4 h-4 text-brand-500" />
          <span className="text-xs font-semibold text-brand-700">AI Summary</span>
          {summaryData?.cached && <span className="text-xs text-gray-300">cached</span>}
        </div>
        {summaryLoading ? (
          <div className="space-y-2">
            <div className="h-3 bg-gray-100 rounded animate-pulse w-full" />
            <div className="h-3 bg-gray-100 rounded animate-pulse w-4/5" />
          </div>
        ) : (
          <p className="text-sm text-gray-600 leading-relaxed">{summaryData?.data.content ?? 'No summary available.'}</p>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-100 mb-4">
        <nav className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab panels */}
      {activeTab === 'metrics' && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-25 border-b border-gray-100">
              <tr>
                {['Date','Occupancy','ADR','RevPAR','Revenue','PY Revenue','OOO Rooms'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {recentMetrics.slice(0, 14).map((m) => (
                <tr key={m.id} className="hover:bg-slate-25">
                  <td className="px-4 py-2.5 tabular-nums text-gray-600">{fmtDate(m.metricDate)}</td>
                  <td className="px-4 py-2.5 tabular-nums font-medium">{fmtPct(m.occupancyPct)}</td>
                  <td className="px-4 py-2.5 tabular-nums">{fmtCurrency(m.adr)}</td>
                  <td className="px-4 py-2.5 tabular-nums">{fmtCurrency(m.revpar)}</td>
                  <td className="px-4 py-2.5 tabular-nums">{fmtCurrency(m.totalRevenue)}</td>
                  <td className="px-4 py-2.5 tabular-nums text-gray-400">{fmtCurrency(m.pyTotalRevenue)}</td>
                  <td className="px-4 py-2.5 tabular-nums">{m.roomsOoo ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'alerts' && (
        <div className="card overflow-hidden">
          {(alerts?.data ?? []).length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-gray-400">No alerts for this property.</div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {(alerts?.data ?? []).map((a) => (
                <li key={a.id} className="px-5 py-3.5 flex items-start gap-3">
                  <SeverityBadge severity={a.severity} />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{a.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{a.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {activeTab === 'reports' && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-25 border-b border-gray-100">
              <tr>
                {['Date','Type','Status','Confidence','Source'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(reports?.data ?? []).map((r) => (
                <tr key={r.id} className="hover:bg-slate-25">
                  <td className="px-4 py-2.5 text-gray-600 tabular-nums">{fmtDate(r.reportDate)}</td>
                  <td className="px-4 py-2.5 capitalize">{r.reportType.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {r.confidenceScore ? `${(Number(r.confidenceScore) * 100).toFixed(0)}%` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 capitalize">{r.source.replace(/_/g, ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'tasks' && (
        <div className="card overflow-hidden">
          {(tasks?.data ?? []).length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-gray-400">No open tasks.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-25 border-b border-gray-100">
                <tr>
                  {['Priority','Title','Assigned To','Due','Status'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(tasks?.data ?? []).map((t) => (
                  <tr key={t.id} className="hover:bg-slate-25">
                    <td className="px-4 py-2.5"><SeverityBadge severity={t.priority} /></td>
                    <td className="px-4 py-2.5 font-medium">{t.title}</td>
                    <td className="px-4 py-2.5 text-gray-500">{(t.assignee as { fullName?: string } | null)?.fullName ?? '—'}</td>
                    <td className="px-4 py-2.5 text-gray-400 tabular-nums">{fmtDate(t.dueDate)}</td>
                    <td className="px-4 py-2.5 capitalize"><StatusBadge status={t.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Local sub-components ─────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-500',
    processing: 'bg-blue-50 text-blue-600',
    extracted: 'bg-green-50 text-green-600',
    review_required: 'bg-warning-50 text-warning-600',
    approved: 'bg-success-50 text-success-600',
    failed: 'bg-danger-50 text-danger-600',
    open: 'bg-orange-50 text-orange-600',
    in_progress: 'bg-blue-50 text-blue-600',
    completed: 'bg-success-50 text-success-600',
    cancelled: 'bg-gray-100 text-gray-400',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${colors[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface PropertyDetail {
  id: string; name: string; brand: string | null; city: string | null;
  state: string | null; totalRooms: number | null;
  _count: { reports: number; alerts: number; tasks: number };
}

interface MetricRow {
  id: string; metricDate: string; occupancyPct: number | null; adr: number | null;
  revpar: number | null; totalRevenue: number | null; pyTotalRevenue: number | null;
  pyOccupancyPct: number | null; pyAdr: number | null; pyRevpar: number | null;
  roomsOoo: number | null;
}

interface AlertRow {
  id: string; severity: string; title: string; description: string; alertType: string;
}

interface ReportRow {
  id: string; reportDate: string; reportType: string; status: string;
  confidenceScore: string | null; source: string;
}

interface TaskRow {
  id: string; title: string; priority: string; status: string;
  dueDate: string | null; assignee: unknown;
}
