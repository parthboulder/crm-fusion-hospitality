/**
 * File classifier for hotel report intake.
 * Matches each file to a property and report type with confidence scoring.
 */

import type { ZipManifestEntry } from './process-zip.js';
import { matchProperty, shortPropertyName, type PropertyMaster } from './property-master.js';
import { matchReportType, BRAND_PRIMARY_REPORT, EXPECTED_DAILY_REPORTS, type ReportType } from './report-taxonomy.js';

export interface ClassifiedFile {
  originalFilename: string;
  fileExtension: string;
  fileSizeBytes: number;
  relativePath: string;
  absolutePath: string;

  reportingDate: string;
  topLevelFolder: string;
  propertyFolderName: string;

  normalizedPropertyName: string | null;
  propertyCode: string | null;
  propertyMatchConfidence: number;

  inferredReportType: string | null;
  reportTypeSlug: string | null;
  reportTypeConfidence: number;

  isKeyReport: boolean;
  storageMode: 'individual' | 'bundle';
  overallConfidence: number;
  notes: string[];
}

export interface PropertySummary {
  propertyCode: string;
  normalizedPropertyName: string;
  brandGroup: string;
  reportingDate: string;
  filesFound: ClassifiedFile[];
  expectedReportsMissing: string[];
  duplicatesOrFlags: string[];
  readinessStatus: 'Ready' | 'Ready with warnings' | 'Needs review';
}

export interface ClassificationResult {
  reportingDate: string;
  topLevelFolder: string;
  totalFiles: number;
  classifiedFiles: ClassifiedFile[];
  propertySummaries: PropertySummary[];
  unclassifiedFiles: ClassifiedFile[];
  warnings: string[];
}

/**
 * Strip date tokens and common junk from a filename to isolate report-type keywords.
 */
