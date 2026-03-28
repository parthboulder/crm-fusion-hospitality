-- Migration 007: ZIP batch ingestion schema.
-- Tracks ZIP uploads as batches with per-folder property groupings,
-- processing status, and review queue support.

-- ── ZIP Batches (one per uploaded ZIP file) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS zip_batches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  uploaded_by     UUID REFERENCES user_profiles(id),

  -- Source file info
  original_filename TEXT NOT NULL,
  file_size_bytes   BIGINT NOT NULL,
  checksum_sha256   TEXT NOT NULL,
  storage_path      TEXT,

  -- Processing state
  status          TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN (
      'uploaded',       -- ZIP received, not yet processed
      'extracting',     -- Unzipping in progress
      'classifying',    -- Running property/doc-type detection
      'classified',     -- All files classified, awaiting review
      'processing',     -- Creating reports + running extraction
      'completed',      -- All files stored and extraction queued
      'completed_with_review', -- Done but some items need review
      'failed'          -- Unrecoverable error
    )),
  error_message   TEXT,

  -- Aggregate counts
  total_files       INT NOT NULL DEFAULT 0,
  total_folders     INT NOT NULL DEFAULT 0,
  classified_count  INT NOT NULL DEFAULT 0,
  needs_review_count INT NOT NULL DEFAULT 0,
  completed_count   INT NOT NULL DEFAULT 0,
  failed_count      INT NOT NULL DEFAULT 0,
  duplicate_count   INT NOT NULL DEFAULT 0,

  -- Timing
  processing_started_at TIMESTAMPTZ,
  processing_completed_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_zip_batches_org ON zip_batches(org_id, created_at DESC);
CREATE INDEX idx_zip_batches_status ON zip_batches(status);
CREATE INDEX idx_zip_batches_uploader ON zip_batches(uploaded_by, created_at DESC);

COMMENT ON TABLE zip_batches IS 'One record per uploaded ZIP file. Tracks overall ingestion progress.';

-- ── Batch Items (one per file inside the ZIP) ────────────────────────────────

CREATE TABLE IF NOT EXISTS zip_batch_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        UUID NOT NULL REFERENCES zip_batches(id) ON DELETE CASCADE,
  org_id          UUID NOT NULL REFERENCES organizations(id),

  -- File info from ZIP
  original_filename TEXT NOT NULL,
  relative_path     TEXT NOT NULL,
  folder_name       TEXT NOT NULL,
  file_extension    TEXT NOT NULL,
  file_size_bytes   BIGINT NOT NULL,
  file_checksum     TEXT,

  -- Property detection
  detected_property_id   UUID REFERENCES properties(id),
  detected_property_name TEXT,
  property_confidence    DECIMAL(3,2) CHECK (property_confidence BETWEEN 0 AND 1),
  property_source        TEXT CHECK (property_source IN ('folder_name', 'file_name', 'content_extraction', 'manual')),

  -- Document type classification
  detected_report_type   TEXT,
  report_type_slug       TEXT,
  type_confidence        DECIMAL(3,2) CHECK (type_confidence BETWEEN 0 AND 1),

  -- Date detection
  detected_date          DATE,

  -- Overall confidence
  overall_confidence     DECIMAL(3,2) CHECK (overall_confidence BETWEEN 0 AND 1),

  -- Processing state
  status              TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',          -- Not yet classified
      'classified',       -- Auto-classified successfully
      'needs_review',     -- Low confidence, needs human review
      'approved',         -- Human approved classification
      'processing',       -- Creating report record + uploading
      'completed',        -- Fully processed, report created
      'duplicate',        -- Flagged as duplicate
      'skipped',          -- System file or unsupported type
      'failed'            -- Processing error
    )),

  -- Duplicate detection
  is_duplicate         BOOLEAN NOT NULL DEFAULT FALSE,
  duplicate_of_item_id UUID REFERENCES zip_batch_items(id),
  duplicate_of_report_id UUID REFERENCES reports(id),
  duplicate_method     TEXT CHECK (duplicate_method IN ('checksum', 'filename_size', 'property_type_date')),

  -- Result (after processing)
  created_report_id    UUID REFERENCES reports(id),
  storage_path         TEXT,

  -- Review metadata
  review_notes         TEXT,
  reviewed_by          UUID REFERENCES user_profiles(id),
  reviewed_at          TIMESTAMPTZ,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_batch_items_batch ON zip_batch_items(batch_id);
CREATE INDEX idx_batch_items_status ON zip_batch_items(status);
CREATE INDEX idx_batch_items_folder ON zip_batch_items(batch_id, folder_name);
CREATE INDEX idx_batch_items_property ON zip_batch_items(detected_property_id);
CREATE INDEX idx_batch_items_review ON zip_batch_items(batch_id, status) WHERE status = 'needs_review';

COMMENT ON TABLE zip_batch_items IS 'One record per file inside a ZIP. Tracks detection, classification, and processing state.';

-- ── RLS Policies ─────────────────────────────────────────────────────────────

ALTER TABLE zip_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE zip_batch_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read zip batches"
  ON zip_batches FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read batch items"
  ON zip_batch_items FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role full access on zip batches"
  ON zip_batches FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on batch items"
  ON zip_batch_items FOR ALL TO service_role USING (true) WITH CHECK (true);
