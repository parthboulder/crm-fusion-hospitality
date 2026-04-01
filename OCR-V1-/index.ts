import path from 'path';
import { OcrProcessor } from './lib/ocr/processor.js';
import os from 'os';

/**
 * CLI Entry Point for OCR Processing System.
 *
 * Usage:
 *   npx tsx index.ts <input-folder> [output-folder] [options]
 *
 * Options:
 *   --nvidia-key=KEY  NVIDIA NIM API key for high-accuracy OCR on scanned PDFs
 *   --workers=N       Tesseract workers (fallback if no NVIDIA key)
 *   --concurrency=N   Files processed in parallel
 *   --scale=N         PDF rendering scale (default: 1.5)
 *   --batch=N         Batch size for queue (default: 20)
 */

function parseArgs() {
  const args = process.argv.slice(2);
  const flags: Record<string, string> = {};
  const positional: string[] = [];

  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx > -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        flags[arg.slice(2)] = 'true';
      }
    } else {
      positional.push(arg);
    }
  }

  const cpuCount = os.cpus().length;
  const nvidiaKey = flags['nvidia-key'] || process.env.NVIDIA_API_KEY || '';

  return {
    inputDir: positional[0] || '',
    outputDir: positional[1] || './output',
    nvidiaKey,
    workers: parseInt(flags['workers'] || '') || Math.min(cpuCount, 6),
    concurrency: parseInt(flags['concurrency'] || '') || (nvidiaKey ? 4 : Math.min(cpuCount, 6)),
    scale: parseFloat(flags['scale'] || '') || 1.5,
    batchSize: parseInt(flags['batch'] || '') || 20,
  };
}

async function main(): Promise<void> {
  const config = parseArgs();

  if (!config.inputDir) {
    console.log(`
OCR Processing System v2.0 (Hybrid)
=====================================

Usage:
  npx tsx index.ts <input-folder> [output-folder] [options]

Options:
  --nvidia-key=KEY   NVIDIA NIM API key (high-accuracy OCR for scanned PDFs)
  --workers=N        Tesseract workers if no NVIDIA key (default: CPU cores)
  --concurrency=N    Files in parallel (default: 4 with NVIDIA, 6 without)
  --scale=N          PDF render scale (default: 1.5)
  --batch=N          Batch size (default: 20)

Environment:
  NVIDIA_API_KEY     Alternative to --nvidia-key flag

Strategy:
  1. Spreadsheets (XLSX/CSV/ODS) → direct read (instant)
  2. Text-based PDFs → native extraction (instant, 100% accurate)
  3. Scanned PDFs/images → NVIDIA NIM OCR (~96%) or Tesseract fallback

Examples:
  npx tsx index.ts "./input" "./output" --nvidia-key=nvapi-xxx
  npx tsx index.ts "C:/path/to/pdfs" "./results"
    `);
    process.exit(1);
  }

  const inputDir = path.resolve(config.inputDir);
  const outputDir = path.resolve(config.outputDir);
  const ocrEngine = config.nvidiaKey ? 'NVIDIA NIM' : 'Tesseract.js';

  console.log(`
============================================
  OCR Processing System v2.0 (Hybrid)
============================================
  Input:       ${inputDir}
  Output:      ${outputDir}
  OCR Engine:  ${ocrEngine}
  Concurrency: ${config.concurrency}
  PDF Scale:   ${config.scale}
  Batch Size:  ${config.batchSize}
============================================
`);

  const processor = new OcrProcessor({
    inputDir,
    outputDir,
    nvidiaApiKey: config.nvidiaKey || undefined,
    workerPool: {
      numWorkers: config.workers,
      language: 'eng',
    },
    queue: {
      concurrency: config.concurrency,
      batchSize: config.batchSize,
      maxRetries: 2,
    },
    pdfScale: config.scale,
    recursive: true,
  });

  const results = await processor.run();

  const successful = results.filter((r) => !r.error);
  const totalPages = successful.reduce((s, r) => s + r.pages.length, 0);
  console.log(`\nOutput saved to: ${outputDir}`);
  console.log(`Total files: ${results.length} | Pages: ${totalPages}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