function cleanFilenameForReportMatch(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}/g, '')
    .replace(/\d{6,8}/g, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Classify all files from a ZIP manifest.
 */
export function classifyFiles(
  files: ZipManifestEntry[],
  reportingDate: string,
  topLevelFolder: string,
): ClassificationResult {
  const warnings: string[] = [];
  const classifiedFiles: ClassifiedFile[] = [];
  const propertiesMap = new Map<string, ClassifiedFile[]>();

  for (const file of files) {
    const notes: string[] = [];

    // Match property from folder name.
    const propertyMatch = matchProperty(file.propertyFolder);
    let property: PropertyMaster | null = null;
    let propertyConfidence = 0;

    if (propertyMatch) {
      property = propertyMatch.property;
      propertyConfidence = propertyMatch.confidence;
    } else if (file.propertyFolder !== '_root') {
      notes.push(`Could not match property folder "${file.propertyFolder}" to any known property.`);
      warnings.push(`Unmatched property folder: "${file.propertyFolder}"`);
    }

    // Match report type from filename.
    const cleanedFilename = cleanFilenameForReportMatch(file.filename);
    const reportMatch = matchReportType(cleanedFilename, file.extension);
    let reportType: ReportType | null = null;
    let reportConfidence = 0;

    if (reportMatch) {
      reportType = reportMatch.reportType;
      reportConfidence = reportMatch.confidence;
    } else {
      notes.push(`Could not classify report type for "${file.filename}".`);
    }

    // Determine if key report.
    const isKeyReport = reportType
      ? reportType.category === 'key_report' || reportType.priority === 'critical'
      : false;

    // Storage mode.
    const storageMode = reportType?.storageMode ?? 'individual';

    // Overall confidence = weighted average.
    const overallConfidence = propertyConfidence > 0 && reportConfidence > 0
      ? propertyConfidence * 0.4 + reportConfidence * 0.6
      : Math.max(propertyConfidence, reportConfidence) * 0.5;

    if (overallConfidence < 0.5) {
      notes.push('Low confidence classification — flag for manual review.');
    }

    const classified: ClassifiedFile = {
      originalFilename: file.filename,
      fileExtension: file.extension,
      fileSizeBytes: file.fileSizeBytes,
      relativePath: file.relativePath,
      absolutePath: file.absolutePath,
      reportingDate,
      topLevelFolder: file.topLevelFolder,
      propertyFolderName: file.propertyFolder,
      normalizedPropertyName: property?.canonicalName ?? null,
      propertyCode: property?.code ?? null,
      propertyMatchConfidence: propertyConfidence,
      inferredReportType: reportType?.canonicalName ?? null,
      reportTypeSlug: reportType?.slug ?? null,
      reportTypeConfidence: reportConfidence,
      isKeyReport,
      storageMode,
      overallConfidence,
      notes,
    };

    classifiedFiles.push(classified);

    // Group by property for summary.
    const propKey = property?.code ?? `_unknown_${file.propertyFolder}`;
    if (!propertiesMap.has(propKey)) {
      propertiesMap.set(propKey, []);
    }
    propertiesMap.get(propKey)!.push(classified);
  }

  // Build property summaries.
  const propertySummaries: PropertySummary[] = [];

  for (const [propKey, propFiles] of propertiesMap) {
    const firstFile = propFiles[0]!;
    const property = firstFile.normalizedPropertyName
      ? matchProperty(firstFile.propertyFolderName)?.property
      : null;

    const brandGroup = property?.brandGroup ?? 'Unknown';
    const foundSlugs = new Set(propFiles.map((f) => f.reportTypeSlug).filter(Boolean));

    // Determine expected reports for this property's brand.
    const expectedSlugs: string[] = [];
    const brandPrimary = property ? BRAND_PRIMARY_REPORT[brandGroup] : null;

    if (brandPrimary) {
      expectedSlugs.push(brandPrimary);
    } else {
      expectedSlugs.push(...EXPECTED_DAILY_REPORTS.key);
    }
    expectedSlugs.push(...EXPECTED_DAILY_REPORTS.financial);
    expectedSlugs.push(...EXPECTED_DAILY_REPORTS.operational);

    const missingSlugs = expectedSlugs.filter((s) => !foundSlugs.has(s));

    // Check for duplicates.
    const slugCounts = new Map<string, number>();
    for (const f of propFiles) {
      if (f.reportTypeSlug) {
        slugCounts.set(f.reportTypeSlug, (slugCounts.get(f.reportTypeSlug) ?? 0) + 1);
      }
    }
    const duplicates = [...slugCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([slug, count]) => `Duplicate: ${slug} (${count} copies)`);

    // Readiness status.
    let status: PropertySummary['readinessStatus'] = 'Ready';
    const hasUnclassified = propFiles.some((f) => !f.reportTypeSlug);
    const hasLowConfidence = propFiles.some((f) => f.overallConfidence < 0.5);

    if (!firstFile.normalizedPropertyName || hasLowConfidence) {
      status = 'Needs review';
    } else if (missingSlugs.length > 2 || duplicates.length > 0 || hasUnclassified) {
      status = 'Ready with warnings';
    }

    propertySummaries.push({
      propertyCode: firstFile.propertyCode ?? propKey,
      normalizedPropertyName: firstFile.normalizedPropertyName ?? firstFile.propertyFolderName,
      brandGroup,
      reportingDate,
      filesFound: propFiles,
      expectedReportsMissing: missingSlugs,
      duplicatesOrFlags: [
        ...duplicates,
        ...(hasUnclassified ? ['Contains unclassified files'] : []),
      ],
      readinessStatus: status,
    });
  }

  const unclassifiedFiles = classifiedFiles.filter(
    (f) => !f.reportTypeSlug || f.overallConfidence < 0.5,
  );

  return {
    reportingDate,
    topLevelFolder,
    totalFiles: files.length,
    classifiedFiles,
    propertySummaries,
    unclassifiedFiles,
    warnings,
  };
}
