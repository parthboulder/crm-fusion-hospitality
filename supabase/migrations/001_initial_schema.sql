-- Migration 001: Initial schema
-- Run via: supabase db push

-- Enable required extensions.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- ─── Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE report_status AS ENUM (
  'pending', 'processing', 'extracted', 'review_required', 'approved', 'failed'
);

CREATE TYPE alert_severity AS ENUM ('critical', 'high', 'medium', 'low');
CREATE TYPE alert_status AS ENUM ('open', 'acknowledged', 'resolved', 'dismissed');
CREATE TYPE task_priority AS ENUM ('critical', 'high', 'medium', 'low');
CREATE TYPE task_status AS ENUM ('open', 'in_progress', 'blocked', 'completed', 'cancelled');
CREATE TYPE virus_scan_status AS ENUM ('pending', 'clean', 'infected', 'error');

-- ─── Organizations ────────────────────────────────────────────────────────────

CREATE TABLE organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  plan        TEXT NOT NULL DEFAULT 'enterprise',
  settings    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Properties ───────────────────────────────────────────────────────────────

CREATE TABLE properties (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  brand         TEXT,
  brand_code    TEXT,
  address       TEXT,
  city          TEXT,
  state         TEXT,
  country       TEXT NOT NULL DEFAULT 'US',
  timezone      TEXT NOT NULL DEFAULT 'America/New_York',
  total_rooms   INTEGER,
  pms_type      TEXT,
  adr_floor     NUMERIC(12,2),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_properties_org_id ON properties(org_id);
CREATE INDEX idx_properties_brand ON properties(brand);

-- ─── RBAC ─────────────────────────────────────────────────────────────────────

CREATE TABLE roles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description  TEXT,
  is_system    BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, name)
);

CREATE TABLE permissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource    TEXT NOT NULL,
  action      TEXT NOT NULL,
  description TEXT,
  UNIQUE(resource, action)
);

CREATE TABLE role_permissions (
  role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY(role_id, permission_id)
);

CREATE TABLE user_profiles (
  id            UUID PRIMARY KEY,  -- matches auth.users.id
  org_id        UUID NOT NULL REFERENCES organizations(id),
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL,
  phone         TEXT,
  avatar_url    TEXT,
  role_id       UUID NOT NULL REFERENCES roles(id),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  mfa_enabled   BOOLEAN NOT NULL DEFAULT false,
  last_login_at TIMESTAMPTZ,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_profiles_org_id ON user_profiles(org_id);
CREATE INDEX idx_user_profiles_role_id ON user_profiles(role_id);

CREATE TABLE user_property_access (
  user_id     UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  granted_by  UUID NOT NULL,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, property_id)
);

CREATE TABLE user_sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  token_hash            TEXT NOT NULL,
  ip_address            INET,
  user_agent            TEXT,
  device_fingerprint    TEXT,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  last_activity         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at            TIMESTAMPTZ NOT NULL,
  revoked_at            TIMESTAMPTZ,
  revoked_by            UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_sessions_user_active ON user_sessions(user_id, is_active);
CREATE INDEX idx_user_sessions_token ON user_sessions(token_hash);

-- ─── Reports ──────────────────────────────────────────────────────────────────

CREATE TABLE reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organizations(id),
  property_id      UUID NOT NULL REFERENCES properties(id),
  report_type      TEXT NOT NULL,
  report_date      DATE NOT NULL,
  reporting_period TEXT,
  source           TEXT NOT NULL,
  status           report_status NOT NULL DEFAULT 'pending',
  confidence_score NUMERIC(5,4),
  requires_review  BOOLEAN NOT NULL DEFAULT false,
  reviewed_by      UUID REFERENCES user_profiles(id),
  reviewed_at      TIMESTAMPTZ,
  review_notes     TEXT,
  uploaded_by      UUID REFERENCES user_profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reports_property_date ON reports(property_id, report_date DESC);
CREATE INDEX idx_reports_type ON reports(report_type);
CREATE INDEX idx_reports_status ON reports(status);
CREATE INDEX idx_reports_org_id ON reports(org_id);

