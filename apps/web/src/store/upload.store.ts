/**
 * Global upload store — keeps OCR upload progress alive across navigation.
 *
 * The OcrUploadsPage owned this state previously, which meant navigating away
 * unmounted the component and visually dropped the progress card (the XHRs
 * themselves kept running but the user couldn't see them). Lifting state to a
 * store lets the AppShell render a floating mini-card on every page while an
 * upload is in flight.
 */

import { create } from 'zustand';
import { xhrUpload, UploadError } from '../lib/xhr-upload';

const UPLOAD_CONCURRENCY = 2;

export type FileProgressStatus =
  | 'pending'
  | 'uploading'
  | 'done'
  | 'error'
  | 'skipped'
  | 'cancelled';

export interface FileProgress {
  id: number;
  name: string;
  size: number;
  status: FileProgressStatus;
  bytesSent: number;
  errorMessage?: string;
}

export interface BatchState {
  files: FileProgress[];
  totalBytes: number;
  bytesSent: number;
}

interface UploadStore {
  batch: BatchState | null;
  errors: string[];
  /** Internal — not persisted; reset across hard reloads. */
  _abort: AbortController | null;

  startBatch: (
    files: File[],
    accept: (f: File) => boolean,
    onJobsRefresh: () => void,
  ) => Promise<void>;
  abortBatch: () => void;
  clearBatch: () => void;
  setErrors: (errors: string[]) => void;
}

export const useUploadStore = create<UploadStore>((set, get) => ({
  batch: null,
  errors: [],
  _abort: null,

  startBatch: async (rawFiles, accept, onJobsRefresh) => {
    set({ errors: [] });
    if (rawFiles.length === 0) return;

    const accepted: File[] = [];
    const skipped: string[] = [];
    for (const f of rawFiles) {
      if (accept(f)) accepted.push(f);
      else {
        const name =
          (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        skipped.push(`${name}: skipped (unsupported type or size)`);
      }
    }

    if (accepted.length === 0) {
      set({ errors: ['No supported files found.', ...skipped.slice(0, 20)] });
      return;
    }

    const initial: FileProgress[] = accepted.map((f, i) => ({
      id: i,
      name:
        (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
      size: f.size,
      status: 'pending',
      bytesSent: 0,
    }));
    const totalBytes = accepted.reduce((s, f) => s + f.size, 0);

    const controller = new AbortController();
    set({
      batch: { files: initial, totalBytes, bytesSent: 0 },
      _abort: controller,
    });

    // Refuse to modify a file once it's been cancelled — abortBatch() flips
    // every pending/uploading file to 'cancelled' and the in-flight worker
    // coroutines might race with it (progress callback firing after abort,
    // done-handler running before the cancellation propagates). Without
    // this guard, cancelled rows briefly flash and then revert.
    const patchFile = (id: number, patch: Partial<FileProgress>) => {
      const prev = get().batch;
      if (!prev) return;
      const files = prev.files.map((f) => {
        if (f.id !== id) return f;
        if (f.status === 'cancelled') return f; // sticky after cancel
        return { ...f, ...patch };
      });
      const bytesSent = files.reduce((s, f) => s + f.bytesSent, 0);
      set({ batch: { ...prev, files, bytesSent } });
    };

    let nextIndex = 0;
    let completedCount = 0;
    const errs: string[] = [];

    const worker = async () => {
      while (true) {
        if (controller.signal.aborted) return;
        const i = nextIndex++;
        if (i >= accepted.length) return;

        const file = accepted[i]!;
        const id = initial[i]!.id;
        if (controller.signal.aborted) return;
        patchFile(id, { status: 'uploading', bytesSent: 0 });

        const fd = new FormData();
        fd.append('file', file);

        try {
          await xhrUpload<{ data: { jobId: string } }>(
            '/api/v1/ocr/upload',
            fd,
            {
              signal: controller.signal,
              onProgress: (p) => {
                if (controller.signal.aborted) return;
                const sent = p.total > 0 ? p.loaded : file.size;
                patchFile(id, { bytesSent: Math.min(sent, file.size) });
              },
            },
          );
          if (controller.signal.aborted) return;
          patchFile(id, { status: 'done', bytesSent: file.size });
        } catch (e) {
          if (e instanceof UploadError && e.code === 'ABORTED') {
            patchFile(id, { status: 'cancelled', bytesSent: 0 });
            return;
          }
          if (e instanceof UploadError && e.code === 'DUPLICATE_FILE') {
            patchFile(id, { status: 'skipped', bytesSent: file.size });
            errs.push(`${file.name}: ${e.message}`);
            continue;
          }
          const msg =
            e instanceof UploadError
              ? `[${e.code}] ${e.message}`
              : e instanceof Error
                ? e.message
                : 'Upload failed';
          errs.push(`${file.name}: ${msg}`);
          patchFile(id, { status: 'error', errorMessage: msg });
          console.error('ocr upload failed', { file: file.name, error: e });
        }

        completedCount++;
        if (completedCount % 3 === 0) onJobsRefresh();
      }
    };

    const pool = Array.from(
      { length: Math.min(UPLOAD_CONCURRENCY, accepted.length) },
      () => worker(),
    );
    await Promise.all(pool);

    onJobsRefresh();

    if (skipped.length > 0) {
      errs.push(`${skipped.length} file(s) skipped (unsupported type or size).`);
    }
    set({ errors: errs, _abort: null });

    const hardErrors = errs.some((e) => !/duplicate|already uploaded/i.test(e));
    if (!hardErrors && !controller.signal.aborted) {
      setTimeout(() => {
        const cur = get().batch;
        if (
          cur &&
          cur.files.every((f) => f.status === 'done' || f.status === 'skipped')
        ) {
          set({ batch: null });
        }
      }, 2500);
    }
  },

  abortBatch: () => {
    const ctrl = get()._abort;
    ctrl?.abort();
    const prev = get().batch;
    if (!prev) return;
    const files = prev.files.map((f) =>
      f.status === 'pending' || f.status === 'uploading'
        ? { ...f, status: 'cancelled' as const, bytesSent: 0 }
        : f,
    );
    set({
      batch: { ...prev, files, bytesSent: files.reduce((s, f) => s + f.bytesSent, 0) },
    });
  },

  clearBatch: () => set({ batch: null, errors: [] }),
  setErrors: (errors: string[]) => set({ errors }),
}));
