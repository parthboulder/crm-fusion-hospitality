-- Seed daily_hotel_performance with 30 days of realistic demo data for all 21 properties.
-- Generates data for the last 30 days so the dashboard has something to display.

DO $$
DECLARE
  d DATE;
  day_offset INTEGER;
  prop RECORD;
  occ NUMERIC;
  adr_val NUMERIC;
  revpar NUMERIC;
  rooms_avail INTEGER;
  rooms_sold INTEGER;
  ooo INTEGER;
  rev NUMERIC;
  rev_mtd NUMERIC;
  rev_ytd NUMERIC;
  py_rev NUMERIC;
  occ_mtd NUMERIC;
  occ_ytd NUMERIC;
  adr_mtd NUMERIC;
  adr_ytd NUMERIC;
  revpar_mtd NUMERIC;
  revpar_ytd NUMERIC;
  base_occ NUMERIC;
  base_adr NUMERIC;
BEGIN
  FOR prop IN
    SELECT * FROM (VALUES
      ('Candlewood Suites',                'IHG',          79),
      ('Holiday Inn Express Fulton',       'IHG',          75),
      ('Holiday Inn Express Memphis Southwind', 'IHG',     91),
      ('Holiday Inn Express Tupelo',       'IHG',         104),
      ('Holiday Inn Tupelo',               'IHG',         121),
      ('Holiday Inn Meridian',             'IHG',         121),
      ('Four Points Memphis Southwind',    'Marriott',     93),
      ('TownePlace Suites',               'Marriott',     97),
      ('Best Western Tupelo',              'Best Western', 73),
      ('SureStay Hotel',                   'Best Western', 68),
      ('Best Western Plus Olive Branch',   'Best Western', 87),
      ('Hyatt Place Biloxi',              'Hyatt',        117),
      ('Comfort Inn Tupelo',              'Choice',        58),
      ('HGI Olive Branch',                'Hilton',       121),
      ('Home2 Suites By Hilton',          'Hilton',        89),
      ('Tru By Hilton Tupelo',            'Hilton',        90),
      ('Hilton Garden Inn Meridian',       'Hilton',      133),
      ('Hampton Inn Meridian',             'Hilton',      116),
      ('Hampton Inn Vicksburg',            'Hilton',      123),
      ('DoubleTree Biloxi',               'Hilton',       195),
      ('Hilton Garden Inn Madison',        'Hilton',      134)
    ) AS t(name, grp, total_rooms)
  LOOP
    -- Each property gets a base occupancy (55-85%) and base ADR ($85-$165)
    -- seeded deterministically from the room count
    base_occ := 55 + (prop.total_rooms % 31);
    base_adr := 85 + (prop.total_rooms % 80);

    FOR day_offset IN 0..29 LOOP
      d := CURRENT_DATE - day_offset;

      -- Add daily variation: weekends higher occ, weekdays higher ADR
      IF EXTRACT(DOW FROM d) IN (0, 6) THEN
        occ := LEAST(base_occ + 8 + (day_offset % 7), 98);
        adr_val := base_adr - 5 + (day_offset % 11);
      ELSE
        occ := base_occ - 3 + (day_offset % 9);
        adr_val := base_adr + 8 + (day_offset % 13);
      END IF;

      rooms_avail := prop.total_rooms;
      ooo := CASE WHEN day_offset % 7 = 3 THEN (prop.total_rooms % 5) ELSE 0 END;
      rooms_sold := ROUND((rooms_avail - ooo) * occ / 100.0)::INTEGER;
      revpar := ROUND(occ * adr_val / 100.0, 2);
      rev := ROUND(rooms_sold * adr_val, 2);

      -- MTD / YTD approximations
      rev_mtd := rev * EXTRACT(DAY FROM d);
      rev_ytd := rev * (EXTRACT(DOY FROM d));
      occ_mtd := occ - 1.5 + (day_offset % 3);
      occ_ytd := occ - 2.0 + (day_offset % 4);
      adr_mtd := adr_val + 2.5;
      adr_ytd := adr_val + 1.8;
      revpar_mtd := ROUND(occ_mtd * adr_mtd / 100.0, 2);
      revpar_ytd := ROUND(occ_ytd * adr_ytd / 100.0, 2);

      -- Prior year: roughly 3-8% lower
      py_rev := ROUND(rev * (0.92 + (day_offset % 6) * 0.01), 2);

      INSERT INTO daily_hotel_performance (
        property_name, property_group, report_date,
        occupancy_day, occupancy_mtd, occupancy_ytd,
        adr_day, adr_mtd, adr_ytd,
        revpar_day, revpar_mtd, revpar_ytd,
        total_rooms_sold, total_rooms_available, ooo_rooms,
        revenue_day, revenue_mtd, revenue_ytd,
        py_revenue_day, py_revenue_mtd, py_revenue_ytd,
        report_format
      ) VALUES (
        prop.name, prop.grp, d,
        occ, occ_mtd, occ_ytd,
        adr_val, adr_mtd, adr_ytd,
        revpar, revpar_mtd, revpar_ytd,
        rooms_sold, rooms_avail, ooo,
        rev, rev_mtd, rev_ytd,
        py_rev, ROUND(py_rev * EXTRACT(DAY FROM d), 2), ROUND(py_rev * EXTRACT(DOY FROM d), 2),
        'demo-seed'
      )
      ON CONFLICT (property_name, report_date)
      DO UPDATE SET
        occupancy_day = EXCLUDED.occupancy_day,
        adr_day = EXCLUDED.adr_day,
        revpar_day = EXCLUDED.revpar_day,
        total_rooms_sold = EXCLUDED.total_rooms_sold,
        revenue_day = EXCLUDED.revenue_day,
        py_revenue_day = EXCLUDED.py_revenue_day,
        report_format = EXCLUDED.report_format;
    END LOOP;
  END LOOP;
END $$;
