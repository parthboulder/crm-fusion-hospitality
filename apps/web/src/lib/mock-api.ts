/**
 * Mock API handler — intercepts all route patterns and returns empty data.
 * No sample/demo/fake records. The UI shows clean empty states.
 * Activated when VITE_MOCK=true.
 */

import { MOCK_USER, MOCK_PORTFOLIO_SUMMARY } from './mock-data';
import { getProperties, getDocuments } from './scan-data-adapter';

const delay = (ms = 150) => new Promise((r) => setTimeout(r, ms + Math.random() * 80));

function ok<T>(data: T) {
  return { success: true, data };
}

function emptyPage<T>(items: T[] = []) {
  return {
    success: true,
    data: items,
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  };
}

// Route matching helper — supports :param segments.
function match(pattern: string, url: string): Record<string, string> | null {
  const patParts = pattern.split('/');
  const urlParts = url.split('?')[0]!.split('/');
  if (patParts.length !== urlParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patParts.length; i++) {
    if (patParts[i]!.startsWith(':')) {
      params[patParts[i]!.slice(1)] = urlParts[i]!;
    } else if (patParts[i] !== urlParts[i]) {
      return null;
    }
  }
  return params;
}

// ─── Route table ──────────────────────────────────────────────────────────────

export async function mockRequest<T>(
  method: string,
  path: string,
  _body?: unknown,
): Promise<T> {
  await delay();

  const M = method.toUpperCase();

  // ── Auth ──────────────────────────────────────────────────────────────────

  if (M === 'POST' && path === '/auth/login') {
    return ok({ user: MOCK_USER, expiresAt: new Date(Date.now() + 8 * 3600_000) }) as T;
  }
  if (M === 'POST' && path === '/auth/logout') {
    return ok({ message: 'Logged out.' }) as T;
  }
  if (M === 'GET' && path === '/auth/me') {
    return ok({ user: MOCK_USER }) as T;
  }
  if (M === 'GET' && path === '/auth/sessions') {
    return ok([]) as T;
  }

  // ── Properties ────────────────────────────────────────────────────────────

  if (M === 'GET' && path.startsWith('/properties/portfolio/summary')) {
    return ok(MOCK_PORTFOLIO_SUMMARY) as T;
  }

  if (M === 'GET' && path.startsWith('/properties') && !path.includes('/properties/prop-')) {
    const props = await getProperties();
    return ok(props) as T;
  }

  const propMatch = match('/properties/:id', path.split('?')[0]!);
  if (M === 'GET' && propMatch) {
    throw { code: 'NOT_FOUND', message: 'Property not found.', status: 404 };
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  if (M === 'GET' && path.startsWith('/metrics/trends')) {
    return ok({ current: [], aggregates: { _avg: {}, _sum: {} } }) as T;
  }

  if (M === 'GET' && path.startsWith('/metrics/daily')) {
    return ok([]) as T;
  }

  if (M === 'GET' && path.startsWith('/metrics/financials')) {
    return ok([]) as T;
  }

  // ── Reports / Documents ──────────────────────────────────────────────────

  if (M === 'GET' && path.startsWith('/reports/search')) {
    const params = new URLSearchParams(path.split('?')[1] ?? '');
    const result = await getDocuments(params);
    return { success: true, ...result } as T;
  }

  if (M === 'GET' && path.startsWith('/reports')) {
    return emptyPage() as T;
  }

  // ── Alerts ────────────────────────────────────────────────────────────────

  if (M === 'GET' && path.startsWith('/alerts')) {
    return emptyPage() as T;
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────

  if (M === 'GET' && path.startsWith('/tasks')) {
    return emptyPage() as T;
  }

  // ── AI ────────────────────────────────────────────────────────────────────

  if (M === 'POST' && path.includes('/ai/')) {
    return ok({ content: '', model: 'mock', tokensUsed: 0 }) as T;
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  if (M === 'GET' && path === '/admin/users') {
    return ok([]) as T;
  }
  if (M === 'GET' && path === '/admin/roles') {
    return ok([]) as T;
  }
  if (M === 'GET' && path.startsWith('/admin/audit-logs')) {
    return emptyPage() as T;
  }

  // ── Batches (ZIP upload) ─────────────────────────────────────────────────

  if (M === 'GET' && path === '/batches') {
    return { success: true, data: [], total: 0 } as T;
  }

  const batchDetailMatch = match('/batches/:batchId', path.split('?')[0]!);
  if (M === 'GET' && batchDetailMatch) {
    return ok({ batch: null, items: [], folderGroups: {} }) as T;
  }

  // ── Fallback ─────────────────────────────────────────────────────────────

  console.warn(`[mock] Unhandled ${M} ${path}`);
  return ok(null) as T;
}
