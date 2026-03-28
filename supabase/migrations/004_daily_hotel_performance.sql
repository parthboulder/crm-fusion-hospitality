-- Daily hotel performance data extracted from nightly PMS reports.
-- One row per property per date. Source report format tracked for traceability.

CREATE TABLE IF NOT EXISTS daily_hotel_performance (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  property_name TEXT NOT NULL,
  property_group TEXT NOT NULL,
  report_date DATE NOT NULL,

  -- Occupancy
  occupancy_day  NUMERIC(5,2),
  occupancy_mtd  NUMERIC(5,2),
  occupancy_ytd  NUMERIC(5,2),

  -- ADR
  adr_day  NUMERIC(10,2),
  adr_mtd  NUMERIC(10,2),
  adr_ytd  NUMERIC(10,2),

  -- RevPAR
  revpar_day  NUMERIC(10,2),
  revpar_mtd  NUMERIC(10,2),
  revpar_ytd  NUMERIC(10,2),

  -- Room stats
  total_rooms_sold      INTEGER,
  total_rooms_available INTEGER,
  ooo_rooms             INTEGER DEFAULT 0,

  -- Revenue
  revenue_day  NUMERIC(12,2),
  revenue_mtd  NUMERIC(12,2),
  revenue_ytd  NUMERIC(12,2),

  -- Prior year
  py_revenue_day  NUMERIC(12,2),
  py_revenue_mtd  NUMERIC(12,2),
  py_revenue_ytd  NUMERIC(12,2),

  -- Metadata
  report_format  TEXT,
  extracted_at   TIMESTAMPTZ DEFAULT NOW(),
  created_at     TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(property_name, report_date)
);

CREATE INDEX IF NOT EXISTS idx_dhp_date          ON daily_hotel_performance(report_date DESC);
CREATE INDEX IF NOT EXISTS idx_dhp_property_date ON daily_hotel_performance(property_name, report_date DESC);

-- RLS: allow anon read (dashboard uses anon key), restrict writes to service role
ALTER TABLE daily_hotel_performance ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "anon can read daily_hotel_performance"
    ON daily_hotel_performance FOR SELECT
    TO anon, authenticated
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "service role can insert daily_hotel_performance"
    ON daily_hotel_performance FOR INSERT
    TO service_role
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "service role can update daily_hotel_performance"
    ON daily_hotel_performance FOR UPDATE
    TO service_role
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
