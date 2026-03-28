# Hotel Document Taxonomy & Naming Conventions

> **Purpose:** Define the canonical naming, storage hierarchy, and governance rules for the Fusion Hospitality document management system. This document is the single source of truth for how hotel reports are named, stored, versioned, and managed at scale.

---

## 1. Canonical Property Master

Every property in the portfolio has exactly one canonical entry:

| Code | Canonical Name | Brand Group | City | State |
|------|---------------|-------------|------|-------|
| HGIOB | HGI Olive Branch | Hilton | Olive Branch | MS |
| TRUTP | Tru By Hilton Tupelo | Hilton | Tupelo | MS |
| HAMPVK | Hampton Inn Vicksburg | Hilton | Vicksburg | MS |
| DTBLX | DoubleTree Biloxi | Hilton | Biloxi | MS |
| HM2BX | Home2 Suites By Hilton | Hilton Extended | Biloxi | MS |
| HGIMD | Hilton Garden Inn Madison | Hilton Extended | Madison | MS |
| HGIMR | Hilton Garden Inn Meridian | Hilton Extended | Meridian | MS |
| HAMPMR | Hampton Inn Meridian | Hilton Extended | Meridian | MS |
| HIMRD | Holiday Inn Meridian | IHG | Meridian | MS |
| CWSTP | Candlewood Suites | IHG | Tupelo | MS |
| HIEFT | Holiday Inn Express Fulton | IHG | Fulton | MS |
| HIEMSW | Holiday Inn Express Memphis Southwind | IHG | Memphis | TN |
| HIETP | Holiday Inn Express Tupelo | IHG | Tupelo | MS |
| HITP | Holiday Inn Tupelo | IHG | Tupelo | MS |
| FPMSW | Four Points Memphis Southwind | Marriott | Memphis | TN |
| TPSRG | TownePlace Suites | Marriott | Ridgeland | MS |
| BWTP | Best Western Tupelo | Best Western | Tupelo | MS |
| SSTP | SureStay Hotel | Best Western | Tupelo | MS |
| BWPOB | Best Western Plus Olive Branch | Best Western | Olive Branch | MS |
| HYPBX | Hyatt Place Biloxi | Hyatt | Biloxi | MS |
| CITP | Comfort Inn Tupelo | Choice | Tupelo | MS |

### Property Code Rules

- 3–6 uppercase alphanumeric characters
- Derived from: brand abbreviation + city abbreviation
- Must be unique across the portfolio
- Immutable once assigned (never rename a code)
- New properties get codes assigned during onboarding

### Alias Matching

Each property has a list of known aliases (abbreviations, misspellings, partial names). The classification engine uses fuzzy matching against these aliases. When a new variant is encountered, it should be added to the alias list.

---

## 2. Canonical Report Types

| Slug | Canonical Name | Category | Priority |
|------|---------------|----------|----------|
| revenue-flash | Revenue Flash | Key Report | Critical |
| daily-statistical-recap | Daily Report Statistical Recap | Key Report | Critical |
| manager-flash | Manager Flash Report | Key Report | Critical |
| hotel-statistics | Hotel Statistics Report | Key Report | Critical |
| marriott-manager-stats | Marriott Manager Statistics | Key Report | Critical |
| marriott-revenue | Marriott Revenue Report | Key Report | Critical |
| aging-report | Aging Report | Financial | High |
| credit-card-transactions | Credit Card Transactions Report | Financial | High |
| room-tax-listing | Room & Tax Listing Report | Financial | High |
| operator-transactions | Operator Transactions Report | Operational | High |
| daily-transaction-log | Daily Transaction Log Report | Operational | Medium |
| ooo-rooms | OOO Rooms Report | Operational | High |

### Brand-Specific Primary Reports

Not all brands use the same "main" report. The primary daily performance report varies:

| Brand Group | Primary Report | Format |
|-------------|---------------|--------|
| Hilton | Hotel Statistics | Hilton Hotel Statistics PDF |
| Hilton Extended | Hotel Statistics | Hilton Hotel Statistics Extended |
| IHG | Manager Flash | IHG Manager Flash Report |
| Marriott (Four Points) | Manager Statistics | Marriott Manager Statistics |
| Marriott (TownePlace) | Revenue Report | Marriott Revenue Report |
| Best Western | Statistical Recap | Best Western Daily Report |
| Hyatt | Manager Flash | Hyatt Manager Flash Report |
| Choice | Hotel Statistics | Choice Hotels Statistics Report |

