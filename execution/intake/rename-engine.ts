/**
 * Standardized rename and storage path generator for hotel documents.
 * Produces clean, searchable filenames and hierarchical storage paths.
 */

import type { ClassifiedFile } from './classify-files.js';
import { shortPropertyName } from './property-master.js';

export interface RenameProposal {
  originalFilename: string;
  suggestedFilename: string;
  suggestedStoragePath: string;
  reason: string;
}

/**
 * Convert a report type name to PascalCase slug for filenames.
 * "Credit Card Transactions Report" → "CreditCardTransactions"
 */
function reportTypeToFileSlug(reportType: string): string {
  return reportType
    .replace(/\bReport\b/gi, '')
    .replace(/\bSpreadsheet\b/gi, '')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('')
    .replace(/[^A-Za-z0-9]/g, '');
}

/**
 * Convert a property name to a clean PascalCase string for filenames.
 */
function propertyNameToFileSlug(propertyName: string): string {
  return shortPropertyName(propertyName, 35).replace(/\s+/g, '');
}

/**
 * Generate a standardized filename for a classified file.
 *
 * Format: YYYY-MM-DD_<PropertyCode>_<PropertyName>_<ReportType>.<ext>
 * Example: 2026-03-17_HGIOB_HGIOliveBranch_AgingReport.pdf
 */
export function generateStandardFilename(file: ClassifiedFile): string {
  const date = file.reportingDate;
  const code = file.propertyCode ?? 'UNKN';
  const propName = file.normalizedPropertyName
    ? propertyNameToFileSlug(file.normalizedPropertyName)
    : sanitizeForFilename(file.propertyFolderName);
  const reportSlug = file.inferredReportType
    ? reportTypeToFileSlug(file.inferredReportType)
    : sanitizeForFilename(file.originalFilename.replace(/\.[^.]+$/, ''));
  const ext = file.fileExtension.toLowerCase();

  return `${date}_${code}_${propName}_${reportSlug}${ext}`;
}

/**
 * Generate a standardized storage path.
 *
 * Format: /Hotel Reports/Daily Reports/YYYY/MM/DD/<PropertyCode> - <PropertyName>/
 * Example: /Hotel Reports/Daily Reports/2026/03/17/HGIOB - HGI Olive Branch/
 */
export function generateStoragePath(file: ClassifiedFile): string {
  const [year, month, day] = file.reportingDate.split('-');
  const code = file.propertyCode ?? 'UNKN';
  const propName = file.normalizedPropertyName ?? file.propertyFolderName;

  return `/Hotel Reports/Daily Reports/${year}/${month}/${day}/${code} - ${propName}/`;
}

/**
 * Sanitize a string for use in filenames.
 */
function sanitizeForFilename(input: string): string {
  return input
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '')
    .replace(/[._-]+/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 40);
}

/**
 * Generate rename proposals for all classified files.
 */
export function generateRenameProposals(files: ClassifiedFile[]): RenameProposal[] {
  const proposals: RenameProposal[] = [];
  const usedFilenames = new Set<string>();

  for (const file of files) {
    let suggestedFilename = generateStandardFilename(file);

    // Deduplicate if needed.
    if (usedFilenames.has(suggestedFilename)) {
      let counter = 2;
      const base = suggestedFilename.replace(/(\.[^.]+)$/, '');
      const ext = file.fileExtension.toLowerCase();
      while (usedFilenames.has(`${base}_${counter}${ext}`)) {
        counter++;
      }
      suggestedFilename = `${base}_${counter}${ext}`;
    }
    usedFilenames.add(suggestedFilename);

    const suggestedStoragePath = generateStoragePath(file);

    // Build reason string.
    const reasons: string[] = [];

    if (file.normalizedPropertyName) {
      reasons.push(`Property normalized to "${file.normalizedPropertyName}" (code: ${file.propertyCode})`);
    } else {
      reasons.push('Property could not be matched — using folder name');
    }

    if (file.inferredReportType) {
      reasons.push(`Report type classified as "${file.inferredReportType}"`);
    } else {
      reasons.push('Report type could not be determined — using original filename');
    }

    if (file.originalFilename !== suggestedFilename) {
      reasons.push('Filename standardized for consistency and searchability');
    }

    proposals.push({
      originalFilename: file.originalFilename,
      suggestedFilename,
      suggestedStoragePath,
      reason: reasons.join('. ') + '.',
    });
  }

  return proposals;
}
