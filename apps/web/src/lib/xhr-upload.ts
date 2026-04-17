/**
 * XHR-based multipart upload with progress events and cancellation.
 *
 * We use XMLHttpRequest instead of fetch because fetch doesn't expose upload
 * progress events in browsers (2026-era Streams support is still uneven for
 * request bodies). XHR is the straightforward path for a progress bar.
 */

export interface UploadProgress {
  /** 0..1 */
  fraction: number;
  /** Bytes sent so far. */
  loaded: number;
  /** Total bytes to send (may be 0 if the browser can't determine it). */
  total: number;
}

export interface UploadOptions {
  onProgress?: (p: UploadProgress) => void;
  /** Abort signal — calling `.abort()` on the controller cancels the request. */
  signal?: AbortSignal;
}

export class UploadError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

/**
 * POSTs FormData to `path` with upload progress callbacks. Returns the parsed
 * JSON response on 2xx, throws UploadError on any other status or network failure.
 */
export function xhrUpload<T>(
  path: string,
  formData: FormData,
  options: UploadOptions = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path, true);
    xhr.withCredentials = true;
    xhr.responseType = 'json';

    xhr.upload.addEventListener('progress', (e) => {
      if (!options.onProgress) return;
      options.onProgress({
        loaded: e.loaded,
        total: e.lengthComputable ? e.total : 0,
        fraction: e.lengthComputable && e.total > 0 ? e.loaded / e.total : 0,
      });
    });

    xhr.addEventListener('load', () => {
      const body = xhr.response as {
        success?: boolean;
        error?: { code?: string; message?: string };
      } | null;

      if (xhr.status >= 200 && xhr.status < 300) {
        // Signal final 100% in case the progress event didn't fire.
        options.onProgress?.({ loaded: 1, total: 1, fraction: 1 });
        resolve(body as T);
        return;
      }

      reject(
        new UploadError(
          body?.error?.code ?? 'HTTP_ERROR',
          body?.error?.message ?? `Request failed with status ${xhr.status}`,
          xhr.status,
        ),
      );
    });

    xhr.addEventListener('error', () => {
      reject(new UploadError('NETWORK_ERROR', 'Network error during upload', 0));
    });

    xhr.addEventListener('abort', () => {
      reject(new UploadError('ABORTED', 'Upload cancelled', 0));
    });

    if (options.signal) {
      // If already aborted before send, reject immediately. Calling xhr.abort()
      // on an OPENED (not yet sent) XHR doesn't dispatch the 'abort' event,
      // so the promise would otherwise hang forever.
      if (options.signal.aborted) {
        reject(new UploadError('ABORTED', 'Upload cancelled', 0));
        return;
      }
      options.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(formData);
  });
}
