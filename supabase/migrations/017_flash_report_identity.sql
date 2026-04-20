-- Robust identity + provenance for performance tables.
--
-- Why this migration exists:
--   * flash_report / daily_hotel_performance / engineering_ooo_rooms key rows
--     on TEXT property_name + report_date. Text-variant names ("Home2 Suites",
--     "Home2 Suites By Hilton", "Home 2 Suites by Hilton Tupelo, MS.") all
--     key as separate rows, so the UI sees duplicates and the Map coalesces
--     one of them. Stage 0 truncated these tables; this migration adds the
--     structural pieces so the new ingest pipeline can't recreate the mess.
--
-- What it does:
--   1. Tie every row back to the OCR job that produced it. Delete the job,
--      its derived flash row goes with it (ON DELETE CASCADE).
--   2. Record when the row was extracted so the API can deterministically
--      "pick the most recent row per (property_name, report_date)" if a
--      duplicate somehow sneaks in.
--   3. Carry a non-fatal needs_review flag so rows whose property name
--      couldn't be resolved to a canonical value are surfaced instead of
--      silently dropped.
--
-- What it does NOT do:
--   * Doesn't add a property_id FK — the UI identity today is the canonical
--     property_name string from stoneriver-properties.ts. Going the FK route
--     is a bigger schema + UI refactor we can do later; the resolver
--     described in the new code path already guarantees one canonical name
--     per hotel at ingest, which is enough to fix the "mixing" bug.

ALTER TABLE flash_report
  ADD COLUMN IF NOT EXISTS source_ocr_job_id UUID REFERENCES ocr_jobs(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS raw_property_name TEXT;

ALTER TABLE daily_hotel_performance
  ADD COLUMN IF NOT EXISTS source_ocr_job_id UUID REFERENCES ocr_jobs(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS raw_property_name TEXT;

ALTER TABLE engineering_ooo_rooms
  ADD COLUMN IF NOT EXISTS source_ocr_job_id UUID REFERENCES ocr_jobs(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS raw_property_name TEXT;

-- Ensure extracted_at exists everywhere (flash_report/engineering already
-- have it; this is defensive).
ALTER TABLE flash_report
  ALTER COLUMN extracted_at SET DEFAULT now();
ALTER TABLE daily_hotel_performance
  ALTER COLUMN extracted_at SET DEFAULT now();
ALTER TABLE engineering_ooo_rooms
  ALTER COLUMN extracted_at SET DEFAULT now();

-- Indexes for the new "latest row wins" API query shape.
CREATE INDEX IF NOT EXISTS flash_report_date_extracted_idx
  ON flash_report (report_date, extracted_at DESC);
CREATE INDEX IF NOT EXISTS daily_hotel_performance_date_extracted_idx
  ON daily_hotel_performance (report_date, extracted_at DESC);

-- Partial index so the Reviews admin can find problem rows fast.
CREATE INDEX IF NOT EXISTS flash_report_needs_review_idx
  ON flash_report (report_date) WHERE needs_review;
CREATE INDEX IF NOT EXISTS daily_hotel_performance_needs_review_idx
  ON daily_hotel_performance (report_date) WHERE needs_review;
