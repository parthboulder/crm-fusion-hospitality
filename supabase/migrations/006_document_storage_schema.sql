-- Migration 006: Document storage schema for hotel report intake system.
-- Provides structured tracking of intake packages, individual document files,
-- and the canonical registries for properties and report types.

-- ── Canonical Report Type Registry ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS report_type_registry (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE,
  canonical_name TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('key_report', 'supporting_report', 'operational', 'financial')),
  priority      TEXT NOT NULL CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  expected_extensions TEXT[] NOT NULL DEFAULT '{}',
  storage_mode  TEXT NOT NULL DEFAULT 'individual' CHECK (storage_mode IN ('individual', 'bundle')),
  primary_purpose TEXT,
  extraction_fields JSONB DEFAULT '[]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE report_type_registry IS 'Canonical report type definitions for classification and extraction routing.';

-- ── Intake Packages (one per property-day) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS intake_packages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID REFERENCES organizations(id),
  property_id     UUID REFERENCES properties(id),
  property_code   TEXT NOT NULL,
  property_name   TEXT NOT NULL,
  brand_group     TEXT,

  report_date     DATE NOT NULL,
  source_zip_name TEXT,
  source_folder   TEXT,

  total_files     INT NOT NULL DEFAULT 0,
  classified_files INT NOT NULL DEFAULT 0,
  unclassified_files INT NOT NULL DEFAULT 0,

  expected_reports TEXT[] DEFAULT '{}',
  missing_reports  TEXT[] DEFAULT '{}',
  duplicate_flags  TEXT[] DEFAULT '{}',

  readiness_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (readiness_status IN ('pending', 'ready', 'ready_with_warnings', 'needs_review', 'approved', 'stored', 'failed')),

  reviewed_by     UUID REFERENCES user_profiles(id),
  reviewed_at     TIMESTAMPTZ,
  review_notes    TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (property_code, report_date)
);

CREATE INDEX idx_intake_packages_date ON intake_packages(report_date DESC);
CREATE INDEX idx_intake_packages_status ON intake_packages(readiness_status);
CREATE INDEX idx_intake_packages_property ON intake_packages(property_id, report_date DESC);

COMMENT ON TABLE intake_packages IS 'One record per property per reporting day. Tracks completeness, review status, and storage state.';

-- ── Document Files (one per stored file) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS document_files (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_package_id UUID REFERENCES intake_packages(id) ON DELETE CASCADE,
  org_id            UUID REFERENCES organizations(id),
  property_id       UUID REFERENCES properties(id),

  report_date       DATE NOT NULL,
  property_code     TEXT NOT NULL,
  property_name     TEXT NOT NULL,

  -- Original file info
  original_filename   TEXT NOT NULL,
  original_folder     TEXT,
  file_extension      TEXT NOT NULL,
  file_size_bytes     BIGINT,
  file_checksum       TEXT,

  -- Classification
  report_type_slug    TEXT REFERENCES report_type_registry(slug),
  report_type_name    TEXT,
  classification_confidence DECIMAL(3,2) CHECK (classification_confidence BETWEEN 0 AND 1),
  is_key_report       BOOLEAN NOT NULL DEFAULT FALSE,
  storage_mode        TEXT NOT NULL DEFAULT 'individual' CHECK (storage_mode IN ('individual', 'bundle')),

  -- Standardized storage
  standardized_filename TEXT NOT NULL,
  storage_path          TEXT NOT NULL,
  storage_bucket        TEXT NOT NULL DEFAULT 'reports-private',

  -- Processing state
  status              TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'classified', 'approved', 'stored', 'extracted', 'failed', 'archived')),
  extraction_job_id   UUID,
  extraction_priority TEXT CHECK (extraction_priority IN ('critical', 'high', 'medium', 'low')),

  -- Versioning
  version             INT NOT NULL DEFAULT 1,
  is_latest           BOOLEAN NOT NULL DEFAULT TRUE,
  supersedes_id       UUID REFERENCES document_files(id),

  -- Audit
  classified_at       TIMESTAMPTZ,
  stored_at           TIMESTAMPTZ,
  extracted_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  notes               TEXT
);

CREATE INDEX idx_document_files_date ON document_files(report_date DESC);
CREATE INDEX idx_document_files_property ON document_files(property_code, report_date DESC);
CREATE INDEX idx_document_files_type ON document_files(report_type_slug);
CREATE INDEX idx_document_files_status ON document_files(status);
CREATE INDEX idx_document_files_package ON document_files(intake_package_id);
CREATE INDEX idx_document_files_latest ON document_files(property_code, report_type_slug, report_date DESC) WHERE is_latest = TRUE;

