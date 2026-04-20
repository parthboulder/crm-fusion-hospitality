-- Separate the three date sources so we stop trying to reconcile them into
-- one column:
--   business_date        — canonical business day parsed from the PDF body
--                          (applies the night-audit -1 day convention).
--   report_generated_at  — timestamp the report was actually run (from the
--                          PDF body if present).
--   filename_date        — date parsed from the filename only. Kept as an
--                          audit trail; never treated as authoritative.
--
-- warnings — JSONB array of non-fatal anomaly flags raised during ingest.
-- Shape: [{ code: 'YEAR_MISMATCH', message: '...', detail: {...} }, ...]
-- Codes today:
--   YEAR_MISMATCH        — filename year differs from business-date year by
--                          1+ years (e.g. 03.25.2025 file dropped in a 2026
--                          folder; likely a PMS template with hardcoded year).
--   LATE_AUDIT           — report_generated_at - business_date > 1 day, i.e.
--                          the audit wasn't closed on time or was re-run.
--   DATE_SOURCE_MISSING  — no date found in PDF body; business_date fell back
--                          to filename which is unreliable.
--   FILENAME_DATE_DRIFT  — filename date differs from business_date by more
--                          than the expected night-audit offset (1 day).
--
-- date_folder is kept as-is for backwards compat with the existing OCR
-- Uploads UI filter. Going forward business_date is the source of truth.

ALTER TABLE ocr_jobs
  ADD COLUMN IF NOT EXISTS business_date       DATE,
  ADD COLUMN IF NOT EXISTS report_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS filename_date       DATE,
  ADD COLUMN IF NOT EXISTS warnings            JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS ocr_jobs_business_date_idx
  ON ocr_jobs (business_date);

CREATE INDEX IF NOT EXISTS ocr_jobs_report_generated_at_idx
  ON ocr_jobs (report_generated_at DESC);

-- Partial index — only rows with warnings (small subset of the table).
CREATE INDEX IF NOT EXISTS ocr_jobs_warnings_not_empty_idx
  ON ocr_jobs ((jsonb_array_length(warnings)))
  WHERE jsonb_array_length(warnings) > 0;
