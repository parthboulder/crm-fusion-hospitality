-- Run this in Supabase SQL Editor after creating the auth user.
-- Replace the UUID on the next line with the one from Authentication → Users.

DO $$
DECLARE
  v_user_id   UUID := 'a287489e-df22-4ae7-93e2-73324144560c';
  v_org_id    UUID;
  v_role_id   UUID;
BEGIN
  SELECT id INTO v_org_id FROM organizations WHERE slug = 'fusion-hospitality';
  SELECT id INTO v_role_id FROM roles WHERE org_id = v_org_id AND name = 'super_admin';

  INSERT INTO user_profiles (id, org_id, full_name, email, role_id, is_active, mfa_enabled)
  VALUES (v_user_id, v_org_id, 'Uma Patel', 'uma@boulderconstruction.com', v_role_id, true, false)
  ON CONFLICT (id) DO NOTHING;
END $$;
