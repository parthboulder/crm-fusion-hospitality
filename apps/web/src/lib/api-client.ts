/**
 * Type-safe API client.
 * When VITE_MOCK=true (set in .env.development), all calls are intercepted
 * by the mock handler and no real network requests are made.
 */

import { mockRequest } from './mock-api';

const USE_MOCK = import.meta.env['VITE_MOCK'] === 'true';
const BASE = '/api/v1';

// Best-effort lookup of the user's real public IP, cached module-level.
// Sent as X-Client-Public-IP on every request so the API can record a real
// IP in audit logs — `req.ip` is useless in local dev (always 127.0.0.1)
// and behind some proxies that don't forward X-Forwarded-For correctly.
let publicIpPromise: Promise<string | null> | null = null;
function getPublicIp(): Promise<string | null> {
  if (!publicIpPromise) {
    publicIpPromise = fetch('https://api.ipify.org?format=json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ip?: string } | null) => j?.ip ?? null)
      .catch(() => null);
  }
  return publicIpPromise;
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  method: string,
  path: string,
  options: RequestInit = {},
  body?: unknown,
): Promise<T> {
  if (USE_MOCK) {
    return mockRequest<T>(method, path, body);
  }

  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
  if (options.body != null && !(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const publicIp = await getPublicIp();
  if (publicIp && !headers['X-Client-Public-IP']) {
    headers['X-Client-Public-IP'] = publicIp;
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    ...options,
    headers,
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiError(
      json?.error?.code ?? 'UNKNOWN',
      json?.error?.message ?? 'An error occurred.',
      res.status,
    );
  }

  return json as T;
}

export const api = {
  get: <T>(path: string) =>
    request<T>('GET', path),

  post: <T>(path: string, body?: unknown) =>
    request<T>('POST', path, { body: JSON.stringify(body) }, body),

  patch: <T>(path: string, body?: unknown) =>
    request<T>('PATCH', path, { body: JSON.stringify(body) }, body),

  delete: <T>(path: string) =>
    request<T>('DELETE', path),

  upload: <T>(path: string, formData: FormData) =>
    USE_MOCK
      ? mockRequest<T>('POST', path, formData)
      : request<T>('POST', path, { body: formData, headers: {} }),
};
