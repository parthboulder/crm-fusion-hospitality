/**
 * Main entry point for the hotel report ZIP intake pipeline.
 *
 * Usage: npx tsx execution/intake/run-intake.ts <path-to-zip> [--date YYYY-MM-DD]
 *
 * Outputs all results to .tmp/intake/output/
 */

import fs from 'node:fs';
import path from 'node:path';
import { processZip } from './process-zip.js';
import { classifyFiles } from './classify-files.js';
import { generateRenameProposals } from './rename-engine.js';
import {
  generateInventoryMarkdown,
  generatePropertySummaryMarkdown,
  generateExtractionMapMarkdown,
  generateExecutiveSummary,
  generateJsonOutput,
} from './generate-inventory.js';

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: npx tsx execution/intake/run-intake.ts <path-to-zip> [--date YYYY-MM-DD]');
    process.exit(1);
  }

  const zipPath = args[0]!;
  let overrideDate: string | null = null;

  const dateIdx = args.indexOf('--date');
  if (dateIdx !== -1 && args[dateIdx + 1]) {
    overrideDate = args[dateIdx + 1]!;
  }

  if (!fs.existsSync(zipPath)) {
    console.error(`ZIP file not found: ${zipPath}`);
    process.exit(1);
  }

  console.log(`Processing ZIP: ${zipPath}`);

  // Step 1: Unzip and build manifest.
  const manifest = processZip(zipPath);
  console.log(`Extracted to: ${manifest.extractPath}`);
  console.log(`Top-level folder: ${manifest.topLevelFolder}`);
  console.log(`Inferred date: ${manifest.inferredDate ?? 'UNKNOWN'}`);
  console.log(`Property folders: ${manifest.propertyFolders.length}`);
  console.log(`Total files: ${manifest.files.length}`);

  const reportingDate = overrideDate ?? manifest.inferredDate;
  if (!reportingDate) {
    console.error('Could not determine reporting date. Use --date YYYY-MM-DD to specify.');
    process.exit(1);
  }

  // Step 2: Classify all files.
  const classification = classifyFiles(manifest.files, reportingDate, manifest.topLevelFolder);
  console.log(`\nClassified ${classification.classifiedFiles.length} files across ${classification.propertySummaries.length} properties.`);
  console.log(`Unclassified: ${classification.unclassifiedFiles.length}`);

  if (classification.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const w of classification.warnings) {
      console.log(`  - ${w}`);
    }
  }

  // Step 3: Generate rename proposals.
  const proposals = generateRenameProposals(classification.classifiedFiles);

  // Step 4: Generate all outputs.
  const outputDir = path.join(process.cwd(), '.tmp', 'intake', 'output');
  fs.mkdirSync(outputDir, { recursive: true });

  // Executive summary.
  const summary = generateExecutiveSummary(classification, proposals);
  fs.writeFileSync(path.join(outputDir, 'summary.md'), summary, 'utf-8');

  // File inventory (markdown).
  const inventory = generateInventoryMarkdown(classification, proposals);
  fs.writeFileSync(path.join(outputDir, 'inventory.md'), inventory, 'utf-8');

  // Property summaries (markdown).
  const propSummary = generatePropertySummaryMarkdown(classification.propertySummaries);
  fs.writeFileSync(path.join(outputDir, 'property-summaries.md'), propSummary, 'utf-8');

  // Extraction map (markdown).
  const extractionMap = generateExtractionMapMarkdown();
  fs.writeFileSync(path.join(outputDir, 'extraction-map.md'), extractionMap, 'utf-8');

  // Full JSON output.
  const jsonOutput = generateJsonOutput(classification, proposals);
  fs.writeFileSync(
    path.join(outputDir, 'intake-result.json'),
    JSON.stringify(jsonOutput, null, 2),
    'utf-8',
  );

  // Also write individual JSON files for easier consumption.
  fs.writeFileSync(
    path.join(outputDir, 'inventory.json'),
    JSON.stringify(classification.classifiedFiles, null, 2),
    'utf-8',
  );
  fs.writeFileSync(
    path.join(outputDir, 'renames.json'),
    JSON.stringify(proposals, null, 2),
    'utf-8',
  );
  fs.writeFileSync(
    path.join(outputDir, 'property-summaries.json'),
    JSON.stringify(classification.propertySummaries, null, 2),
    'utf-8',
  );

  console.log(`\nOutputs written to: ${outputDir}`);
  console.log('  - summary.md');
  console.log('  - inventory.md + inventory.json');
  console.log('  - property-summaries.md + property-summaries.json');
  console.log('  - extraction-map.md');
  console.log('  - intake-result.json (full JSON)');
  console.log('  - renames.json');
  console.log('\nReview outputs before approving storage.');
}

main();