---

## 3. Date Normalization Rules

All dates are stored and displayed in **ISO 8601 format: `YYYY-MM-DD`**.

### Input Parsing Rules

| Input Format | Example | Parsed As |
|-------------|---------|-----------|
| MMDDYYYY (8 digits, no sep) | 03172026 | 2026-03-17 |
| MMDDYY (6 digits, no sep) | 031726 | 2026-03-17 |
| MM.DD.YYYY | 03.17.2026 | 2026-03-17 |
| MM.DD.YY | 03.17.26 | 2026-03-17 |
| M.DD.YY | 3.17.26 | 2026-03-17 |
| MM-DD-YYYY | 03-17-2026 | 2026-03-17 |
| MM/DD/YYYY | 03/17/2026 | 2026-03-17 |
| YYYY-MM-DD (ISO) | 2026-03-17 | 2026-03-17 |

### Two-Digit Year Rule

- 00–49 → 2000–2049
- 50–99 → 1950–1999

### Date Validation

- Month must be 01–12
- Day must be valid for the given month
- Year must be within reasonable range (2020–2030 for current operations)
- If date cannot be parsed from folder name, check filenames
- If still ambiguous, prompt user for manual input

---

## 4. Filename Convention

### Format

```
YYYY-MM-DD_<PropertyCode>_<PropertyNameSlug>_<ReportTypeSlug>.<ext>
```

### Rules

| Rule | Detail |
|------|--------|
| Date | Always YYYY-MM-DD, always first |
| Property Code | Uppercase, from property master |
| Property Name | PascalCase, abbreviated if > 30 chars |
| Report Type | PascalCase, from canonical name (strip "Report"/"Spreadsheet") |
| Extension | Lowercase (.pdf, .xlsx, .xls, .csv) |
| Separator | Underscore between segments |
| Max Length | 120 characters total |
| No Junk | No embedded dates, no double punctuation, no spaces |

### Examples

```
2026-03-17_HGIOB_HGIOliveBranch_AgingReport.pdf
2026-03-17_HGIOB_HGIOliveBranch_CreditCardTransactions.pdf
2026-03-17_HGIOB_HGIOliveBranch_DailyStatisticalRecap.pdf
2026-03-17_HGIOB_HGIOliveBranch_RevenueFlash.xlsx
2026-03-17_HIEMSW_HIExpressMemphisSouthwind_ManagerFlash.pdf
2026-03-17_FPMSW_FourPointsMemphisSouthwind_MarriottManagerStats.pdf
```

---

## 5. Storage Hierarchy

```
/Hotel Reports/
  └── Daily Reports/
      └── 2026/
          └── 03/
              └── 17/
                  ├── HGIOB - HGI Olive Branch/
                  │   ├── 2026-03-17_HGIOB_HGIOliveBranch_AgingReport.pdf
                  │   ├── 2026-03-17_HGIOB_HGIOliveBranch_RevenueFlash.xlsx
                  │   └── ...
                  ├── TRUTP - Tru By Hilton Tupelo/
                  │   └── ...
                  └── HIEMSW - Holiday Inn Express Memphis Southwind/
                      └── ...
```

### Why This Hierarchy

| Alternative Considered | Rejected Because |
|----------------------|------------------|
| Property → Year → Date | Harder to pull "all reports for March 17" across properties |
| Flat by date | Too many files in one folder when scaling |
| By report type → date | Operations team thinks in "day + property", not "report type" |
| Year → Property → Date | Property-first makes sense but date-first aligns with daily workflow |

---

## 6. Duplicate Handling Rules

| Scenario | Action |
|----------|--------|
| Same file uploaded twice (checksum match) | Keep original, log duplicate, skip storage |
| Same property + report type + date, different file | Keep both, flag for review, version increment |
| Updated/corrected report (same type, new content) | Store as version 2, mark previous as not-latest |
| File renamed but content identical | Detect via checksum, treat as duplicate |

### Versioning

