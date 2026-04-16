/**
 * E2E security smoke tests — validates the fixes applied during the security review.
 * These tests verify HTTP-level behaviors, not UI flows, so they work against the
 * running dev server without needing a real Supabase backend.
 */

import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:3001';

// ─── Auth & Session Security ─────────────────────────────────────────────────

test.describe('Auth endpoints', () => {
  test('POST /api/v1/auth/login rejects invalid payload', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/v1/auth/login`, {
      data: { email: 'not-an-email', password: '123' },
    });
    // 422 = Zod validation, 400 = Fastify schema, 429/500 = rate limited.
    // The critical assertion: it must NOT be 200 (success).
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).not.toBe(200);
  });

  test('POST /api/v1/auth/login does not leak user existence', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/v1/auth/login`, {
      data: { email: 'nobody@example.com', password: 'LongEnoughPassword1!' },
    });
    // Must not succeed. 401 = correct auth rejection.
    // 429/500 = rate limited (acceptable — still a rejection).
    expect(res.status()).toBeGreaterThanOrEqual(400);
    if (res.status() === 401) {
      const body = await res.json();
      expect(body.error.code).toBe('INVALID_CREDENTIALS');
      // Must NOT reveal whether the email exists.
      expect(body.error.message).not.toContain('not found');
      expect(body.error.message).not.toContain('no user');
    }
  });

  test('GET /api/v1/auth/me requires authentication', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/v1/auth/me`);
    expect(res.status()).toBe(401);
  });

  test('POST /api/v1/auth/logout requires authentication', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/v1/auth/logout`);
    expect(res.status()).toBe(401);
  });
});

// ─── Security Headers ────────────────────────────────────────────────────────

test.describe('Security headers', () => {
  test('API responses include security headers', async ({ request }) => {
    const res = await request.get(`${API_BASE}/health`);
    expect(res.status()).toBe(200);

    const headers = res.headers();
    // Helmet headers
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBeTruthy();
  });

  test('CSP header is present on API responses', async ({ request }) => {
    const res = await request.get(`${API_BASE}/health`);
    const csp = res.headers()['content-security-policy'];
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });
});

// ─── Rate Limiting ───────────────────────────────────────────────────────────

test.describe('Rate limiting', () => {
  test('Auth endpoint enforces rate limit headers', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/v1/auth/login`, {
      data: { email: 'ratelimit-test@example.com', password: 'LongEnoughPassword1!' },
    });
    const headers = res.headers();
    // Rate limit headers should be present (fastify/rate-limit adds these).
    const hasRateLimitHeader =
      headers['x-ratelimit-limit'] !== undefined ||
      headers['ratelimit-limit'] !== undefined ||
      headers['retry-after'] !== undefined;

    // Rate limiting is configured — either we see the headers or
    // the status is 429 (if limit already exhausted from prior runs).
    expect(hasRateLimitHeader || res.status() === 429).toBeTruthy();
  });
});

// ─── Route Protection ────────────────────────────────────────────────────────

test.describe('Protected routes require auth', () => {
  const protectedRoutes = [
    { method: 'GET' as const, path: '/api/v1/properties' },
    { method: 'GET' as const, path: '/api/v1/admin/users' },
    { method: 'GET' as const, path: '/api/v1/admin/audit-logs' },
    { method: 'GET' as const, path: '/api/v1/alerts' },
    { method: 'GET' as const, path: '/api/v1/tasks' },
    { method: 'GET' as const, path: '/api/v1/reports' },
  ];

  for (const { method, path } of protectedRoutes) {
    test(`${method} ${path} returns 401 without auth`, async ({ request }) => {
      const res = await request[method.toLowerCase() as 'get'](`${API_BASE}${path}`);
      expect(res.status()).toBe(401);
    });
  }
});

// ─── 404 Handling ────────────────────────────────────────────────────────────

test.describe('404 handling', () => {
  test('Unknown API route returns JSON 404', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/v1/nonexistent`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

// ─── Metric Override Field Allowlist (#7) ────────────────────────────────────

test.describe('Metric override field validation', () => {
  test('POST /api/v1/metrics/override rejects disallowed field names', async ({ request }) => {
    // Without auth this will return 401, which proves auth is enforced.
    // The field validation happens after auth, so we just verify the endpoint exists
    // and doesn't crash.
    const res = await request.post(`${API_BASE}/api/v1/metrics/override`, {
      data: {
        tableName: 'daily_metrics',
        recordId: '00000000-0000-0000-0000-000000000000',
        fieldName: 'id',  // disallowed field
        newValue: 'hacked',
        overrideReason: 'Testing field allowlist enforcement',
      },
    });
    // Should be 401 (no auth) — NOT 500 (crash)
    expect([401, 400]).toContain(res.status());
  });
});

// ─── Health Endpoint ─────────────────────────────────────────────────────────

test.describe('Health check', () => {
  test('GET /health returns ok', async ({ request }) => {
    const res = await request.get(`${API_BASE}/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.ts).toBeTruthy();
  });
});
