/**
 * @fusion/ocr — hybrid OCR + financial extraction for the Fusion API worker.
 * Lifted from OCR-V1 with a buffer-based entry point added.
 */

export { processFile } from './process-file.js';
export type { OcrResult, OcrPage, ProcessFileOptions } from './process-file.js';

export { extractFinancialData } from './extract-financial.js';
export type { ExtractedFinancialData, FinancialLine } from './extract-financial.js';

export { TesseractWorkerPool } from './engine/workerPool.js';