- `version` field starts at 1
- `is_latest` boolean indicates the current active version
- `supersedes_id` links to the previous version
- Only `is_latest = TRUE` records are used for extraction and dashboard

---

## 7. Missing File Alert Rules

After intake classification, the system checks each property against its expected report set.

### Alert Triggers

| Condition | Severity | Action |
|-----------|----------|--------|
| Missing key report (Revenue Flash, Statistics, Flash) | High | Alert property manager + corporate |
| Missing 2+ financial reports | Medium | Alert accounting team |
| Missing OOO Rooms report | Medium | Alert operations |
| All reports missing for a property | Critical | Alert corporate — property may not have submitted |
| Same property missing same report 3+ consecutive days | High | Escalate to regional manager |

### Alert Channels

- Dashboard notification (always)
- Email to assigned property manager (high/critical)
- Slack notification to #daily-reports channel (critical)

---

## 8. Bundle vs Individual Storage

| Storage Mode | When Used | Behavior |
|-------------|-----------|----------|
| Individual | All key reports, financial reports, OOO rooms | Stored as separate files, individually tracked |
| Bundle | Supplementary documents, reference materials | Grouped in a ZIP per property-day, single tracking record |

Currently, all 12 canonical report types are stored individually. Bundle mode is reserved for future expansion when properties submit additional supplementary materials.

---

## 9. Database Schema: Document Files Table

Each stored document creates one row in `document_files`:

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| intake_package_id | UUID | FK to intake_packages |
| org_id | UUID | Organization reference |
| property_id | UUID | Property reference |
| report_date | DATE | Reporting date |
| property_code | TEXT | Canonical property code |
| property_name | TEXT | Canonical property name |
| original_filename | TEXT | Original filename as uploaded |
| original_folder | TEXT | Original folder path from ZIP |
| file_extension | TEXT | .pdf, .xlsx, etc. |
| file_size_bytes | BIGINT | File size |
| file_checksum | TEXT | SHA-256 for dedup |
| report_type_slug | TEXT | FK to report_type_registry |
| report_type_name | TEXT | Human-readable report type |
| classification_confidence | DECIMAL | 0.00–1.00 |
| is_key_report | BOOLEAN | Critical for daily operations |
| storage_mode | TEXT | "individual" or "bundle" |
| standardized_filename | TEXT | Proposed/applied filename |
| storage_path | TEXT | Full storage path |
| storage_bucket | TEXT | Supabase storage bucket |
| status | TEXT | pending → classified → approved → stored → extracted |
| extraction_job_id | UUID | Links to extraction pipeline |
| extraction_priority | TEXT | critical/high/medium/low |
| version | INT | Version number |
| is_latest | BOOLEAN | Current active version |
| supersedes_id | UUID | Previous version reference |
| notes | TEXT | Classification notes |

---

## 10. Database Schema: Intake Packages Table

Each property-day creates one row in `intake_packages`:

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| org_id | UUID | Organization reference |
| property_id | UUID | Property reference |
| property_code | TEXT | Canonical property code |
| property_name | TEXT | Canonical property name |
| brand_group | TEXT | Brand group for expected report logic |
| report_date | DATE | Reporting date |
| source_zip_name | TEXT | Original ZIP filename |
| source_folder | TEXT | Property folder within ZIP |
| total_files | INT | Count of all files |
| classified_files | INT | Successfully classified count |
| unclassified_files | INT | Unclassified count |
| expected_reports | TEXT[] | List of expected report slugs |
| missing_reports | TEXT[] | List of missing report slugs |
| duplicate_flags | TEXT[] | Duplicate detection notes |
| readiness_status | TEXT | pending → ready → approved → stored |
| reviewed_by | UUID | Who approved |
| reviewed_at | TIMESTAMPTZ | When approved |
| review_notes | TEXT | Reviewer comments |

---

## 11. Scaling Considerations

This system is designed to scale:

- **More properties:** Add to property master with a new code. All naming, classification, and storage rules apply automatically.
- **More report types:** Add to report type registry. Classification engine picks up new patterns.
- **More brands:** Add brand-specific primary report mapping. Extraction guides cover new formats.
- **Historical backfill:** Same pipeline processes any date. Versioning handles updates.
- **Multi-organization:** org_id scoping already built into all tables.
