/**
 * Mock data stubs — returns empty arrays / null values.
 * No sample data, no fake records. The system shows empty states
 * until real data is uploaded.
 *
 * Activated when VITE_MOCK=true (set in .env.development).
 */

export const MOCK_USER = {
  id: 'usr-001',
  email: 'admin@localhost',
  fullName: 'Dev User',
  role: 'super_admin',
  orgId: 'org-001',
  permissions: [
    'properties:read', 'reports:read', 'reports:upload', 'reports:download',
    'reports:review', 'metrics:read', 'financials:read', 'alerts:read',
    'alerts:acknowledge', 'alerts:resolve', 'tasks:read', 'tasks:create',
    'tasks:assign', 'ai:summaries', 'admin:audit', 'admin:users',
    'admin:roles', 'admin:sessions',
  ],
};

export const MOCK_PROPERTIES: unknown[] = [];

export const MOCK_DAILY_METRICS: unknown[] = [];

export const MOCK_TREND_DATA: unknown[] = [];

export const MOCK_ALERTS: unknown[] = [];

export const MOCK_TASKS: unknown[] = [];

export const MOCK_REPORTS: unknown[] = [];

export const MOCK_AUDIT_LOGS: unknown[] = [];

export const MOCK_USERS: unknown[] = [];

export const MOCK_ROLES: unknown[] = [];

export const MOCK_AI_SUMMARY = '';

export const MOCK_PORTFOLIO_SUMMARY = {
  todayMetrics: {
    _sum: { totalRevenue: '0', roomRevenue: '0', roomsSold: 0 },
    _avg: { occupancyPct: '0', adr: '0', revpar: '0' },
    _count: { id: 0 },
  },
  openAlerts: [],
};
