-- Add classification columns to ocr_jobs so the OCR Uploads page can filter
-- by property, date, report type, and category. Populated at upload time
-- (filename-only, low confidence) and refined by the OCR worker once the
-- document text is extracted.

ALTER TABLE ocr_jobs
  ADD COLUMN IF NOT EXISTS property        TEXT,
  ADD COLUMN IF NOT EXISTS date_folder     TEXT,
  ADD COLUMN IF NOT EXISTS report_type     TEXT,
  ADD COLUMN IF NOT EXISTS report_category TEXT;

CREATE INDEX IF NOT EXISTS ocr_jobs_property_idx        ON ocr_jobs (property);
CREATE INDEX IF NOT EXISTS ocr_jobs_date_folder_idx     ON ocr_jobs (date_folder);
CREATE INDEX IF NOT EXISTS ocr_jobs_report_type_idx     ON ocr_jobs (report_type);
CREATE INDEX IF NOT EXISTS ocr_jobs_report_category_idx ON ocr_jobs (report_category);
