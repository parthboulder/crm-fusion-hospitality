# Directive: Hotel Report ZIP Intake & Document Storage

> **Purpose:** Accept a daily ZIP of hotel reports, classify every file, propose standardized renames, flag gaps, and prepare for downstream extraction — all with a human-in-the-loop review step before final storage.

---

## Inputs

| Input | Description |
|-------|-------------|
| ZIP file | One day's worth of hotel reporting folders |
| Property master | `execution/intake/property-master.ts` — canonical names, codes, aliases |
| Report taxonomy | `execution/intake/report-taxonomy.ts` — canonical report types, patterns |

## Expected ZIP Structure

```
<date_folder>/           (e.g., 03172026, 03.17.26, 2026-03-17)
  ├── <property_folder>/  (e.g., "HGI Olive Branch", "BW Tupelo", "HIE Memphis")
  │   ├── AgingReport.pdf
  │   ├── CreditCardTransactions.pdf
  │   ├── DailyReportStatisticalRecap.pdf
  │   ├── DailyTransactionLog.pdf
  │   ├── OperatorTransactions.pdf
  │   ├── RoomTaxListing.pdf
  │   ├── OOORooms.xlsx
  │   └── RevenueFlash.xlsx
  └── <property_folder>/
      └── ...
```

### Naming Inconsistencies to Handle

- **Dates:** `03.17.26`, `03.17.2026`, `3.17.26`, `03-17-2026`, `03172026`, `2026-03-17`
- **Properties:** abbreviated, partially written, inconsistent capitalization
- **Reports:** brand-specific naming, extra punctuation, embedded dates, varying word order

---

## Workflow Steps

### Step 1 — Unzip & Inspect

1. Extract ZIP to `.tmp/intake/<timestamp>/`
2. Walk the directory tree
3. Identify top-level date folder
4. Identify property subfolders
5. List all files with full paths, sizes, extensions

**Script:** `execution/intake/process-zip.ts`

### Step 2 — Classify Every File

For each file:
1. Parse the filename for date tokens, property hints, report type hints
2. Match against property master (fuzzy matching on aliases)
3. Match against report taxonomy (keyword + extension patterns)
4. Assign confidence score (0.0–1.0)
5. Flag ambiguous or unrecognized files

**Script:** `execution/intake/classify-files.ts`

### Step 3 — Build Structured Inventory

Generate one record per file with:
- `reporting_date` (normalized YYYY-MM-DD)
- `top_level_folder` (original folder name)
- `property_folder_name` (original)
- `normalized_property_name` (from property master)
- `property_code` (from property master)
- `original_filename`
- `file_extension`
- `inferred_report_type` (canonical name)
- `is_key_report` (true/false)
- `storage_mode` ("individual" or "bundle")
- `classification_confidence` (0.0–1.0)
- `notes` (ambiguity, duplicates, issues)

**Script:** `execution/intake/generate-inventory.ts`

### Step 4 — Propose Standardized Renames

Naming format:
```
YYYY-MM-DD_<PropertyCode>_<PropertyName>_<ReportType>.<ext>
```

Storage path:
```
/Hotel Reports/Daily Reports/YYYY/MM/DD/<PropertyCode> - <PropertyName>/
```

Rules:
- Remove junk text, duplicate punctuation, embedded dates from filenames
- Use PascalCase for property name and report type segments
- Keep filenames under 120 characters
- Use smart abbreviation if property name exceeds 30 characters

**Script:** `execution/intake/rename-engine.ts`

### Step 5 — Gap Analysis

For each property:
1. Compare found reports against expected report set (from taxonomy)
2. Flag missing key reports
3. Flag duplicate reports
4. Flag unrecognized files
5. Assign readiness status: Ready | Ready with warnings | Needs review

### Step 6 — Human Review (REQUIRED)

**Do NOT auto-rename or auto-store without review.**

Present to reviewer:
- Full inventory table (markdown)
- Rename proposal table
- Property completeness summary
- Flagged items requiring attention

Reviewer can:
- Approve all
- Approve with overrides
- Reject and request re-classification

### Step 7 — Execute Storage

After approval:
1. Copy files to standardized paths (do not delete originals until confirmed)
2. Insert records into `document_files` and `intake_packages` tables
3. Trigger extraction pipeline for key reports
4. Archive originals to `.tmp/intake/archived/<date>/`

### Step 8 — Prepare Extraction Rules

For each stored file, attach extraction metadata:
- Which fields to extract
- Which extraction prompt to use (by report format)
- Priority level (Critical / High / Medium / Low)
- Whether OCR is needed

---

## Decision Rules

| Condition | Action |
|-----------|--------|
| File matches property + report type with confidence ≥ 0.8 | Auto-classify |
| Confidence 0.5–0.79 | Classify with warning, flag for review |
| Confidence < 0.5 | Mark as "unclassified", require manual review |
| Duplicate report detected (same property + type + date) | Keep both, flag as duplicate |
| File extension not PDF/XLSX/XLS/CSV | Flag as unexpected format |
| Property folder doesn't match any known property | Flag entire folder for review |
| Date cannot be parsed from folder name | Prompt user for date |

## Exception Handling

- **Corrupted ZIP:** Fail with clear error, do not proceed
- **Empty property folder:** Log warning, continue with other properties
- **Unrecognized file types:** Include in inventory with `report_type: "unknown"`
- **No date folder:** Attempt to infer date from filenames; if impossible, prompt user

---

## Outputs

| Output | Format | Location |
|--------|--------|----------|
| File inventory | JSON + Markdown table | `.tmp/intake/output/inventory.json` |
| Rename proposals | JSON + Markdown table | `.tmp/intake/output/renames.json` |
| Property summaries | JSON + Markdown | `.tmp/intake/output/property-summaries.json` |
| Data extraction map | JSON | `.tmp/intake/output/extraction-map.json` |
| Executive summary | Markdown | `.tmp/intake/output/summary.md` |
| Full JSON output | JSON | `.tmp/intake/output/intake-result.json` |

---

## Tools / Scripts

| Script | Purpose |
|--------|---------|
| `execution/intake/process-zip.ts` | Unzip, walk tree, identify structure |
| `execution/intake/classify-files.ts` | Match files to properties and report types |
| `execution/intake/rename-engine.ts` | Generate standardized filenames and paths |
| `execution/intake/generate-inventory.ts` | Build structured inventory and JSON output |
| `execution/intake/property-master.ts` | Canonical property registry with aliases |
| `execution/intake/report-taxonomy.ts` | Report type definitions and patterns |

---

## Learnings & Edge Cases

*(Updated as issues are discovered during processing)*

- DoubleTree Biloxi appears in both Hilton Group 1 and Group 2 — confirm report format before classifying
- Marriott (Four Points) and Hyatt PY Revenue requires prior-year file, not embedded in current report
- Best Western uses "Out of Service" not "Out of Order" — normalize to "OOO" in taxonomy
- RevPAR must be calculated for IHG, Marriott Manager Stats, Best Western, and Hyatt formats
