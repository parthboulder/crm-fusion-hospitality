/**
 * Left sidebar navigation.
 */

import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  HomeIcon,
  CogIcon,
  ArrowRightStartOnRectangleIcon,
  ChartBarIcon,
  FolderOpenIcon,
  CloudArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { clsx } from 'clsx';
import { useAuthStore } from '../../store/auth.store';
import { api } from '../../lib/api-client';

const nav = [
  { label: 'Dashboard',   to: '/dashboard',   Icon: HomeIcon },
  { label: 'Performance', to: '/stoneriver',  Icon: ChartBarIcon },
  { label: 'Documents',   to: '/documents',  Icon: FolderOpenIcon },
  { label: 'OCR Uploads', to: '/ocr',        Icon: CloudArrowUpIcon },
];

export function Sidebar() {
  const { user, clearUser } = useAuthStore();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  async function handleLogout() {
    await api.post('/auth/logout').catch(() => null);
    clearUser();
    // Remove persisted auth state so stale permissions don't linger.
    localStorage.removeItem('fusion-auth');
    navigate('/login');
  }

  const isAdmin = user?.role && ['super_admin', 'corporate'].includes(user.role);

  return (
    <aside
      className={clsx(
        'relative flex flex-col bg-white border-r border-neutral-200 shrink-0 transition-[width] duration-150',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      {/* Collapse toggle — sits on the outer edge */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="absolute -right-3 top-6 z-10 flex items-center justify-center w-6 h-6 rounded-full bg-white border border-neutral-200 text-neutral-500 hover:text-neutral-800 hover:border-neutral-300 shadow-sm transition-colors"
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? (
          <ChevronRightIcon className="w-3.5 h-3.5" />
        ) : (
          <ChevronLeftIcon className="w-3.5 h-3.5" />
        )}
      </button>

      {/* Logo — red H icon + black "Fusion Hospitality" wordmark on white. */}
      <div
        className={clsx(
          'flex items-center gap-3 py-4 border-b border-neutral-200 bg-white',
          collapsed ? 'justify-center px-3' : 'px-6',
        )}
      >
        <img
          src="/logo-icon.png"
          alt="HFI"
          className={clsx('shrink-0 object-contain', collapsed ? 'w-10 h-10' : 'w-12 h-12')}
        />
        {!collapsed && (
          <img
            src="/logo-wordmark.png"
            alt="Fusion Hospitality"
            className="w-auto object-contain"
            style={{ height: '41px' }}
          />
        )}
      </div>

      {/* Navigation */}
      <nav className={clsx('flex-1 py-3 space-y-0.5', collapsed ? 'px-2' : 'px-3')}>
        {nav.map(({ label, to, Icon }) => (
          <NavLink
            key={to}
            to={to}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 py-2 rounded text-sm font-medium transition-colors',
                collapsed ? 'justify-center px-2' : 'px-3',
                isActive
                  ? 'bg-neutral-100 text-neutral-900'
                  : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800',
              )
            }
          >
            <Icon className="w-4 h-4 shrink-0" />
            {!collapsed && <span className="flex-1">{label}</span>}
          </NavLink>
        ))}

        {isAdmin && (
          <NavLink
            to="/admin"
            title={collapsed ? 'Admin' : undefined}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 py-2 rounded text-sm font-medium transition-colors',
                collapsed ? 'justify-center px-2' : 'px-3',
                isActive
                  ? 'bg-neutral-100 text-neutral-900'
                  : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800',
              )
            }
          >
            <CogIcon className="w-4 h-4 shrink-0" />
            {!collapsed && <span>Admin</span>}
          </NavLink>
        )}
      </nav>

      {/* User footer */}
      <div className={clsx('py-3 border-t border-neutral-200', collapsed ? 'px-2' : 'px-3')}>
        <div
          className={clsx(
            'flex items-center gap-3 py-2 rounded',
            collapsed ? 'flex-col px-1' : 'px-3',
          )}
        >
          <div
            className="flex items-center justify-center w-7 h-7 rounded bg-neutral-100 text-neutral-600 text-xs font-semibold shrink-0"
            title={collapsed ? user?.fullName ?? '' : undefined}
          >
            {user?.fullName?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-neutral-800 truncate">{user?.fullName}</p>
              <p className="text-xs text-neutral-400 truncate capitalize">{user?.role?.replace('_', ' ')}</p>
            </div>
          )}
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
