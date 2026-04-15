/**
 * Buffer-based OCR entry point. Writes the buffer to a temp file, runs the
 * 4-tier strategy (native PDF text → spreadsheet → NVIDIA OCR → Tesseract),
 * cleans up, and returns a structured result.
 */

import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extractPdfText } from './engine/pdfTextExtractor.js';
import { extractPdfPages } from './engine/pdfHandler.js';
import { extractSpreadsheet } from './engine/spreadsheetHandler.js';
import { nvidiaOcrRecognize } from './engine/nvidiaOcr.js';
import { TesseractWorkerPool } from './engine/workerPool.js';
import { preprocessImage } from './engine/preprocess.js';
import { postprocessText } from './engine/postprocess.js';

export interface OcrPage {
  pageNumber: number;
  text: string;
  confidence: number;
}

export interface OcrResult {
  method: 'native' | 'spreadsheet' | 'nvidia-ocr' | 'tesseract';
  pages: OcrPage[];
  fullText: string;
  totalConfidence: number;
  processingTimeMs: number;
}

export interface ProcessFileOptions {
  /** Original filename — used only to decide file extension for routing. */
  originalName: string;
  /** File contents. */
  buffer: Buffer;
  /** MIME type for extra routing hints (optional). */
  mimeType?: string | undefined;
  /** NVIDIA NIM API key. When absent, falls back to Tesseract for scanned docs. */
  nvidiaApiKey?: string | undefined;
  /** Shared Tesseract pool (owned by the worker, not this function). */
  tesseractPool?: TesseractWorkerPool | undefined;
  /** PDF render scale for OCR routes. Default 1.5. */
  pdfScale?: number | undefined;
}

const PDF_EXTS = new Set(['.pdf']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp', '.webp']);
const SPREADSHEET_EXTS = new Set(['.xlsx', '.xls', '.csv', '.ods', '.tsv']);

export async function processFile(opts: ProcessFileOptions): Promise<OcrResult> {
  const startTime = Date.now();
  const ext = path.extname(opts.originalName).toLowerCase();
  const pdfScale = opts.pdfScale ?? 1.5;

  // Stage the buffer on disk — pdfjs/tesseract APIs take paths.
  // The dir is created *before* the try, but we still guarantee cleanup
  // in a finally that checks `dir` — if mkdtemp itself throws, there's
  // nothing to clean up.
  let dir: string | null = null;
  try {
    dir = await mkdtemp(path.join(tmpdir(), 'ocr-'));
    const filePath = path.join(dir, `input${ext || '.bin'}`);
    await writeFile(filePath, opts.buffer);

    let pages: OcrPage[];
    let method: OcrResult['method'];

    if (SPREADSHEET_EXTS.has(ext)) {
      const result = extractSpreadsheet(filePath);
      pages = result.sheets.map((s: any, i: number) => ({
        pageNumber: i + 1,
        text: s.text,
        confidence: 100,
      }));
      method = 'spreadsheet';
    } else if (PDF_EXTS.has(ext)) {
      // Tier 1: native text.
      let nativeResult: Awaited<ReturnType<typeof extractPdfText>> | null = null;
      try {
        nativeResult = await extractPdfText(filePath);
      } catch {
        nativeResult = null;
      }

      if (nativeResult?.isTextBased) {
        pages = nativeResult.pages.map((p) => ({
          pageNumber: p.pageNumber,
          text: p.text,
          confidence: 100,
        }));
        method = 'native';
      } else if (opts.nvidiaApiKey) {
        const pdfPages = await extractPdfPages(filePath, pdfScale);
        pages = [];
        for (const page of pdfPages) {
          const ocr = await nvidiaOcrRecognize(page.imageBuffer, {
            apiKey: opts.nvidiaApiKey,
            mergeLevel: 'paragraph',
          });
          pages.push({
            pageNumber: page.pageNumber,
            text: ocr.text,
            confidence: ocr.confidence,
          });
        }
        method = 'nvidia-ocr';
      } else {
        const pool = opts.tesseractPool ?? new TesseractWorkerPool({ numWorkers: 2 });
        if (!opts.tesseractPool) await pool.initialize();
        try {
          const pdfPages = await extractPdfPages(filePath, pdfScale);
          const preprocessed = await Promise.all(
            pdfPages.map((p) => preprocessImage(p.imageBuffer))
          );
          const ocrResults = await pool.recognizeBatch(preprocessed);
          pages = ocrResults.map((ocr, i) => ({
            pageNumber: pdfPages[i]?.pageNumber ?? i + 1,
            text: postprocessText(ocr.text),
            confidence: ocr.confidence,
          }));
          method = 'tesseract';
        } finally {
          if (!opts.tesseractPool) await pool.terminate();
        }
      }
    } else if (IMAGE_EXTS.has(ext)) {
      if (opts.nvidiaApiKey) {
        const ocr = await nvidiaOcrRecognize(opts.buffer, {
          apiKey: opts.nvidiaApiKey,
          mergeLevel: 'paragraph',
        });
        pages = [{ pageNumber: 1, text: ocr.text, confidence: ocr.confidence }];
        method = 'nvidia-ocr';
      } else {
        const pool = opts.tesseractPool ?? new TesseractWorkerPool({ numWorkers: 1 });
        if (!opts.tesseractPool) await pool.initialize();
        try {
          const preprocessed = await preprocessImage(opts.buffer);
          const ocr = await pool.recognize(preprocessed);
          pages = [{
            pageNumber: 1,
            text: postprocessText(ocr.text),
            confidence: ocr.confidence,
          }];
          method = 'tesseract';
        } finally {
          if (!opts.tesseractPool) await pool.terminate();
        }
      }
    } else {
      throw new Error(`Unsupported file extension: ${ext || '(none)'}`);
    }

    const totalConfidence =
      pages.length > 0
        ? pages.reduce((s, p) => s + p.confidence, 0) / pages.length
        : 0;

    const fullText = pages
      .map((p) => (pages.length > 1 ? `--- Page ${p.pageNumber} ---\n${p.text}` : p.text))
      .join('\n\n');

    return {
      method,
      pages,
      fullText,
      totalConfidence,
      processingTimeMs: Date.now() - startTime,
    };
  } finally {
    // Guaranteed recursive cleanup — handles the case where pdfjs or other
    // libs left sidecar files behind. `force: true` prevents ENOENT when
    // the dir creation itself failed.
    if (dir) {
      await rm(dir, { recursive: true, force: true }).catch(() => null);
    }
  }
}