COMMENT ON TABLE document_files IS 'Individual stored document with classification, standardized naming, and extraction tracking.';

-- ── Duplicate Detection Log ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS document_duplicates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_id     UUID NOT NULL REFERENCES document_files(id),
  duplicate_id    UUID NOT NULL REFERENCES document_files(id),
  detection_method TEXT NOT NULL CHECK (detection_method IN ('checksum', 'filename', 'property_type_date')),
  resolution      TEXT CHECK (resolution IN ('keep_original', 'keep_duplicate', 'keep_both', 'pending')),
  resolved_by     UUID REFERENCES user_profiles(id),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE document_duplicates IS 'Tracks detected duplicate documents and their resolution status.';

-- ── Intake Audit Log ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS intake_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_package_id UUID REFERENCES intake_packages(id),
  document_file_id  UUID REFERENCES document_files(id),
  action          TEXT NOT NULL,
  details         JSONB,
  performed_by    UUID REFERENCES user_profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_intake_audit_package ON intake_audit_log(intake_package_id);
CREATE INDEX idx_intake_audit_date ON intake_audit_log(created_at DESC);

COMMENT ON TABLE intake_audit_log IS 'Audit trail for all intake actions: classify, rename, approve, store, extract.';

-- ── Seed Report Type Registry ───────────────────────────────────────────────

INSERT INTO report_type_registry (slug, canonical_name, category, priority, expected_extensions, storage_mode, primary_purpose) VALUES
  ('revenue-flash',           'Revenue Flash',                   'key_report',  'critical', ARRAY['.xlsx','.xls','.csv'], 'individual', 'Daily revenue snapshot with occupancy, ADR, RevPAR, and year-over-year comparisons'),
  ('daily-statistical-recap', 'Daily Report Statistical Recap',  'key_report',  'critical', ARRAY['.pdf'],               'individual', 'High-level daily operating KPIs including business mix and segmentation'),
  ('manager-flash',           'Manager Flash Report',            'key_report',  'critical', ARRAY['.pdf'],               'individual', 'Brand-specific manager summary with day/MTD/YTD performance metrics'),
  ('hotel-statistics',        'Hotel Statistics Report',         'key_report',  'critical', ARRAY['.pdf'],               'individual', 'Hilton-format comprehensive daily statistics'),
  ('marriott-manager-stats',  'Marriott Manager Statistics',     'key_report',  'critical', ARRAY['.pdf'],               'individual', 'Marriott-format manager statistics with occupancy, rate, and revenue'),
  ('marriott-revenue',        'Marriott Revenue Report',         'key_report',  'critical', ARRAY['.pdf'],               'individual', 'Marriott-format revenue report with day/MTD/YTD breakdowns'),
  ('aging-report',            'Aging Report',                    'financial',   'high',     ARRAY['.pdf'],               'individual', 'Accounts receivable aging with bucket breakdown for collections'),
  ('credit-card-transactions','Credit Card Transactions Report', 'financial',   'high',     ARRAY['.pdf'],               'individual', 'Card settlement totals by type for reconciliation'),
  ('room-tax-listing',        'Room & Tax Listing Report',       'financial',   'high',     ARRAY['.pdf'],               'individual', 'Room revenue and tax detail for rate validation'),
  ('operator-transactions',   'Operator Transactions Report',    'operational', 'high',     ARRAY['.pdf'],               'individual', 'Adjustments, comps, paid-outs, refunds by operator'),
  ('daily-transaction-log',   'Daily Transaction Log Report',    'operational', 'medium',   ARRAY['.pdf'],               'individual', 'Detailed audit trail of all daily transactions'),
  ('ooo-rooms',               'OOO Rooms Report',                'operational', 'high',     ARRAY['.xlsx','.xls','.csv','.pdf'], 'individual', 'Out-of-order room inventory with maintenance impact')
ON CONFLICT (slug) DO NOTHING;

-- ── RLS Policies ────────────────────────────────────────────────────────────

ALTER TABLE intake_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_duplicates ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_type_registry ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read.
CREATE POLICY "Authenticated users can read intake packages"
  ON intake_packages FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read document files"
  ON document_files FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read report types"
  ON report_type_registry FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read intake audit"
  ON intake_audit_log FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read duplicates"
  ON document_duplicates FOR SELECT TO authenticated USING (true);

-- Service role can do everything.
CREATE POLICY "Service role full access on intake packages"
  ON intake_packages FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on document files"
  ON document_files FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on report type registry"
  ON report_type_registry FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on intake audit"
  ON intake_audit_log FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on duplicates"
  ON document_duplicates FOR ALL TO service_role USING (true) WITH CHECK (true);
