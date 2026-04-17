/**
 * Floating upload progress card pinned to the bottom-right of the viewport.
 * Mounted once in AppShell so progress survives navigation between pages.
 *
 * Hidden when the user is on /ocr (the OcrUploadsPage already shows the card
 * inline above the jobs table) and when no batch is active.
 */

import { useLocation, useNavigate } from 'react-router-dom';
import { XMarkIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { useUploadStore } from '../../store/upload.store';
import { UploadProgressCard } from './UploadProgressCard';

export function GlobalUploadCard() {
  const location = useLocation();
  const navigate = useNavigate();
  const batch = useUploadStore((s) => s.batch);
  const abortBatch = useUploadStore((s) => s.abortBatch);
  const clearBatch = useUploadStore((s) => s.clearBatch);

  if (!batch) return null;
  if (location.pathname === '/ocr') return null;

  const allDone = batch.files.every(
    (f) =>
      f.status === 'done' ||
      f.status === 'error' ||
      f.status === 'cancelled' ||
      f.status === 'skipped',
  );

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[420px] max-w-[calc(100vw-2rem)]">
      <div className="relative">
        <div className="absolute -top-2 -right-2 flex gap-1 z-10">
          <button
            onClick={() => navigate('/ocr')}
            className="p-1 rounded-full bg-white border border-neutral-200 shadow-sm text-neutral-500 hover:text-brand-600 hover:border-brand-200 transition-colors"
            title="Open OCR Uploads"
          >
            <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
          </button>
          {allDone && (
            <button
              onClick={clearBatch}
              className="p-1 rounded-full bg-white border border-neutral-200 shadow-sm text-neutral-500 hover:text-danger-600 hover:border-danger-200 transition-colors"
              title="Dismiss"
            >
              <XMarkIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <UploadProgressCard batch={batch} onAbort={abortBatch} className="shadow-lg" />
      </div>
    </div>
  );
}
