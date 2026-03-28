-- Migration 003: Seed system roles + permissions
-- Creates the base RBAC data for the default org.

-- ─── Permissions ──────────────────────────────────────────────────────────────

INSERT INTO permissions (resource, action, description) VALUES
  ('properties',  'read',     'View properties'),
  ('properties',  'write',    'Create and update properties'),
  ('properties',  'delete',   'Delete properties'),
  ('reports',     'read',     'View reports'),
  ('reports',     'upload',   'Upload reports'),
  ('reports',     'review',   'Approve/reject extracted data'),
  ('reports',     'delete',   'Delete reports'),
  ('reports',     'download', 'Download report files'),
  ('metrics',     'read',     'View performance metrics'),
  ('metrics',     'override', 'Propose metric corrections'),
  ('metrics',     'approve',  'Approve metric overrides'),
  ('financials',  'read',     'View financial metrics'),
  ('alerts',      'read',     'View alerts'),
  ('alerts',      'acknowledge', 'Acknowledge alerts'),
  ('alerts',      'resolve',  'Resolve alerts'),
  ('tasks',       'read',     'View tasks'),
  ('tasks',       'create',   'Create tasks'),
  ('tasks',       'assign',   'Assign and update tasks'),
  ('tasks',       'complete', 'Mark tasks as completed'),
  ('admin',       'users',    'Manage users'),
  ('admin',       'roles',    'Manage roles'),
  ('admin',       'audit',    'View audit logs'),
  ('admin',       'sessions', 'Manage user sessions'),
  ('admin',       'properties', 'Admin-level property management'),
  ('ai',          'summaries', 'Generate AI summaries')
ON CONFLICT (resource, action) DO NOTHING;

-- ─── System Roles for Demo Org ────────────────────────────────────────────────

DO $$
DECLARE
  v_org_id UUID;
  v_role_id UUID;
  v_perm_ids UUID[];
