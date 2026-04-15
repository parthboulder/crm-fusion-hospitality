import { readdir, readFile, mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { TesseractWorkerPool, type WorkerPoolOptions } from './workerPool.js';
import { preprocessImage, type PreprocessOptions } from './preprocess.js';
import { extractPdfPages } from './pdfHandler.js';
import { extractPdfText } from './pdfTextExtractor.js';
import { extractSpreadsheet } from './spreadsheetHandler.js';
import { nvidiaOcrRecognize, type NvidiaOcrOptions } from './nvidiaOcr.js';
import { postprocessText } from './postprocess.js';
import { JobQueue, type QueueOptions } from './queue.js';

const PDF_EXTENSIONS = new Set(['.pdf']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp', '.webp']);
const SPREADSHEET_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv', '.ods', '.tsv']);

export interface PageResult {
  pageNumber: number;
  text: string;
  confidence: number;
}

export interface FileResult {
  fileName: string;
  filePath: string;
  pages: PageResult[];
  totalConfidence: number;
  processingTimeMs: number;
  method: 'native' | 'ocr' | 'nvidia-ocr' | 'spreadsheet';
  error?: string;
}

export interface ProcessorOptions {
  inputDir: string;
  outputDir: string;
  nvidiaApiKey?: string;
  workerPool?: WorkerPoolOptions;
  queue?: Partial<QueueOptions>;
  preprocess?: PreprocessOptions;
  pdfScale?: number;
  recursive?: boolean;
}

const DEFAULT_OPTIONS: Omit<ProcessorOptions, 'inputDir' | 'outputDir'> = {
  pdfScale: 1.5,
  recursive: true,
};

/**
 * Hybrid processor with 3-tier strategy:
 * 1. Spreadsheets (XLSX/CSV/ODS) → direct read (instant)
 * 2. Text-based PDFs → native pdfjs extraction (instant, 100%)
 * 3. Scanned PDFs/images → NVIDIA NIM OCR (fast, ~96% accuracy)
 *    Fallback: Tesseract.js if no NVIDIA API key
 */
export class OcrProcessor {
  private options: ProcessorOptions & typeof DEFAULT_OPTIONS;
  private pool: TesseractWorkerPool;
  private poolInitialized = false;
  private nativeCount = 0;
  private ocrCount = 0;
  private nvidiaOcrCount = 0;
  private spreadsheetCount = 0;
  private useNvidia: boolean;

  constructor(opts: ProcessorOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...opts };
    this.pool = new TesseractWorkerPool(this.options.workerPool);
    this.useNvidia = !!this.options.nvidiaApiKey;
  }

  async run(): Promise<FileResult[]> {
    const startTime = Date.now();

    console.log(`\n[Processor] Scanning: ${this.options.inputDir}`);
    const files = await this.discoverFiles(this.options.inputDir);
    console.log(`[Processor] Found ${files.length} processable files`);
    console.log(`[Processor] OCR engine: ${this.useNvidia ? 'NVIDIA NIM' : 'Tesseract.js'}`);

    if (files.length === 0) {
      console.log('[Processor] No files to process.');
      return [];
    }

    await mkdir(this.options.outputDir, { recursive: true });

    const queue = new JobQueue<string, FileResult>(
      (filePath) => this.processFile(filePath),
      {
        concurrency: this.options.queue?.concurrency ?? (this.useNvidia ? 4 : 6),
        maxRetries: this.options.queue?.maxRetries ?? 2,
        batchSize: this.options.queue?.batchSize ?? 20,
        ...this.options.queue,
      }
    );

    const jobResults = await queue.processAll(files);

    const results: FileResult[] = [];
    for (const job of jobResults) {
      if (job.success && job.result) {
        results.push(job.result);
        await this.writeOutput(job.result);
      } else if (!job.success) {
        results.push({
          fileName: 'unknown',
          filePath: '',
          pages: [],
          totalConfidence: 0,
          processingTimeMs: 0,
          method: 'ocr',
          error: job.error,
        });
      }
    }

    await this.writeSummary(results);

    if (this.poolInitialized) {
      await this.pool.terminate();
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n[Processor] Done! ${results.length} files in ${totalTime}s`);
    console.log(`[Processor] Native: ${this.nativeCount} | Spreadsheet: ${this.spreadsheetCount} | NVIDIA OCR: ${this.nvidiaOcrCount} | Tesseract: ${this.ocrCount}`);

    return results;
  }

  private async processFile(filePath: string): Promise<FileResult> {
    const startTime = Date.now();
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    try {
      let pages: PageResult[];
      let method: FileResult['method'];

      if (SPREADSHEET_EXTENSIONS.has(ext)) {
        const result = extractSpreadsheet(filePath);
        pages = result.sheets.map((s, i) => ({
          pageNumber: i + 1,
          text: s.text,
          confidence: 100,
        }));
        method = 'spreadsheet';
        this.spreadsheetCount++;
      } else if (PDF_EXTENSIONS.has(ext)) {
        // Try native text extraction first
        let nativeResult: Awaited<ReturnType<typeof extractPdfText>> | null = null;
        try {
          nativeResult = await extractPdfText(filePath);
        } catch {
          // Fall through to OCR
        }

        if (nativeResult?.isTextBased) {
          pages = nativeResult.pages.map((p) => ({
            pageNumber: p.pageNumber,
            text: p.text,
            confidence: 100,
          }));
          method = 'native';
          this.nativeCount++;
        } else if (this.useNvidia) {
          pages = await this.processPdfWithNvidia(filePath);
          method = 'nvidia-ocr';
          this.nvidiaOcrCount++;
        } else {
          await this.ensurePoolReady();
          pages = await this.processPdfWithTesseract(filePath);
          method = 'ocr';
          this.ocrCount++;
        }
      } else if (IMAGE_EXTENSIONS.has(ext)) {
        if (this.useNvidia) {
          pages = await this.processImageWithNvidia(filePath);
          method = 'nvidia-ocr';
          this.nvidiaOcrCount++;
        } else {
          await this.ensurePoolReady();
          pages = await this.processImageWithTesseract(filePath);
          method = 'ocr';
          this.ocrCount++;
        }
      } else {
        throw new Error(`Unsupported file type: ${ext}`);
      }

      const totalConfidence =
        pages.length > 0
          ? pages.reduce((sum, p) => sum + p.confidence, 0) / pages.length
          : 0;

      return { fileName, filePath, pages, totalConfidence, processingTimeMs: Date.now() - startTime, method };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`\n[Processor] Error ${fileName}: ${errorMsg}`);
      return {
        fileName, filePath, pages: [], totalConfidence: 0,
        processingTimeMs: Date.now() - startTime, method: 'ocr', error: errorMsg,
      };
    }
  }

  // ─── NVIDIA OCR ───

  private async processPdfWithNvidia(filePath: string): Promise<PageResult[]> {
    const pdfPages = await extractPdfPages(filePath, this.options.pdfScale);
    if (pdfPages.length === 0) return [];

    const results: PageResult[] = [];
    for (const page of pdfPages) {
      const ocr = await nvidiaOcrRecognize(page.imageBuffer, {
        apiKey: this.options.nvidiaApiKey!,
        mergeLevel: 'paragraph',
      });
      results.push({
        pageNumber: page.pageNumber,
        text: ocr.text,
        confidence: ocr.confidence,
      });
    }
    return results;
  }

  private async processImageWithNvidia(filePath: string): Promise<PageResult[]> {
    const imageBuffer = await readFile(filePath);
    const ocr = await nvidiaOcrRecognize(imageBuffer, {
      apiKey: this.options.nvidiaApiKey!,
      mergeLevel: 'paragraph',
    });
    return [{ pageNumber: 1, text: ocr.text, confidence: ocr.confidence }];
  }

  // ─── Tesseract fallback ───

  private async ensurePoolReady(): Promise<void> {
    if (!this.poolInitialized) {
      await this.pool.initialize();
      this.poolInitialized = true;
    }
  }

  private async processPdfWithTesseract(filePath: string): Promise<PageResult[]> {
    const pdfPages = await extractPdfPages(filePath, this.options.pdfScale);
    if (pdfPages.length === 0) return [];

    const preprocessed = await Promise.all(
      pdfPages.map((p) => preprocessImage(p.imageBuffer, this.options.preprocess))
    );

    const ocrResults = await this.pool.recognizeBatch(preprocessed);

    return ocrResults.map((ocr, i) => ({
      pageNumber: pdfPages[i].pageNumber,
      text: postprocessText(ocr.text),
      confidence: ocr.confidence,
    }));
  }

  private async processImageWithTesseract(filePath: string): Promise<PageResult[]> {
    const imageBuffer = await readFile(filePath);
    const preprocessed = await preprocessImage(imageBuffer, this.options.preprocess);
    const ocrResult = await this.pool.recognize(preprocessed);

    return [{ pageNumber: 1, text: postprocessText(ocrResult.text), confidence: ocrResult.confidence }];
  }

  // ─── File discovery ───

  private async discoverFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && this.options.recursive) {
        const subFiles = await this.discoverFiles(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (PDF_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext) || SPREADSHEET_EXTENSIONS.has(ext)) {
          files.push(fullPath);
        }
      }
    }

    return files;
  }

  // ─── Output ───

  private async writeOutput(result: FileResult): Promise<void> {
    const relativePath = path.relative(this.options.inputDir, result.filePath);
    const relativeDir = path.dirname(relativePath);
    const baseName = path.basename(result.fileName, path.extname(result.fileName));

    const outputSubDir = path.join(this.options.outputDir, relativeDir);
    await mkdir(outputSubDir, { recursive: true });

    const jsonOutput = {
      fileName: result.fileName,
      method: result.method,
      pages: result.pages.map((p) => ({
        pageNumber: p.pageNumber,
        text: p.text,
        confidence: p.confidence,
      })),
      totalConfidence: result.totalConfidence,
      processingTimeMs: result.processingTimeMs,
    };

    await writeFile(
      path.join(outputSubDir, `${baseName}.json`),
      JSON.stringify(jsonOutput, null, 2),
      'utf-8'
    );

    const txtOutput = result.pages
      .map((p) =>
        result.pages.length > 1 ? `--- Page ${p.pageNumber} ---\n${p.text}` : p.text
      )
      .join('\n\n');

    await writeFile(path.join(outputSubDir, `${baseName}.txt`), txtOutput, 'utf-8');
  }

  private async writeSummary(results: FileResult[]): Promise<void> {
    const successful = results.filter((r) => !r.error);
    const failed = results.filter((r) => r.error);
    const nativeFiles = successful.filter((r) => r.method === 'native');
    const spreadsheetFiles = successful.filter((r) => r.method === 'spreadsheet');
    const nvidiaFiles = successful.filter((r) => r.method === 'nvidia-ocr');
    const ocrFiles = successful.filter((r) => r.method === 'ocr');
    const avgConfidence =
      successful.length > 0
        ? successful.reduce((sum, r) => sum + r.totalConfidence, 0) / successful.length
        : 0;
    const totalPages = successful.reduce((sum, r) => sum + r.pages.length, 0);

    const summary = {
      totalFiles: results.length,
      successful: successful.length,
      failed: failed.length,
      nativeTextExtraction: nativeFiles.length,
      spreadsheetExtraction: spreadsheetFiles.length,
      nvidiaOcr: nvidiaFiles.length,
      tesseractOcr: ocrFiles.length,
      totalPages,
      averageConfidence: Math.round(avgConfidence * 100) / 100,
      totalProcessingTimeMs: results.reduce((s, r) => s + r.processingTimeMs, 0),
      failures: failed.map((r) => ({ fileName: r.fileName, error: r.error })),
    };

    await writeFile(
      path.join(this.options.outputDir, '_summary.json'),
      JSON.stringify(summary, null, 2),
      'utf-8'
    );

    console.log('\n--- Summary ---');
    console.log(`Files: ${summary.successful}/${summary.totalFiles} | Pages: ${summary.totalPages}`);
    console.log(`Native PDF: ${summary.nativeTextExtraction} | Spreadsheet: ${summary.spreadsheetExtraction} | NVIDIA OCR: ${summary.nvidiaOcr} | Tesseract: ${summary.tesseractOcr} | Failed: ${summary.failed}`);
    console.log(`Avg confidence: ${summary.averageConfidence.toFixed(1)}%`);
    if (failed.length > 0) {
      for (const f of failed.slice(0, 10)) {
        console.log(`  FAIL: ${f.fileName}: ${f.error}`);
      }
    }
  }
}
