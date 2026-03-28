-- Migration 008: Document storage behavior revision.
-- Ensures no document is ever silently dropped. Adds not_classified status,
-- batch/folder tracking on document_files, and not_classified_count on zip_batches.

-- ── Add 'not_classified' status to document_files ─────────────────────────────

ALTER TABLE document_files
  DROP CONSTRAINT IF EXISTS document_files_status_check;

ALTER TABLE document_files
  ADD CONSTRAINT document_files_status_check
  CHECK (status IN (
    'pending', 'classified', 'not_classified', 'needs_review',
    'approved', 'stored', 'extracted', 'failed', 'archived', 'duplicate'
  ));

-- ── Add batch/folder tracking columns to document_files ───────────────────────

ALTER TABLE document_files
  ADD COLUMN IF NOT EXISTS batch_id          UUID REFERENCES zip_batches(id),
  ADD COLUMN IF NOT EXISTS batch_folder_name TEXT,
  ADD COLUMN IF NOT EXISTS upload_source     TEXT DEFAULT 'manual'
    CHECK (upload_source IN ('manual', 'zip_upload', 'api')),
  ADD COLUMN IF NOT EXISTS uploaded_by       UUID REFERENCES user_profiles(id);

CREATE INDEX IF NOT EXISTS idx_document_files_batch ON document_files(batch_id);
CREATE INDEX IF NOT EXISTS idx_document_files_upload_source ON document_files(upload_source);

-- ── Add 'not_classified' status to zip_batch_items ────────────────────────────

ALTER TABLE zip_batch_items
  DROP CONSTRAINT IF EXISTS zip_batch_items_status_check;

ALTER TABLE zip_batch_items
  ADD CONSTRAINT zip_batch_items_status_check
  CHECK (status IN (
    'pending', 'classified', 'not_classified', 'needs_review',
    'approved', 'processing', 'completed', 'duplicate', 'skipped', 'failed'
  ));

-- ── Add not_classified_count to zip_batches ───────────────────────────────────

ALTER TABLE zip_batches
  ADD COLUMN IF NOT EXISTS not_classified_count INT NOT NULL DEFAULT 0;

-- ── Add index for unclassified items review queue ─────────────────────────────

CREATE INDEX IF NOT EXISTS idx_batch_items_not_classified
  ON zip_batch_items(batch_id, status) WHERE status = 'not_classified';

CREATE INDEX IF NOT EXISTS idx_document_files_not_classified
  ON document_files(status) WHERE status IN ('not_classified', 'needs_review');
