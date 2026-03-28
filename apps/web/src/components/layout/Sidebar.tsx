/**
 * Left sidebar navigation.
 */

import { NavLink, useNavigate } from 'react-router-dom';
import {
  HomeIcon,
  DocumentTextIcon,
  BellAlertIcon,
  ClipboardDocumentListIcon,
  CogIcon,
  ArrowRightStartOnRectangleIcon,
  BuildingOffice2Icon,
  ChartBarIcon,
  FolderOpenIcon,
  InboxStackIcon,
  MagnifyingGlassCircleIcon,
} from '@heroicons/react/24/outline';
import { clsx } from 'clsx';
import { useAuthStore } from '../../store/auth.store';
import { api } from '../../lib/api-client';
import { useQuery } from '@tanstack/react-query';

const nav = [
  { label: 'Dashboard',   to: '/dashboard',   Icon: HomeIcon },
  { label: 'Performance', to: '/stoneriver',  Icon: ChartBarIcon },
  { label: 'Reports',     to: '/reports',     Icon: DocumentTextIcon },
  { label: 'Documents',   to: '/documents',   Icon: FolderOpenIcon },
  { label: 'Batch Review',to: '/batch-review',Icon: InboxStackIcon },
  { label: 'File Scanner',to: '/scanner',    Icon: MagnifyingGlassCircleIcon },
  { label: 'Alerts',      to: '/alerts',      Icon: BellAlertIcon },
  { label: 'Tasks',       to: '/tasks',       Icon: ClipboardDocumentListIcon },
];

interface AlertCountData {
  data: {
    openAlerts: Array<{ severity: string; _count: { id: number } }>;
  };
}

export function Sidebar() {
  const { user, clearUser } = useAuthStore();
  const navigate = useNavigate();

  const { data: alertCounts } = useQuery<AlertCountData>({
    queryKey: ['alert-counts'],
    queryFn: () => api.get('/properties/portfolio/summary'),
    refetchInterval: 60_000,
  });

  const criticalCount = alertCounts?.data?.openAlerts
    ?.filter((a) => a.severity === 'critical')
    .reduce((s, a) => s + a._count.id, 0) ?? 0;

  async function handleLogout() {
    await api.post('/auth/logout').catch(() => null);
    clearUser();
    navigate('/login');
  }

  const isAdmin = user?.role && ['super_admin', 'corporate'].includes(user.role);

  return (
    <aside className="flex flex-col w-64 bg-white border-r border-neutral-200 shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-neutral-200">
        <div className="flex items-center justify-center w-8 h-8 rounded bg-neutral-900">
          <BuildingOffice2Icon className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold text-neutral-900 leading-none tracking-tight">Fusion</p>
          <p className="text-xs text-neutral-400 mt-0.5">Hospitality</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3 space-y-0.5">
        {nav.map(({ label, to, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2 rounded text-sm font-medium transition-colors',
                isActive
                  ? 'bg-neutral-100 text-neutral-900'
                  : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800',
              )
            }
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="flex-1">{label}</span>
            {label === 'Alerts' && criticalCount > 0 && (
              <span className="flex items-center justify-center w-4 h-4 text-xs font-bold text-white bg-danger-500 rounded-sm">
                {criticalCount > 9 ? '9+' : criticalCount}
              </span>
            )}
          </NavLink>
        ))}

        {isAdmin && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2 rounded text-sm font-medium transition-colors',
                isActive
                  ? 'bg-neutral-100 text-neutral-900'
                  : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800',
              )
            }
          >
            <CogIcon className="w-4 h-4 shrink-0" />
            Admin
          </NavLink>
        )}
      </nav>

      {/* User footer */}
      <div className="px-3 py-3 border-t border-neutral-200">
        <div className="flex items-center gap-3 px-3 py-2 rounded">
          <div className="flex items-center justify-center w-7 h-7 rounded bg-neutral-100 text-neutral-600 text-xs font-semibold shrink-0">
            {user?.fullName?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-neutral-800 truncate">{user?.fullName}</p>
            <p className="text-xs text-neutral-400 truncate capitalize">{user?.role?.replace('_', ' ')}</p>
          </div>
          <button
            onClick={handleLogout}
            className="text-neutral-400 hover:text-neutral-600 transition-colors"
            title="Sign out"
          >
            <ArrowRightStartOnRectangleIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
