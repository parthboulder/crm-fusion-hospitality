-- Adds content-hash deduplication to ocr_jobs.
--
-- `checksum_sha256` is the hex-encoded SHA-256 of the raw upload bytes.
-- Uploads compare against existing non-failed rows by checksum; a match
-- returns the existing job instead of creating a duplicate.
--
-- `failed` jobs are intentionally excluded from the uniqueness check so a
-- user can re-upload after a bad OCR run (also supported via the /retry
-- endpoint, which keeps the original row).

ALTER TABLE ocr_jobs
  ADD COLUMN IF NOT EXISTS checksum_sha256 TEXT;

-- Partial unique index: only one non-failed job per checksum.
-- This is a belt-and-suspenders guarantee — the API also checks in code so
-- it can return a friendly 409 with the existing job id, but the index
-- prevents races where two concurrent uploads of the same file both pass
-- the check-then-insert.
CREATE UNIQUE INDEX IF NOT EXISTS ocr_jobs_checksum_unique_active
  ON ocr_jobs (checksum_sha256)
  WHERE status <> 'failed' AND checksum_sha256 IS NOT NULL;

-- Regular index for fast lookup path (includes failed jobs too, in case
-- we want to surface "this matches a previous failed attempt — retry it?").
CREATE INDEX IF NOT EXISTS ocr_jobs_checksum_idx
  ON ocr_jobs (checksum_sha256);