BEGIN
  -- Create a demo organization.
  INSERT INTO organizations (name, slug, plan)
  VALUES ('Fusion Hospitality Group', 'fusion-hospitality', 'enterprise')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id INTO v_org_id;

  IF v_org_id IS NULL THEN
    SELECT id INTO v_org_id FROM organizations WHERE slug = 'fusion-hospitality';
  END IF;

  -- Super Admin.
  INSERT INTO roles (org_id, name, display_name, is_system)
  VALUES (v_org_id, 'super_admin', 'Super Admin', true)
  ON CONFLICT (org_id, name) DO NOTHING;

  SELECT id INTO v_role_id FROM roles WHERE org_id = v_org_id AND name = 'super_admin';
  SELECT ARRAY(SELECT id FROM permissions) INTO v_perm_ids;
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_role_id, unnest(v_perm_ids)
  ON CONFLICT DO NOTHING;

  -- Corporate.
  INSERT INTO roles (org_id, name, display_name, is_system)
  VALUES (v_org_id, 'corporate', 'Corporate', true)
  ON CONFLICT (org_id, name) DO NOTHING;

  SELECT id INTO v_role_id FROM roles WHERE org_id = v_org_id AND name = 'corporate';
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_role_id, id FROM permissions
  WHERE (resource, action) IN (
    ('properties','read'), ('reports','read'), ('reports','download'),
    ('metrics','read'), ('financials','read'), ('alerts','read'),
    ('alerts','acknowledge'), ('alerts','resolve'), ('tasks','read'),
    ('tasks','create'), ('tasks','assign'), ('ai','summaries'),
    ('admin','audit')
  )
  ON CONFLICT DO NOTHING;

  -- Regional Manager.
  INSERT INTO roles (org_id, name, display_name, is_system)
  VALUES (v_org_id, 'regional_manager', 'Regional Manager', true)
  ON CONFLICT (org_id, name) DO NOTHING;

  SELECT id INTO v_role_id FROM roles WHERE org_id = v_org_id AND name = 'regional_manager';
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_role_id, id FROM permissions
  WHERE (resource, action) IN (
    ('properties','read'), ('reports','read'), ('reports','upload'),
    ('reports','download'), ('metrics','read'), ('financials','read'),
    ('alerts','read'), ('alerts','acknowledge'), ('alerts','resolve'),
    ('tasks','read'), ('tasks','create'), ('tasks','assign'), ('ai','summaries')
  )
  ON CONFLICT DO NOTHING;

  -- General Manager.
  INSERT INTO roles (org_id, name, display_name, is_system)
  VALUES (v_org_id, 'general_manager', 'General Manager', true)
  ON CONFLICT (org_id, name) DO NOTHING;

  SELECT id INTO v_role_id FROM roles WHERE org_id = v_org_id AND name = 'general_manager';
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_role_id, id FROM permissions
  WHERE (resource, action) IN (
    ('properties','read'), ('reports','read'), ('reports','upload'),
    ('reports','download'), ('metrics','read'), ('alerts','read'),
    ('alerts','acknowledge'), ('tasks','read'), ('tasks','create'),
    ('tasks','complete'), ('ai','summaries')
  )
  ON CONFLICT DO NOTHING;

  -- Revenue Manager.
  INSERT INTO roles (org_id, name, display_name, is_system)
  VALUES (v_org_id, 'revenue_manager', 'Revenue Manager', true)
  ON CONFLICT (org_id, name) DO NOTHING;

  SELECT id INTO v_role_id FROM roles WHERE org_id = v_org_id AND name = 'revenue_manager';
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_role_id, id FROM permissions
  WHERE (resource, action) IN (
    ('properties','read'), ('reports','read'), ('reports','upload'),
    ('reports','download'), ('metrics','read'), ('alerts','read'),
    ('alerts','acknowledge'), ('tasks','read'), ('tasks','create'),
    ('ai','summaries')
  )
  ON CONFLICT DO NOTHING;

  -- Finance.
  INSERT INTO roles (org_id, name, display_name, is_system)
  VALUES (v_org_id, 'finance', 'Finance', true)
  ON CONFLICT (org_id, name) DO NOTHING;

  SELECT id INTO v_role_id FROM roles WHERE org_id = v_org_id AND name = 'finance';
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_role_id, id FROM permissions
  WHERE (resource, action) IN (
    ('properties','read'), ('reports','read'), ('reports','upload'),
    ('reports','download'), ('metrics','read'), ('financials','read'),
    ('metrics','override'), ('metrics','approve'), ('alerts','read'),
    ('alerts','acknowledge'), ('tasks','read'), ('tasks','create')
  )
  ON CONFLICT DO NOTHING;

  -- Operations.
  INSERT INTO roles (org_id, name, display_name, is_system)
  VALUES (v_org_id, 'operations', 'Operations', true)
  ON CONFLICT (org_id, name) DO NOTHING;

  SELECT id INTO v_role_id FROM roles WHERE org_id = v_org_id AND name = 'operations';
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_role_id, id FROM permissions
  WHERE (resource, action) IN (
    ('properties','read'), ('reports','read'), ('metrics','read'),
    ('alerts','read'), ('alerts','acknowledge'), ('tasks','read'),
    ('tasks','complete')
  )
  ON CONFLICT DO NOTHING;

  -- Read Only.
  INSERT INTO roles (org_id, name, display_name, is_system)
  VALUES (v_org_id, 'read_only', 'Read Only', true)
  ON CONFLICT (org_id, name) DO NOTHING;

  SELECT id INTO v_role_id FROM roles WHERE org_id = v_org_id AND name = 'read_only';
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_role_id, id FROM permissions
  WHERE (resource, action) IN (
    ('properties','read'), ('reports','read'), ('metrics','read'),
    ('alerts','read'), ('tasks','read')
  )
  ON CONFLICT DO NOTHING;

END $$;

-- ─── pg_cron: Scheduled jobs ──────────────────────────────────────────────────

-- Clean up expired sessions daily at 2 AM UTC.
SELECT cron.schedule(
  'cleanup-expired-sessions',
  '0 2 * * *',
  $$
    UPDATE user_sessions
    SET is_active = false
    WHERE is_active = true AND expires_at < now();
  $$
);

-- Expire AI summaries past valid_until every 30 minutes.
SELECT cron.schedule(
  'expire-ai-summaries',
  '*/30 * * * *',
  $$
    DELETE FROM ai_summaries
    WHERE valid_until IS NOT NULL AND valid_until < now() - INTERVAL '1 hour';
  $$
);