CREATE TABLE report_files (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id         UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  storage_path      TEXT NOT NULL,
  original_name     TEXT NOT NULL,
  mime_type         TEXT NOT NULL,
  file_size_bytes   BIGINT NOT NULL,
  checksum_sha256   TEXT NOT NULL,
  virus_scan_status virus_scan_status NOT NULL DEFAULT 'pending',
  virus_scan_at     TIMESTAMPTZ,
  version           INTEGER NOT NULL DEFAULT 1,
  is_current        BOOLEAN NOT NULL DEFAULT true,
  uploaded_by       UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_report_files_report_id ON report_files(report_id);

CREATE TABLE extraction_jobs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id      UUID NOT NULL REFERENCES reports(id),
  model_used     TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  prompt_version TEXT NOT NULL,
  tokens_used    INTEGER,
  cost_usd       NUMERIC(10,6),
  duration_ms    INTEGER,
  status         TEXT NOT NULL DEFAULT 'pending',
  error_message  TEXT,
  raw_response   JSONB,
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_extraction_jobs_report_id ON extraction_jobs(report_id);

-- ─── Metrics ──────────────────────────────────────────────────────────────────

CREATE TABLE daily_metrics (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id             UUID NOT NULL REFERENCES reports(id),
  property_id           UUID NOT NULL REFERENCES properties(id),
  metric_date           DATE NOT NULL,
  total_rooms           INTEGER,
  rooms_sold            INTEGER,
  rooms_ooo             INTEGER,
  rooms_complimentary   INTEGER,
  occupancy_pct         NUMERIC(7,4),
  adr                   NUMERIC(12,2),
  revpar                NUMERIC(12,2),
  total_revenue         NUMERIC(14,2),
  room_revenue          NUMERIC(14,2),
  fb_revenue            NUMERIC(14,2),
  other_revenue         NUMERIC(14,2),
  py_total_revenue      NUMERIC(14,2),
  py_room_revenue       NUMERIC(14,2),
  py_occupancy_pct      NUMERIC(7,4),
  py_adr                NUMERIC(12,2),
  py_revpar             NUMERIC(12,2),
  budget_occupancy_pct  NUMERIC(7,4),
  budget_adr            NUMERIC(12,2),
  budget_revpar         NUMERIC(12,2),
  budget_total_revenue  NUMERIC(14,2),
  forecast_occupancy_pct NUMERIC(7,4),
  forecast_revenue      NUMERIC(14,2),
  confidence_score      NUMERIC(5,4),
  extraction_notes      TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(property_id, metric_date)
);

CREATE INDEX idx_daily_metrics_report_id ON daily_metrics(report_id);
CREATE INDEX idx_daily_metrics_property_date ON daily_metrics(property_id, metric_date DESC);

CREATE TABLE financial_metrics (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id           UUID NOT NULL REFERENCES reports(id),
  property_id         UUID NOT NULL REFERENCES properties(id),
  metric_date         DATE NOT NULL,
  ar_current          NUMERIC(14,2),
  ar_30_days          NUMERIC(14,2),
  ar_60_days          NUMERIC(14,2),
  ar_90_days          NUMERIC(14,2),
  ar_90_plus_days     NUMERIC(14,2),
  ar_total            NUMERIC(14,2),
  cc_visa             NUMERIC(14,2),
  cc_mastercard       NUMERIC(14,2),
  cc_amex             NUMERIC(14,2),
  cc_discover         NUMERIC(14,2),
  cc_other            NUMERIC(14,2),
  cc_total            NUMERIC(14,2),
  cc_disputes         NUMERIC(14,2),
  cash_sales          NUMERIC(14,2),
  cash_deposits       NUMERIC(14,2),
  cash_variance       NUMERIC(14,2),
  adjustments_total   NUMERIC(14,2),
  voids_total         NUMERIC(14,2),
  comps_total         NUMERIC(14,2),
  discounts_total     NUMERIC(14,2),
  tax_collected       NUMERIC(14,2),
  tax_exempt_total    NUMERIC(14,2),
  guest_ledger_balance NUMERIC(14,2),
  advance_deposits    NUMERIC(14,2),
  confidence_score    NUMERIC(5,4),
  extraction_notes    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(property_id, metric_date)
);

CREATE INDEX idx_financial_metrics_report_id ON financial_metrics(report_id);

CREATE TABLE metric_overrides (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name       TEXT NOT NULL,
  record_id        UUID NOT NULL,
  field_name       TEXT NOT NULL,
  old_value        TEXT,
  new_value        TEXT NOT NULL,
  override_reason  TEXT NOT NULL,
  approved_by      UUID REFERENCES user_profiles(id),
  approved_at      TIMESTAMPTZ,
  requires_approval BOOLEAN NOT NULL DEFAULT true,
  created_by       UUID NOT NULL REFERENCES user_profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Alerts ───────────────────────────────────────────────────────────────────

CREATE TABLE alerts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organizations(id),
  property_id      UUID NOT NULL REFERENCES properties(id),
  report_id        UUID REFERENCES reports(id),
  alert_type       TEXT NOT NULL,
  severity         alert_severity NOT NULL,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL,
  metric_name      TEXT,
  metric_value     NUMERIC(14,4),
  threshold_value  NUMERIC(14,4),
  prior_value      NUMERIC(14,4),
  pct_change       NUMERIC(7,4),
  status           alert_status NOT NULL DEFAULT 'open',
  acknowledged_by  UUID REFERENCES user_profiles(id),
  acknowledged_at  TIMESTAMPTZ,
  resolved_by      UUID REFERENCES user_profiles(id),
  resolved_at      TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_alerts_property_date ON alerts(property_id, created_at DESC);
CREATE INDEX idx_alerts_severity_status ON alerts(severity, status);
CREATE INDEX idx_alerts_org_id ON alerts(org_id);

-- ─── Tasks ────────────────────────────────────────────────────────────────────

CREATE TABLE tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id),
  property_id  UUID NOT NULL REFERENCES properties(id),
  alert_id     UUID REFERENCES alerts(id),
  title        TEXT NOT NULL,
  description  TEXT,
  task_type    TEXT NOT NULL,
  priority     task_priority NOT NULL,
  status       task_status NOT NULL DEFAULT 'open',
  assigned_to  UUID REFERENCES user_profiles(id),
  assigned_by  UUID REFERENCES user_profiles(id),
  due_date     DATE,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_property_id ON tasks(property_id);
CREATE INDEX idx_tasks_assigned_status ON tasks(assigned_to, status);

CREATE TABLE task_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id  UUID NOT NULL REFERENCES user_profiles(id),
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_comments_task_id ON task_comments(task_id);

-- ─── AI ───────────────────────────────────────────────────────────────────────

CREATE TABLE ai_summaries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id),
  scope         TEXT NOT NULL,
  scope_id      UUID NOT NULL,
  summary_type  TEXT NOT NULL,
  content       TEXT NOT NULL,
  model_used    TEXT NOT NULL,
  tokens_used   INTEGER,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until   TIMESTAMPTZ,
  metadata      JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_ai_summaries_scope ON ai_summaries(scope, scope_id, generated_at DESC);

-- ─── Audit Logs ───────────────────────────────────────────────────────────────

CREATE TABLE audit_logs (
  id             BIGSERIAL PRIMARY KEY,
  org_id         UUID,
  user_id        UUID,
  session_id     TEXT,
  action         TEXT NOT NULL,
  resource_type  TEXT NOT NULL,
  resource_id    TEXT,
  before_value   JSONB,
  after_value    JSONB,
  ip_address     INET,
  user_agent     TEXT,
  request_id     TEXT,
  result         TEXT NOT NULL DEFAULT 'success',
  failure_reason TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_user_date ON audit_logs(user_id, created_at DESC);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_org_date ON audit_logs(org_id, created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs(action, created_at DESC);

-- ─── updated_at triggers ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_organizations_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_properties_updated_at BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_user_profiles_updated_at BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_reports_updated_at BEFORE UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_daily_metrics_updated_at BEFORE UPDATE ON daily_metrics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_financial_metrics_updated_at BEFORE UPDATE ON financial_metrics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_alerts_updated_at BEFORE UPDATE ON alerts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
