import { createWorker, createScheduler, OEM, PSM } from 'tesseract.js';
import type { Scheduler, Worker } from 'tesseract.js';
import os from 'os';

export interface OcrResult {
  text: string;
  confidence: number;
}

export interface WorkerPoolOptions {
  numWorkers?: number;
  language?: string;
  oem?: (typeof OEM)[keyof typeof OEM];
  psm?: (typeof PSM)[keyof typeof PSM];
}

const DEFAULT_POOL_OPTIONS: Required<WorkerPoolOptions> = {
  numWorkers: Math.min(os.cpus().length, 8),
  language: 'eng',
  oem: OEM.LSTM_ONLY,
  psm: PSM.AUTO,
};

/**
 * Manages a pool of Tesseract.js workers via the built-in Scheduler.
 * Workers are initialized once and reused across all OCR jobs.
 * The scheduler automatically distributes work across workers.
 */
export class TesseractWorkerPool {
  private scheduler: Scheduler;
  private workers: Worker[] = [];
  private initialized = false;
  private options: Required<WorkerPoolOptions>;

  constructor(opts: WorkerPoolOptions = {}) {
    this.options = { ...DEFAULT_POOL_OPTIONS, ...opts };
    this.scheduler = createScheduler();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log(
      `[WorkerPool] Initializing ${this.options.numWorkers} Tesseract workers (lang=${this.options.language})...`
    );

    const workerPromises: Promise<Worker>[] = [];

    for (let i = 0; i < this.options.numWorkers; i++) {
      workerPromises.push(this.createAndConfigureWorker());
    }

    this.workers = await Promise.all(workerPromises);

    for (const worker of this.workers) {
      this.scheduler.addWorker(worker);
    }

    this.initialized = true;
    console.log(`[WorkerPool] All ${this.workers.length} workers ready.`);
  }

  private async createAndConfigureWorker(): Promise<Worker> {
    const worker = await createWorker(this.options.language, this.options.oem, {
      cacheMethod: 'readOnly',
    });

    await worker.setParameters({
      tessedit_pageseg_mode: this.options.psm as any,
      preserve_interword_spaces: '1',
    });

    return worker;
  }

  /**
   * Recognize text from an image buffer.
   * The scheduler handles distribution to available workers.
   */
  async recognize(imageBuffer: Buffer | Uint8Array): Promise<OcrResult> {
    if (!this.initialized) {
      throw new Error('WorkerPool not initialized. Call initialize() first.');
    }

    const buf = Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer);
    const result = await this.scheduler.addJob('recognize', buf);

    return {
      text: result.data.text,
      confidence: result.data.confidence,
    };
  }

  /**
   * Recognize multiple images concurrently via the scheduler.
   * The scheduler automatically queues and distributes work.
   */
  async recognizeBatch(
    imageBuffers: (Buffer | Uint8Array)[]
  ): Promise<OcrResult[]> {
    if (!this.initialized) {
      throw new Error('WorkerPool not initialized. Call initialize() first.');
    }

    const jobs = imageBuffers.map((buf) =>
      this.scheduler.addJob(
        'recognize',
        Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
      )
    );

    const results = await Promise.all(jobs);

    return results.map((r) => ({
      text: r.data.text,
      confidence: r.data.confidence,
    }));
  }

  /**
   * Get the number of active workers.
   */
  get workerCount(): number {
    return this.workers.length;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Gracefully terminate all workers and the scheduler.
   */
  async terminate(): Promise<void> {
    if (!this.initialized) return;

    await this.scheduler.terminate();
    this.workers = [];
    this.initialized = false;
    console.log('[WorkerPool] All workers terminated.');
  }
}
