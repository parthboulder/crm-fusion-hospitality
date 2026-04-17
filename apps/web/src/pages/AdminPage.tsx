/**
 * Admin page — user management, roles, audit logs, session management.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api-client';
import { fmtDate, fmtRelative } from '../lib/formatters';
import { useAuthStore } from '../store/auth.store';
import { clsx } from 'clsx';
import { StorageTab } from '../components/admin/StorageTab';
import { useIpGeo, formatLocation } from '../lib/ipgeo';

type AdminTab = 'users' | 'roles' | 'audit' | 'storage';

interface User {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  role: { name: string; displayName: string };
  _count: { sessions: number };
}

interface AuditLog {
  id: string;
  userId: string | null;
  userEmail: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: string;
  failureReason: string | null;
  ipAddress: string | null;
  createdAt: string;
}

// Pretty labels for the auth events users actually look at.
const ACTION_LABELS: Record<string, string> = {
  'auth.login.success': 'Logged in',
  'auth.login.failed': 'Login failed',
  'auth.logout': 'Logged out',
  'auth.oauth.success': 'Microsoft sign-in',
  'auth.oauth.failed': 'Microsoft sign-in failed',
  'auth.oauth.autoprovisioned': 'Account auto-created',
  'auth.mfa.failed': 'MFA failed',
};

export function AdminPage() {
  const { hasPermission } = useAuthStore();
  const qc = useQueryClient();
  const [tab, setTab] = useState<AdminTab>('users');

  if (!hasPermission('admin:users') && !hasPermission('admin:audit')) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-gray-400">You don't have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Admin</h1>

      {/* Tabs */}
      <div className="border-b border-gray-100 mb-6">
        <nav className="flex gap-1">
          {(['users', 'roles', 'audit', 'storage'] as AdminTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                'px-4 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px',
                tab === t
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700',
              )}
            >
              {t}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'users' && <UsersTab qc={qc} />}
      {tab === 'roles' && <RolesTab />}
      {tab === 'audit' && <AuditTab />}
      {tab === 'storage' && <StorageTab />}
    </div>
  );
}

// ─── Users Tab ────────────────────────────────────────────────────────────────

