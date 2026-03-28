-- Migration 002: Row-Level Security policies
-- Enforces property-level data isolation at the DB layer.

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_property_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE metric_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- ─── Helper functions ─────────────────────────────────────────────────────────

-- Get the org_id for the current authenticated user.
CREATE OR REPLACE FUNCTION auth_org_id() RETURNS UUID AS $$
  SELECT org_id FROM user_profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Get the role name for the current authenticated user.
CREATE OR REPLACE FUNCTION auth_role_name() RETURNS TEXT AS $$
  SELECT r.name FROM user_profiles up
  JOIN roles r ON r.id = up.role_id
  WHERE up.id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Check if current user has access to a specific property.
CREATE OR REPLACE FUNCTION can_access_property(p_property_id UUID) RETURNS BOOLEAN AS $$
  SELECT CASE
    WHEN auth_role_name() IN ('super_admin', 'corporate') THEN true
    ELSE EXISTS (
      SELECT 1 FROM user_property_access
      WHERE user_id = auth.uid() AND property_id = p_property_id
    )
  END;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ─── Organizations ────────────────────────────────────────────────────────────

CREATE POLICY "users_see_own_org" ON organizations
  FOR SELECT USING (id = auth_org_id());

-- ─── Properties ───────────────────────────────────────────────────────────────

CREATE POLICY "users_see_accessible_properties" ON properties
  FOR SELECT USING (org_id = auth_org_id() AND can_access_property(id));

CREATE POLICY "admins_write_properties" ON properties
  FOR ALL USING (
    org_id = auth_org_id() AND
    auth_role_name() IN ('super_admin', 'corporate')
  );

-- ─── User Profiles ────────────────────────────────────────────────────────────

CREATE POLICY "users_see_own_org_profiles" ON user_profiles
  FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "users_see_own_profile" ON user_profiles
  FOR UPDATE USING (id = auth.uid());

CREATE POLICY "admins_manage_users" ON user_profiles
  FOR ALL USING (
    org_id = auth_org_id() AND
    auth_role_name() IN ('super_admin', 'corporate')
  );

-- ─── Sessions ─────────────────────────────────────────────────────────────────

CREATE POLICY "users_see_own_sessions" ON user_sessions
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "admins_see_all_sessions" ON user_sessions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.org_id = (
        SELECT org_id FROM user_profiles WHERE id = user_sessions.user_id
      )
    ) AND auth_role_name() IN ('super_admin')
  );

-- ─── Reports ──────────────────────────────────────────────────────────────────

CREATE POLICY "users_see_accessible_reports" ON reports
  FOR SELECT USING (
    org_id = auth_org_id() AND can_access_property(property_id)
  );

CREATE POLICY "users_upload_reports" ON reports
  FOR INSERT WITH CHECK (
    org_id = auth_org_id() AND
    can_access_property(property_id) AND
    auth_role_name() IN ('super_admin', 'corporate', 'regional_manager', 'general_manager', 'revenue_manager', 'finance')
  );

CREATE POLICY "reviewers_update_reports" ON reports
  FOR UPDATE USING (
    org_id = auth_org_id() AND
    auth_role_name() IN ('super_admin', 'corporate', 'regional_manager', 'finance')
  );

-- ─── Report Files ─────────────────────────────────────────────────────────────

CREATE POLICY "users_see_accessible_report_files" ON report_files
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM reports r
      WHERE r.id = report_files.report_id
        AND r.org_id = auth_org_id()
        AND can_access_property(r.property_id)
    )
  );

-- ─── Daily Metrics ────────────────────────────────────────────────────────────

CREATE POLICY "users_see_accessible_metrics" ON daily_metrics
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM properties p
      WHERE p.id = daily_metrics.property_id
        AND p.org_id = auth_org_id()
        AND can_access_property(p.id)
    )
  );

-- ─── Financial Metrics ────────────────────────────────────────────────────────

-- Finance and above only.
CREATE POLICY "finance_roles_see_financials" ON financial_metrics
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM properties p
      WHERE p.id = financial_metrics.property_id
        AND p.org_id = auth_org_id()
        AND can_access_property(p.id)
    ) AND auth_role_name() IN ('super_admin', 'corporate', 'finance', 'regional_manager')
  );

-- ─── Alerts ───────────────────────────────────────────────────────────────────

CREATE POLICY "users_see_accessible_alerts" ON alerts
  FOR SELECT USING (
    org_id = auth_org_id() AND can_access_property(property_id)
  );

CREATE POLICY "users_update_accessible_alerts" ON alerts
  FOR UPDATE USING (
    org_id = auth_org_id() AND
    can_access_property(property_id) AND
    auth_role_name() IN ('super_admin', 'corporate', 'regional_manager', 'general_manager', 'finance')
  );

-- ─── Tasks ────────────────────────────────────────────────────────────────────

CREATE POLICY "users_see_accessible_tasks" ON tasks
  FOR SELECT USING (
    org_id = auth_org_id() AND can_access_property(property_id)
  );

CREATE POLICY "task_managers_write_tasks" ON tasks
  FOR ALL USING (
    org_id = auth_org_id() AND
    can_access_property(property_id) AND
    auth_role_name() IN ('super_admin', 'corporate', 'regional_manager', 'general_manager', 'finance', 'revenue_manager')
  );

-- ─── Audit Logs ───────────────────────────────────────────────────────────────

-- Read-only; only admins can view.
CREATE POLICY "admins_view_audit_logs" ON audit_logs
  FOR SELECT USING (
    org_id = auth_org_id() AND
    auth_role_name() IN ('super_admin', 'corporate')
  );

-- Service role can insert (via API server).
CREATE POLICY "service_insert_audit_logs" ON audit_logs
  FOR INSERT WITH CHECK (true);  -- restricted to service_role via application layer

-- ─── AI Summaries ─────────────────────────────────────────────────────────────

CREATE POLICY "users_see_org_summaries" ON ai_summaries
  FOR SELECT USING (org_id = auth_org_id());
