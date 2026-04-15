/**
 * Lightweight in-process job queue with concurrency control,
 * retry logic, and memory-safe batching.
 * No external dependencies (Redis, BullMQ) needed.
 */

export interface Job<T> {
  id: string;
  data: T;
  retries: number;
  maxRetries: number;
}

export interface QueueOptions {
  concurrency: number;
  maxRetries: number;
  retryDelayMs: number;
  batchSize: number;
}

export interface JobResult<R> {
  jobId: string;
  success: boolean;
  result?: R;
  error?: string;
}

const DEFAULT_QUEUE_OPTIONS: QueueOptions = {
  concurrency: 4,
  maxRetries: 2,
  retryDelayMs: 1000,
  batchSize: 20,
};

export class JobQueue<T, R> {
  private options: QueueOptions;
  private processor: (data: T) => Promise<R>;
  private activeCount = 0;
  private completed = 0;
  private failed = 0;
  private totalJobs = 0;

  constructor(
    processor: (data: T) => Promise<R>,
    opts: Partial<QueueOptions> = {}
  ) {
    this.options = { ...DEFAULT_QUEUE_OPTIONS, ...opts };
    this.processor = processor;
  }

  /**
   * Process all items with concurrency control and batching.
   * Returns results for all items (including failures).
   */
  async processAll(items: T[]): Promise<JobResult<R>[]> {
    this.totalJobs = items.length;
    this.completed = 0;
    this.failed = 0;

    const results: JobResult<R>[] = [];
    const batches = this.createBatches(items, this.options.batchSize);

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
      console.log(
        `[Queue] Processing batch ${batchIdx + 1}/${batches.length} (${batch.length} items)`
      );

      const batchResults = await this.processBatch(batch, batchIdx);
      results.push(...batchResults);

      // Brief pause between batches to let GC run
      if (batchIdx < batches.length - 1) {
        await this.delay(100);
      }
    }

    console.log(
      `[Queue] Complete: ${this.completed} succeeded, ${this.failed} failed out of ${this.totalJobs}`
    );

    return results;
  }

  private async processBatch(
    items: T[],
    batchOffset: number
  ): Promise<JobResult<R>[]> {
    const jobs: Job<T>[] = items.map((data, idx) => ({
      id: `job-${batchOffset * this.options.batchSize + idx}`,
      data,
      retries: 0,
      maxRetries: this.options.maxRetries,
    }));

    const results: JobResult<R>[] = [];
    let jobIndex = 0;

    return new Promise((resolve) => {
      const processNext = () => {
        while (
          this.activeCount < this.options.concurrency &&
          jobIndex < jobs.length
        ) {
          const job = jobs[jobIndex++];
          this.activeCount++;
          this.executeJob(job).then((result) => {
            this.activeCount--;
            results.push(result);

            if (result.success) {
              this.completed++;
            } else {
              this.failed++;
            }

            this.logProgress();

            if (results.length === jobs.length) {
              resolve(results);
            } else {
              processNext();
            }
          });
        }
      };

      processNext();
    });
  }

  private async executeJob(job: Job<T>): Promise<JobResult<R>> {
    try {
      const result = await this.processor(job.data);
      return { jobId: job.id, success: true, result };
    } catch (err) {
      if (job.retries < job.maxRetries) {
        job.retries++;
        console.log(
          `[Queue] Retrying ${job.id} (attempt ${job.retries}/${job.maxRetries})`
        );
        await this.delay(this.options.retryDelayMs * job.retries);
        return this.executeJob(job);
      }

      const errorMsg =
        err instanceof Error ? err.message : String(err);
      console.error(`[Queue] Job ${job.id} failed permanently: ${errorMsg}`);
      return { jobId: job.id, success: false, error: errorMsg };
    }
  }

  private logProgress(): void {
    const done = this.completed + this.failed;
    const pct = ((done / this.totalJobs) * 100).toFixed(1);
    process.stdout.write(
      `\r[Queue] Progress: ${done}/${this.totalJobs} (${pct}%) | OK: ${this.completed} | Failed: ${this.failed}`
    );
    if (done === this.totalJobs) {
      process.stdout.write('\n');
    }
  }

  private createBatches<U>(items: U[], batchSize: number): U[][] {
    const batches: U[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  get stats() {
    return {
      total: this.totalJobs,
      completed: this.completed,
      failed: this.failed,
      active: this.activeCount,
    };
  }
}