function UsersTab({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const { data, isLoading } = useQuery<{ data: User[] }>({
    queryKey: ['admin-users'],
    queryFn: () => api.get('/admin/users'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/admin/users/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/users/${id}/sessions`),
  });

  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-25 border-b border-gray-100">
          <tr>
            {['User', 'Role', 'MFA', 'Last Login', 'Active Sessions', 'Status', 'Actions'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {isLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-6 bg-gray-50 rounded animate-pulse" /></td></tr>
              ))
            : (data?.data ?? []).map((user) => (
                <tr key={user.id} className={clsx('hover:bg-slate-25', !user.isActive && 'opacity-50')}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{user.fullName}</p>
                    <p className="text-xs text-gray-400">{user.email}</p>
                  </td>
                  <td className="px-4 py-3 capitalize text-gray-600">{user.role?.displayName ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={clsx('text-xs font-medium', user.mfaEnabled ? 'text-success-600' : 'text-gray-300')}>
                      {user.mfaEnabled ? '✓ On' : 'Off'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 tabular-nums">{fmtRelative(user.lastLoginAt)}</td>
                  <td className="px-4 py-3 tabular-nums text-gray-600">{user._count?.sessions ?? 0}</td>
                  <td className="px-4 py-3">
                    <span className={clsx('text-xs font-medium', user.isActive ? 'text-success-600' : 'text-gray-400')}>
                      {user.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => toggleMutation.mutate({ id: user.id, isActive: !user.isActive })}
                        className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                      >
                        {user.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      {(user._count?.sessions ?? 0) > 0 && (
                        <button
                          onClick={() => revokeMutation.mutate(user.id)}
                          className="text-xs text-danger-600 hover:text-danger-700 font-medium"
                        >
                          Revoke sessions
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Roles Tab ────────────────────────────────────────────────────────────────

function RolesTab() {
  const { data, isLoading } = useQuery<{ data: Array<{ id: string; displayName: string; name: string; rolePermissions: unknown[]; _count: { userProfiles: number } }> }>({
    queryKey: ['admin-roles'],
    queryFn: () => api.get('/admin/roles'),
  });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {isLoading
        ? Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card h-24 animate-pulse" />
          ))
        : (data?.data ?? []).map((role) => (
            <div key={role.id} className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-gray-900">{role.displayName}</p>
                <span className="text-xs text-gray-400">{role._count?.userProfiles ?? 0} users</span>
              </div>
              <p className="text-xs text-gray-400 font-mono">{role.name}</p>
              <p className="text-xs text-gray-300 mt-1">
                {((role.rolePermissions as unknown[] | undefined) ?? []).length} permissions
              </p>
            </div>
          ))}
    </div>
  );
}

// ─── Audit Tab ────────────────────────────────────────────────────────────────

function AuditTab() {
  const [action, setAction] = useState('');

  const { data, isLoading } = useQuery<{ data: AuditLog[]; total: number }>({
    queryKey: ['audit-logs', action],
    queryFn: () => api.get(`/admin/audit-logs?limit=50${action ? `&action=${action}` : ''}`),
  });

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <input
          type="text"
          placeholder="Filter by action…"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 w-52"
        />
        {/* Quick presets — saves typing for the most useful filters. */}
        {[
          { label: 'All', value: '' },
          { label: 'Logins', value: 'auth.login' },
          { label: 'Logouts', value: 'auth.logout' },
          { label: 'OAuth', value: 'auth.oauth' },
          { label: 'Failed', value: 'failed' },
        ].map((p) => (
          <button
            key={p.label}
            onClick={() => setAction(p.value)}
            className={clsx(
              'text-xs px-2.5 py-1.5 rounded-md border transition-colors',
              action === p.value
                ? 'bg-brand-50 border-brand-200 text-brand-700 font-medium'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50',
            )}
          >
            {p.label}
          </button>
        ))}
        <span className="text-xs text-gray-400 ml-auto">{data?.total ?? 0} entries</span>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-25 border-b border-gray-100">
            <tr>
              {['Action', 'Resource', 'User', 'IP', 'Location', 'Result', 'Time'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 font-mono">
            {isLoading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}><td colSpan={7}><div className="h-6 bg-gray-50 animate-pulse mx-4 my-2 rounded" /></td></tr>
                ))
              : (data?.data ?? []).map((log) => (
                  <tr key={log.id} className="hover:bg-slate-25 text-xs">
                    <td className="px-4 py-2.5 text-gray-700 font-sans">
                      {ACTION_LABELS[log.action] ?? log.action}
                      {log.failureReason && (
                        <span className="ml-1 text-gray-400">· {log.failureReason}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{log.resourceType}{log.resourceId ? ` · ${log.resourceId.slice(0, 8)}` : ''}</td>
                    <td className="px-4 py-2.5 text-gray-700 font-sans">
                      {log.userEmail ?? (log.userId ? log.userId.slice(0, 8) : '—')}
                    </td>
                    <td className="px-4 py-2.5 text-gray-300">{log.ipAddress ?? '—'}</td>
                    <td className="px-4 py-2.5 text-gray-500 font-sans whitespace-nowrap">
                      <IpLocationCell ip={log.ipAddress} />
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={clsx('font-medium', log.result === 'success' ? 'text-success-600' : 'text-danger-600')}>
                        {log.result}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 tabular-nums whitespace-nowrap">
                      {log.createdAt ? new Date(log.createdAt).toLocaleString() : '—'}
                      <span className="ml-2 text-gray-300">({fmtRelative(log.createdAt)})</span>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IpLocationCell({ ip }: { ip: string | null }) {
  const { data, isFetching, isError } = useIpGeo(ip);
  if (!ip) return <span className="text-gray-300">—</span>;
  if (isFetching && !data) return <span className="text-gray-300">…</span>;
  if (isError || !data) return <span className="text-gray-300">—</span>;
  const label = formatLocation(data);
  return (
    <span title={[data.city, data.region, data.country].filter(Boolean).join(', ')}>
      {label || <span className="text-gray-300">—</span>}
    </span>
  );
}
