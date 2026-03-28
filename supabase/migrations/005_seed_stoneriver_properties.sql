-- Migration 005: Seed Stoneriver HG properties (21 properties)
-- Inserts under the existing Fusion Hospitality Group organization.

DO $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT id INTO v_org_id FROM organizations WHERE slug = 'fusion-hospitality';

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization fusion-hospitality not found. Run migration 003 first.';
  END IF;

  INSERT INTO properties (org_id, name, brand, city, state, timezone, pms_type, metadata) VALUES

  -- ── Group 1: Hilton Standard ─────────────────────────────────────────────
  (v_org_id, 'HGI Olive Branch',          'Hilton',        'Olive Branch', 'MS', 'America/Chicago',
    'hilton_statistics',    '{"group":"Hilton","report_format":"Hilton Hotel Statistics"}'),

  (v_org_id, 'Tru By Hilton Tupelo',      'Hilton',        'Tupelo',       'MS', 'America/Chicago',
    'hilton_statistics',    '{"group":"Hilton","report_format":"Hilton Hotel Statistics"}'),

  (v_org_id, 'Hampton Inn Vicksburg',     'Hilton',        'Vicksburg',    'MS', 'America/Chicago',
    'hilton_statistics',    '{"group":"Hilton","report_format":"Hilton Hotel Statistics"}'),

  (v_org_id, 'DoubleTree Biloxi',         'Hilton',        'Biloxi',       'MS', 'America/Chicago',
    'hilton_statistics',    '{"group":"Hilton","report_format":"Hilton Hotel Statistics"}'),

  -- ── Group 2: Hilton Extended ─────────────────────────────────────────────
  (v_org_id, 'Home2 Suites By Hilton',    'Hilton',        'Biloxi',       'MS', 'America/Chicago',
    'hilton_statistics_ext','{"group":"Hilton Extended","report_format":"Hilton Hotel Statistics Extended"}'),

  (v_org_id, 'Hilton Garden Inn Madison', 'Hilton',        'Madison',      'MS', 'America/Chicago',
    'hilton_statistics_ext','{"group":"Hilton Extended","report_format":"Hilton Hotel Statistics Extended"}'),

  (v_org_id, 'Hilton Garden Inn Meridian','Hilton',        'Meridian',     'MS', 'America/Chicago',
    'hilton_statistics_ext','{"group":"Hilton Extended","report_format":"Hilton Hotel Statistics Extended"}'),

  (v_org_id, 'Hampton Inn Meridian',      'Hilton',        'Meridian',     'MS', 'America/Chicago',
    'hilton_statistics_ext','{"group":"Hilton Extended","report_format":"Hilton Hotel Statistics Extended"}'),

  -- ── Group 3: IHG ─────────────────────────────────────────────────────────
  (v_org_id, 'Holiday Inn Meridian',                   'IHG', 'Meridian', 'MS', 'America/Chicago',
    'ihg_manager_flash','{"group":"IHG","report_format":"IHG Manager Flash"}'),

  (v_org_id, 'Candlewood Suites',                      'IHG', 'Tupelo',   'MS', 'America/Chicago',
    'ihg_manager_flash','{"group":"IHG","report_format":"IHG Manager Flash"}'),

  (v_org_id, 'Holiday Inn Express Fulton',             'IHG', 'Fulton',   'MS', 'America/Chicago',
    'ihg_manager_flash','{"group":"IHG","report_format":"IHG Manager Flash"}'),

  (v_org_id, 'Holiday Inn Express Memphis Southwind',  'IHG', 'Memphis',  'TN', 'America/Chicago',
    'ihg_manager_flash','{"group":"IHG","report_format":"IHG Manager Flash"}'),

  (v_org_id, 'Holiday Inn Express Tupelo',             'IHG', 'Tupelo',   'MS', 'America/Chicago',
    'ihg_manager_flash','{"group":"IHG","report_format":"IHG Manager Flash"}'),

  (v_org_id, 'Holiday Inn Tupelo',                    'IHG', 'Tupelo',   'MS', 'America/Chicago',
    'ihg_manager_flash','{"group":"IHG","report_format":"IHG Manager Flash"}'),

  -- ── Group 4: Marriott (Four Points) ──────────────────────────────────────
  (v_org_id, 'Four Points Memphis Southwind', 'Marriott', 'Memphis', 'TN', 'America/Chicago',
    'marriott_manager_stats','{"group":"Marriott","report_format":"Marriott Manager Statistics"}'),

  -- ── Group 7: Marriott Revenue (TownePlace) ───────────────────────────────
  (v_org_id, 'TownePlace Suites',             'Marriott', 'Ridgeland','MS', 'America/Chicago',
    'marriott_revenue',     '{"group":"Marriott","report_format":"Marriott Revenue Report"}'),

  -- ── Group 5: Best Western ─────────────────────────────────────────────────
  (v_org_id, 'Best Western Tupelo',          'Best Western', 'Tupelo',       'MS', 'America/Chicago',
    'best_western_daily',   '{"group":"Best Western","report_format":"Best Western Daily"}'),

  (v_org_id, 'SureStay Hotel',               'Best Western', 'Tupelo',       'MS', 'America/Chicago',
    'best_western_daily',   '{"group":"Best Western","report_format":"Best Western Daily"}'),

  (v_org_id, 'Best Western Plus Olive Branch','Best Western','Olive Branch',  'MS', 'America/Chicago',
    'best_western_daily',   '{"group":"Best Western","report_format":"Best Western Daily"}'),

  -- ── Group 6: Hyatt ───────────────────────────────────────────────────────
  (v_org_id, 'Hyatt Place Biloxi',           'Hyatt',  'Biloxi',      'MS', 'America/Chicago',
    'hyatt_manager_flash',  '{"group":"Hyatt","report_format":"Hyatt Manager Flash"}'),

  -- ── Group 8: Choice ──────────────────────────────────────────────────────
  (v_org_id, 'Comfort Inn Tupelo',           'Choice', 'Tupelo',      'MS', 'America/Chicago',
    'choice_statistics',    '{"group":"Choice","report_format":"Choice Hotels Statistics"}')

  ON CONFLICT DO NOTHING;

END $$;
