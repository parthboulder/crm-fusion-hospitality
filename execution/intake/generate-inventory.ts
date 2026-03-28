/**
 * Inventory and output generator for hotel report intake.
 * Produces markdown tables, JSON output, and executive summary.
 */

import type { ClassificationResult, ClassifiedFile, PropertySummary } from './classify-files.js';
import type { RenameProposal } from './rename-engine.js';
import { REPORT_TYPES } from './report-taxonomy.js';

// ── JSON Output Shape ────────────────────────────────────────────────────────

export interface IntakeOutput {
  report_date: string;
  top_level_folder: string;
  properties: PropertyOutput[];
  global_recommendations: {
    folder_structure: string;
    filename_format: string;
    workflow_notes: string[];
  };
}

interface PropertyOutput {
  property_folder_name: string;
  normalized_property_name: string;
  property_code: string;
  status: string;
  files: FileOutput[];
  missing_expected_reports: string[];
  duplicates_or_flags: string[];
}

interface FileOutput {
  original_filename: string;
  suggested_filename: string;
  suggested_storage_path: string;
  report_type: string;
  classification_confidence: string;
  key_report: boolean;
  suggested_extraction_fields: string[];
  notes: string;
}

// ── Markdown Generators ──────────────────────────────────────────────────────

export function generateInventoryMarkdown(
  result: ClassificationResult,
  proposals: RenameProposal[],
): string {
  const renameMap = new Map(proposals.map((p) => [p.originalFilename, p]));
  const lines: string[] = [];

  lines.push('# File Inventory');
  lines.push('');
  lines.push(`**Reporting Date:** ${result.reportingDate}`);
  lines.push(`**Top-Level Folder:** ${result.topLevelFolder}`);
  lines.push(`**Total Files:** ${result.totalFiles}`);
  lines.push(`**Classified:** ${result.classifiedFiles.length - result.unclassifiedFiles.length}`);
  lines.push(`**Needs Review:** ${result.unclassifiedFiles.length}`);
  lines.push('');

  // File inventory table.
  lines.push('## All Files');
  lines.push('');
  lines.push('| # | Property | Report Type | Original File | Confidence | Key? | Notes |');
  lines.push('|---|----------|-------------|---------------|------------|------|-------|');

  result.classifiedFiles.forEach((f, i) => {
    const conf = `${(f.overallConfidence * 100).toFixed(0)}%`;
    const key = f.isKeyReport ? 'Yes' : '';
    const notes = f.notes.length > 0 ? f.notes[0]! : '';
    lines.push(
      `| ${i + 1} | ${f.normalizedPropertyName ?? f.propertyFolderName} | ${f.inferredReportType ?? '??'} | ${f.originalFilename} | ${conf} | ${key} | ${notes} |`,
    );
  });

  lines.push('');

  // Rename proposal table.
  lines.push('## Rename Proposals');
  lines.push('');
  lines.push('| Original | Proposed | Storage Path | Reason |');
  lines.push('|----------|----------|--------------|--------|');

  for (const p of proposals) {
    lines.push(`| ${p.originalFilename} | ${p.suggestedFilename} | ${p.suggestedStoragePath} | ${truncate(p.reason, 80)} |`);
  }

  lines.push('');

  return lines.join('\n');
}

