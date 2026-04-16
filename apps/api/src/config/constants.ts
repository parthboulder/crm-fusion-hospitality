/**
 * Application-wide constants — thresholds, enums, and limits.
 */

// ─── Report Types ─────────────────────────────────────────────────────────────

export const REPORT_TYPES = [
  'ar_aging',
  'credit_card_transactions',
  'daily_report',
  'downtime_report',
  'financial_payment_revenue',
  'guest_ledger',
  'manager_flash',
  'occupancy_forecast',
  'operator_adjustments_voids',
  'cash_out',
  'out_of_order',
  'reservation_report',
  'revenue_summary',
  'trial_balance',
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

// ─── Roles ────────────────────────────────────────────────────────────────────

export const SYSTEM_ROLES = [
  'super_admin',
  'corporate',
  'regional_manager',
  'general_manager',
  'revenue_manager',
  'finance',
  'operations',
  'read_only',
] as const;

export type SystemRole = (typeof SYSTEM_ROLES)[number];

// ─── Alert Thresholds ─────────────────────────────────────────────────────────

export const ALERT_THRESHOLDS = {
  OCCUPANCY_DROP_PCT: 10,       // > 10 % YoY drop triggers alert
  REVENUE_DROP_PCT: 15,         // > 15 % YoY drop triggers alert
  ADR_BELOW_FLOOR_PCT: 5,       // ADR more than 5 % below property floor
  AR_90_PLUS_THRESHOLD_PCT: 20, // > 20 % of AR in 90+ bucket
  ADJUSTMENTS_HIGH_PCT: 5,      // adjustments > 5 % of room revenue
  VOIDS_HIGH_PCT: 3,            // voids > 3 % of room revenue
  OOO_ROOMS_HIGH_PCT: 10,       // > 10 % of inventory OOO
  CASH_VARIANCE_ABS: 500,       // absolute cash variance > $500
  CONFIDENCE_LOW: 0.75,         // extraction confidence below 75 %
} as const;

// ─── Severity Levels ──────────────────────────────────────────────────────────

export const SEVERITY = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
} as const;

// ─── Processing Statuses ──────────────────────────────────────────────────────

export const REPORT_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  EXTRACTED: 'extracted',
  REVIEW_REQUIRED: 'review_required',
  NOT_CLASSIFIED: 'not_classified',
  NEEDS_REVIEW: 'needs_review',
  APPROVED: 'approved',
  FAILED: 'failed',
  DUPLICATE: 'duplicate',
} as const;

// ─── Permissions ──────────────────────────────────────────────────────────────

export const PERMISSIONS = {
  // Properties
  PROPERTIES_READ: 'properties:read',
  PROPERTIES_WRITE: 'properties:write',
  PROPERTIES_DELETE: 'properties:delete',
  // Reports
  REPORTS_READ: 'reports:read',
  REPORTS_UPLOAD: 'reports:upload',
  REPORTS_REVIEW: 'reports:review',
  REPORTS_DELETE: 'reports:delete',
  REPORTS_DOWNLOAD: 'reports:download',
  // Metrics
  METRICS_READ: 'metrics:read',
  METRICS_OVERRIDE: 'metrics:override',
  METRICS_APPROVE: 'metrics:approve',
  // Financials
  FINANCIALS_READ: 'financials:read',
  // Alerts
  ALERTS_READ: 'alerts:read',
  ALERTS_ACKNOWLEDGE: 'alerts:acknowledge',
  ALERTS_RESOLVE: 'alerts:resolve',
  // Tasks
  TASKS_READ: 'tasks:read',
  TASKS_CREATE: 'tasks:create',
  TASKS_ASSIGN: 'tasks:assign',
  TASKS_COMPLETE: 'tasks:complete',
  // Admin
  ADMIN_USERS: 'admin:users',
  ADMIN_ROLES: 'admin:roles',
  ADMIN_AUDIT: 'admin:audit',
  ADMIN_SESSIONS: 'admin:sessions',
  ADMIN_PROPERTIES: 'admin:properties',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// ─── RBAC Matrix ──────────────────────────────────────────────────────────────
// Maps each system role to its allowed permissions.

export const ROLE_PERMISSIONS: Record<SystemRole, Permission[]> = {
  super_admin: Object.values(PERMISSIONS) as Permission[],

  corporate: [
    PERMISSIONS.PROPERTIES_READ,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.REPORTS_DOWNLOAD,
    PERMISSIONS.METRICS_READ,
    PERMISSIONS.FINANCIALS_READ,
    PERMISSIONS.ALERTS_READ,
    PERMISSIONS.ALERTS_ACKNOWLEDGE,
    PERMISSIONS.ALERTS_RESOLVE,
    PERMISSIONS.TASKS_READ,
    PERMISSIONS.TASKS_CREATE,
    PERMISSIONS.TASKS_ASSIGN,
    PERMISSIONS.ADMIN_AUDIT,
  ],

  regional_manager: [
    PERMISSIONS.PROPERTIES_READ,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.REPORTS_UPLOAD,
    PERMISSIONS.REPORTS_DOWNLOAD,
    PERMISSIONS.METRICS_READ,
    PERMISSIONS.FINANCIALS_READ,
    PERMISSIONS.ALERTS_READ,
    PERMISSIONS.ALERTS_ACKNOWLEDGE,
    PERMISSIONS.ALERTS_RESOLVE,
    PERMISSIONS.TASKS_READ,
    PERMISSIONS.TASKS_CREATE,
    PERMISSIONS.TASKS_ASSIGN,
  ],

  general_manager: [
    PERMISSIONS.PROPERTIES_READ,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.REPORTS_UPLOAD,
    PERMISSIONS.REPORTS_DOWNLOAD,
    PERMISSIONS.METRICS_READ,
    PERMISSIONS.ALERTS_READ,
    PERMISSIONS.ALERTS_ACKNOWLEDGE,
    PERMISSIONS.TASKS_READ,
    PERMISSIONS.TASKS_CREATE,
    PERMISSIONS.TASKS_COMPLETE,
  ],

  revenue_manager: [
    PERMISSIONS.PROPERTIES_READ,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.REPORTS_UPLOAD,
    PERMISSIONS.REPORTS_DOWNLOAD,
    PERMISSIONS.METRICS_READ,
    PERMISSIONS.ALERTS_READ,
    PERMISSIONS.ALERTS_ACKNOWLEDGE,
    PERMISSIONS.TASKS_READ,
    PERMISSIONS.TASKS_CREATE,
  ],

  finance: [
    PERMISSIONS.PROPERTIES_READ,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.REPORTS_UPLOAD,
    PERMISSIONS.REPORTS_DOWNLOAD,
    PERMISSIONS.METRICS_READ,
    PERMISSIONS.FINANCIALS_READ,
    PERMISSIONS.METRICS_OVERRIDE,
    PERMISSIONS.METRICS_APPROVE,
    PERMISSIONS.ALERTS_READ,
    PERMISSIONS.ALERTS_ACKNOWLEDGE,
    PERMISSIONS.TASKS_READ,
    PERMISSIONS.TASKS_CREATE,
  ],

  operations: [
    PERMISSIONS.PROPERTIES_READ,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.METRICS_READ,
    PERMISSIONS.ALERTS_READ,
    PERMISSIONS.ALERTS_ACKNOWLEDGE,
    PERMISSIONS.TASKS_READ,
    PERMISSIONS.TASKS_COMPLETE,
  ],

  read_only: [
    PERMISSIONS.PROPERTIES_READ,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.METRICS_READ,
    PERMISSIONS.ALERTS_READ,
    PERMISSIONS.TASKS_READ,
  ],
};
