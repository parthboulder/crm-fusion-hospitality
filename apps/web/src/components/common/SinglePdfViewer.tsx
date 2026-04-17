/**
 * Standalone single-file PDF preview modal — used by OCR Uploads and Documents
 * rows where there's just one file to show (no cross-file search). For
 * multi-match search flows use PdfViewerModal via PdfSearchProvider instead.
 */

import { useEffect, useRef, useState } from 'react';
import {
  XMarkIcon,
  MagnifyingGlassPlusIcon,
  MagnifyingGlassMinusIcon,
  ArrowTopRightOnSquareIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';

interface SinglePdfViewerProps {
  url: string;
  title: string;
  subtitle?: string;
  /** Optional filename for the download button; defaults to `title`. */
  downloadName?: string;
  onClose: () => void;
}

export function SinglePdfViewer({ url, title, subtitle, downloadName, onClose }: SinglePdfViewerProps) {
  const [zoom, setZoom] = useState(100);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose();
  }

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
    >
      <div className="bg-white rounded-lg shadow-2xl flex flex-col w-full max-w-[1200px] h-[90vh]">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#e5e5e5] bg-[#f9fafb] rounded-t-lg">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-[#1a1a1a] truncate">{title}</p>
            {subtitle && <p className="text-[11px] text-[#6b7280] truncate">{subtitle}</p>}
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setZoom((z) => Math.max(50, z - 25))}
              className="p-1 text-[#6b7280] hover:text-[#1a1a1a] hover:bg-[#e5e7eb] rounded"
              title="Zoom out"
            >
              <MagnifyingGlassMinusIcon className="w-4 h-4" />
            </button>
            <span className="text-[11px] tabular-nums text-[#6b7280] w-10 text-center">{zoom}%</span>
            <button
              onClick={() => setZoom((z) => Math.min(200, z + 25))}
              className="p-1 text-[#6b7280] hover:text-[#1a1a1a] hover:bg-[#e5e7eb] rounded"
              title="Zoom in"
            >
              <MagnifyingGlassPlusIcon className="w-4 h-4" />
            </button>
          </div>

          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="p-1.5 text-[#6b7280] hover:text-[#1a1a1a] hover:bg-[#e5e7eb] rounded"
            title="Open in new tab"
          >
            <ArrowTopRightOnSquareIcon className="w-4 h-4" />
          </a>
          <a
            href={url}
            download={downloadName ?? title}
            className="p-1.5 text-[#6b7280] hover:text-[#1a1a1a] hover:bg-[#e5e7eb] rounded"
            title="Download"
          >
            <ArrowDownTrayIcon className="w-4 h-4" />
          </a>
          <button
            onClick={onClose}
            className="p-1.5 text-[#6b7280] hover:text-[#1a1a1a] hover:bg-[#e5e7eb] rounded"
            title="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-[#525659] min-h-0">
          <div style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}>
            <iframe
              key={url}
              src={url}
              className="w-full border-0"
              style={{ height: `${Math.round(90 * (100 / zoom))}vh`, minWidth: 800 }}
              title={title}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
