-- ─── ocr_jobs ────────────────────────────────────────────────────────────────
-- Standalone OCR pipeline. Independent of reports/report_files.

CREATE TABLE IF NOT EXISTS ocr_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID REFERENCES organizations(id) ON DELETE SET NULL,
  uploaded_by      UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  original_name    TEXT NOT NULL,
  storage_path     TEXT NOT NULL,
  file_url         TEXT,
  file_type        TEXT NOT NULL,
  file_size_bytes  BIGINT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  priority         INT NOT NULL DEFAULT 0,
  retry_count      INT NOT NULL DEFAULT 0,
  extracted_data   JSONB,
  error_message    TEXT,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ocr_jobs_status_priority_created_idx
  ON ocr_jobs (status, priority DESC, created_at);

CREATE INDEX IF NOT EXISTS ocr_jobs_org_created_idx
  ON ocr_jobs (org_id, created_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION ocr_jobs_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ocr_jobs_touch_updated_at ON ocr_jobs;
CREATE TRIGGER ocr_jobs_touch_updated_at
  BEFORE UPDATE ON ocr_jobs
  FOR EACH ROW
  EXECUTE FUNCTION ocr_jobs_touch_updated_at();

-- RLS: org-scoped read, service_role writes from worker/API
ALTER TABLE ocr_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY ocr_jobs_org_read ON ocr_jobs
  FOR SELECT
  USING (
    org_id IS NULL
    OR org_id IN (
      SELECT org_id FROM user_profiles WHERE id = auth.uid()
    )
  );

-- Storage bucket for OCR uploads (private, 20 MB limit per file).
-- Keep in sync with apps/api/src/workers/ocr-bucket-init.ts and
-- apps/api/src/routes/ocr/index.ts. The API also reconciles this list at
-- startup, so drift is self-healing — but the migration should still match
-- so a fresh environment works out of the box.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ocr-uploads',
  'ocr-uploads',
  false,
  20971520,
  ARRAY[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/tiff',
    'image/bmp',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.oasis.opendocument.spreadsheet',
    'text/csv',
    'text/tab-separated-values',
    'application/csv',
    'text/plain'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
