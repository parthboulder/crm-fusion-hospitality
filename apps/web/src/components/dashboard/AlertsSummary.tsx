/**
 * Alert summary panel — sorted by severity, click-through to full detail.
 */

import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { ExclamationCircleIcon, ArrowRightIcon } from '@heroicons/react/20/solid';
import { fmtRelative } from '../../lib/formatters';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api-client';

interface Alert {
  id: string;
  alertType: string;
  severity: string;
  title: string;
  description: string;
  createdAt: string;
  property: { name: string };
}

interface AlertsResponse {
  data: Alert[];
  total: number;
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function AlertsSummary() {
  const { data, isLoading } = useQuery<AlertsResponse>({
    queryKey: ['alerts', 'open', 'summary'],
    queryFn: () => api.get('/alerts?status=open&limit=8'),
    refetchInterval: 30_000,
  });

  const alerts = (data?.data ?? []).sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );

  return (
    <div className="card">
      <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-neutral-200">
        <h2 className="text-sm font-medium text-neutral-800">Open Alerts</h2>
        {data && data.total > 0 && (
          <span className="text-xs text-neutral-400">{data.total} total</span>
        )}
        <Link to="/alerts" className="text-xs text-neutral-500 hover:text-neutral-900 font-medium flex items-center gap-1">
          View all <ArrowRightIcon className="w-3 h-3" />
        </Link>
      </div>

      {isLoading ? (
        <div className="px-5 py-4 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 bg-neutral-100 rounded animate-pulse" />
          ))}
        </div>
      ) : alerts.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <ExclamationCircleIcon className="w-7 h-7 text-neutral-200 mx-auto mb-2" />
          <p className="text-sm text-neutral-400">No open alerts</p>
        </div>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {alerts.map((alert) => (
            <li key={alert.id}>
              <Link
                to={`/alerts?id=${alert.id}`}
                className="flex items-start gap-3 px-5 py-2.5 hover:bg-neutral-50 transition-colors"
              >
                <SeverityDot severity={alert.severity} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-neutral-800 truncate">{alert.title}</p>
                  <p className="text-xs text-neutral-400 truncate mt-0.5">{alert.property.name}</p>
                </div>
                <span className="text-xs text-neutral-400 shrink-0 mt-0.5">{fmtRelative(alert.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SeverityDot({ severity }: { severity: string }) {
  return (
    <span
      className={clsx(
        'w-2 h-2 rounded-full mt-1 shrink-0',
        severity === 'critical' && 'bg-danger-500',
        severity === 'high' && 'bg-orange-400',
        severity === 'medium' && 'bg-warning-500',
        severity === 'low' && 'bg-gray-300',
      )}
    />
  );
}