export function generatePropertySummaryMarkdown(summaries: PropertySummary[]): string {
  const lines: string[] = [];

  lines.push('# Property Completeness Summary');
  lines.push('');

  for (const s of summaries) {
    const statusEmoji = s.readinessStatus === 'Ready' ? '[OK]'
      : s.readinessStatus === 'Ready with warnings' ? '[WARN]'
      : '[REVIEW]';

    lines.push(`## ${statusEmoji} ${s.normalizedPropertyName} (${s.propertyCode})`);
    lines.push('');
    lines.push(`- **Brand Group:** ${s.brandGroup}`);
    lines.push(`- **Date:** ${s.reportingDate}`);
    lines.push(`- **Files Found:** ${s.filesFound.length}`);
    lines.push(`- **Status:** ${s.readinessStatus}`);

    if (s.expectedReportsMissing.length > 0) {
      lines.push(`- **Missing Reports:** ${s.expectedReportsMissing.join(', ')}`);
    }

    if (s.duplicatesOrFlags.length > 0) {
      lines.push(`- **Flags:** ${s.duplicatesOrFlags.join(', ')}`);
    }

    lines.push('');
    lines.push('| File | Report Type | Confidence |');
    lines.push('|------|-------------|------------|');

    for (const f of s.filesFound) {
      lines.push(`| ${f.originalFilename} | ${f.inferredReportType ?? '??'} | ${(f.overallConfidence * 100).toFixed(0)}% |`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

export function generateExtractionMapMarkdown(): string {
  const lines: string[] = [];

  lines.push('# Data Extraction Map');
  lines.push('');
  lines.push('Which data to pull from which report type.');
  lines.push('');

  for (const rt of REPORT_TYPES) {
    lines.push(`## ${rt.canonicalName}`);
    lines.push('');
    lines.push(`**Primary Purpose:** ${rt.primaryPurpose}`);
    lines.push(`**Priority:** ${rt.priority.toUpperCase()}`);
    lines.push(`**Category:** ${rt.category}`);
    lines.push('');
    lines.push('| Field | Description | Use Case | Priority |');
    lines.push('|-------|-------------|----------|----------|');

    for (const field of rt.extractionFields) {
      lines.push(`| ${field.field} | ${field.description} | ${field.useCase} | ${field.priority} |`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

export function generateExecutiveSummary(
  result: ClassificationResult,
  proposals: RenameProposal[],
): string {
  const lines: string[] = [];

  const readyCount = result.propertySummaries.filter((s) => s.readinessStatus === 'Ready').length;
  const warnCount = result.propertySummaries.filter((s) => s.readinessStatus === 'Ready with warnings').length;
  const reviewCount = result.propertySummaries.filter((s) => s.readinessStatus === 'Needs review').length;

  lines.push('# Executive Summary — Daily Report Intake');
  lines.push('');
  lines.push(`**Reporting Date:** ${result.reportingDate}`);
  lines.push(`**Source:** ${result.topLevelFolder}`);
  lines.push('');
  lines.push('## Overview');
  lines.push('');
  lines.push(`- **Total files processed:** ${result.totalFiles}`);
  lines.push(`- **Properties detected:** ${result.propertySummaries.length}`);
  lines.push(`- **Ready for storage:** ${readyCount}`);
  lines.push(`- **Ready with warnings:** ${warnCount}`);
  lines.push(`- **Needs manual review:** ${reviewCount}`);
  lines.push(`- **Unclassified files:** ${result.unclassifiedFiles.length}`);
  lines.push('');

  if (result.warnings.length > 0) {
    lines.push('## Warnings');
    lines.push('');
    for (const w of result.warnings) {
      lines.push(`- ${w}`);
    }
    lines.push('');
  }

  lines.push('## Next Steps');
  lines.push('');

  if (reviewCount > 0) {
    lines.push('1. Review flagged properties and unclassified files');
  }
  if (warnCount > 0) {
    lines.push('2. Verify missing reports for properties with warnings');
  }
  lines.push(`${reviewCount > 0 || warnCount > 0 ? '3' : '1'}. Approve rename proposals`);
  lines.push(`${reviewCount > 0 || warnCount > 0 ? '4' : '2'}. Execute storage and trigger extraction pipeline`);

  lines.push('');

  return lines.join('\n');
}

// ── JSON Output Generator ────────────────────────────────────────────────────

export function generateJsonOutput(
  result: ClassificationResult,
  proposals: RenameProposal[],
): IntakeOutput {
  const renameMap = new Map(proposals.map((p) => [p.originalFilename, p]));

  const properties: PropertyOutput[] = result.propertySummaries.map((s) => ({
    property_folder_name: s.filesFound[0]?.propertyFolderName ?? '',
    normalized_property_name: s.normalizedPropertyName,
    property_code: s.propertyCode,
    status: s.readinessStatus,
    files: s.filesFound.map((f) => {
      const rename = renameMap.get(f.originalFilename);
      const reportType = REPORT_TYPES.find((rt) => rt.slug === f.reportTypeSlug);

      return {
        original_filename: f.originalFilename,
        suggested_filename: rename?.suggestedFilename ?? f.originalFilename,
        suggested_storage_path: rename?.suggestedStoragePath ?? '',
        report_type: f.inferredReportType ?? 'unknown',
        classification_confidence: `${(f.overallConfidence * 100).toFixed(0)}%`,
        key_report: f.isKeyReport,
        suggested_extraction_fields: reportType
          ? reportType.extractionFields
              .filter((ef) => ef.priority === 'critical' || ef.priority === 'high')
              .map((ef) => ef.field)
          : [],
        notes: f.notes.join(' | '),
      };
    }),
    missing_expected_reports: s.expectedReportsMissing,
    duplicates_or_flags: s.duplicatesOrFlags,
  }));

  return {
    report_date: result.reportingDate,
    top_level_folder: result.topLevelFolder,
    properties,
    global_recommendations: {
      folder_structure: '/Hotel Reports/Daily Reports/YYYY/MM/DD/<PropertyCode> - <PropertyName>/',
      filename_format: 'YYYY-MM-DD_<PropertyCode>_<PropertyName>_<ReportType>.<ext>',
      workflow_notes: [
        'Human review required before final storage',
        'Key reports (Revenue Flash, Statistical Recap, Manager Flash) should trigger extraction pipeline',
        'Financial reports (Aging, CC Transactions, Room & Tax) should be stored and queued for extraction',
        'OOO Rooms report is operational priority — extract room count for dashboard',
        'Unclassified files should be manually reviewed and taxonomy updated',
      ],
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}
