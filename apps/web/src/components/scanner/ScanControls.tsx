/**
 * Scan controls — folder path input, scan button, and live progress bar.
 * Polls /data/scan-progress.json while a scan is running.
 */

import { useState, useEffect, useCallback } from 'react';
import { clsx } from 'clsx';
import {
  FolderOpenIcon,
  PlayIcon,
  StopIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';

interface ScanProgress {
  status: 'scanning' | 'done' | 'error';
  startedAt: string;
  currentDate: string;
  currentDateIndex: number;
  totalDateFolders: number;
  filesProcessed: number;
  filesInCurrentDate: number;
  totalFilesEstimate: number;
  elapsedMs: number;
  currentFile: string;
  errorMessage?: string;
}

interface ScanControlsProps {
  onScanComplete: () => void;
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export function ScanControls({ onScanComplete }: ScanControlsProps) {
  const [folderPath, setFolderPath] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [showPanel, setShowPanel] = useState(false);

  // Poll progress file while scanning
  useEffect(() => {
    if (!isScanning && !showPanel) return;

    const poll = setInterval(async () => {
      try {
        const res = await fetch('/data/scan-progress.json?t=' + Date.now());
        if (res.ok) {
          const data: ScanProgress = await res.json();
          setProgress(data);

          if (data.status === 'done') {
            setIsScanning(false);
            onScanComplete();
          } else if (data.status === 'error') {
            setIsScanning(false);
          }
        }
      } catch {
        // File doesn't exist yet — ignore
      }
    }, 2000);

    return () => clearInterval(poll);
  }, [isScanning, showPanel, onScanComplete]);

  // Check for existing progress on mount
  useEffect(() => {
    fetch('/data/scan-progress.json?t=' + Date.now())
      .then((r) => r.ok ? r.json() : null)
      .then((data: ScanProgress | null) => {
        if (data) {
          setProgress(data);
          if (data.status === 'scanning') {
            setIsScanning(true);
            setShowPanel(true);
          }
        }
      })
      .catch(() => null);
  }, []);

  const handleStartScan = useCallback(() => {
    if (!folderPath.trim()) return;
    setIsScanning(true);
    setShowPanel(true);
    setProgress(null);

    // Start the scan via the scanner script
    // This calls a tiny endpoint that spawns the process
    fetch('/api/v1/scanner/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath: folderPath.trim() }),
    }).catch(() => {
      // If API isn't available, show instructions
      setProgress({
        status: 'error',
        startedAt: new Date().toISOString(),
        currentDate: '',
        currentDateIndex: 0,
        totalDateFolders: 0,
        filesProcessed: 0,
        filesInCurrentDate: 0,
        totalFilesEstimate: 0,
        elapsedMs: 0,
        currentFile: '',
        errorMessage: 'Run manually: pnpm tsx scripts/scanWithOCR.ts "' + folderPath + '"',
      });
      setIsScanning(false);
    });
  }, [folderPath]);

  const pct = progress && progress.totalFilesEstimate > 0
    ? Math.min(100, Math.round((progress.filesProcessed / progress.totalFilesEstimate) * 100))
    : 0;

  return (
    <div className="card overflow-hidden">
      {/* Header bar — always visible */}
      <button
        onClick={() => setShowPanel(!showPanel)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 transition-colors text-left"
      >
        {isScanning ? (
          <ArrowPathIcon className="w-5 h-5 text-brand-600 animate-spin shrink-0" />
        ) : progress?.status === 'done' ? (
          <CheckCircleIcon className="w-5 h-5 text-success-600 shrink-0" />
        ) : (
          <FolderOpenIcon className="w-5 h-5 text-neutral-400 shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-neutral-800">
            {isScanning ? 'Scanning in progress...' : progress?.status === 'done' ? 'Scan complete' : 'Scan Files'}
          </p>
          {isScanning && progress && (
            <p className="text-xs text-neutral-400 mt-0.5">
              {progress.filesProcessed}/{progress.totalFilesEstimate} files &middot;
              Date {progress.currentDateIndex}/{progress.totalDateFolders} &middot;
              {fmtDuration(progress.elapsedMs)}
            </p>
          )}
        </div>

        {/* Mini progress bar in header when scanning */}
        {isScanning && (
          <div className="w-24 h-1.5 rounded-full bg-neutral-100 overflow-hidden shrink-0">
            <div
              className="h-full rounded-full bg-brand-500 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}

        <span className="text-xs text-neutral-400">{showPanel ? '▲' : '▼'}</span>
      </button>

      {/* Expanded panel */}
      {showPanel && (
        <div className="border-t border-neutral-100 px-4 py-4 space-y-4">
          {/* Folder path input */}
          <div>
            <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-1.5 block">Folder Path</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <FolderOpenIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                <input
                  type="text"
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  placeholder="C:\path\to\OneDrive_2026-03-27"
                  disabled={isScanning}
                  className="w-full pl-8 pr-3 py-2 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 disabled:opacity-50 disabled:bg-neutral-50 font-mono"
                />
              </div>
              <button
                onClick={handleStartScan}
                disabled={isScanning || !folderPath.trim()}
                className={clsx(
                  'btn-primary !px-4 shrink-0',
                  isScanning && 'opacity-50 cursor-not-allowed',
                )}
              >
                {isScanning ? (
                  <><ArrowPathIcon className="w-4 h-4 animate-spin" /> Scanning...</>
                ) : (
                  <><PlayIcon className="w-4 h-4" /> Start Scan</>
                )}
              </button>
            </div>
            <p className="text-[10px] text-neutral-400 mt-1">
              Enter the full path to the folder containing hotel report PDFs. The scanner will use Mistral OCR to read and categorize every file.
            </p>
          </div>

          {/* Progress section */}
          {progress && (
            <div>
              <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-2 block">
                {progress.status === 'scanning' ? 'Progress' : progress.status === 'done' ? 'Completed' : 'Error'}
              </label>

              {/* Progress bar */}
              <div className="h-3 rounded-full bg-neutral-100 overflow-hidden mb-2">
                <div
                  className={clsx(
                    'h-full rounded-full transition-all duration-500',
                    progress.status === 'done' ? 'bg-success-500' :
                    progress.status === 'error' ? 'bg-danger-500' :
                    'bg-brand-500',
                  )}
                  style={{ width: `${progress.status === 'done' ? 100 : pct}%` }}
                />
              </div>

              {/* Stats row */}
              <div className="flex items-center gap-4 text-xs">
                <span className="tabular-nums text-neutral-600 font-medium">
                  {progress.status === 'done' ? (
                    <span className="text-success-600">{progress.filesProcessed} files processed</span>
                  ) : (
                    <>{progress.filesProcessed} / {progress.totalFilesEstimate} files ({pct}%)</>
                  )}
                </span>

                {progress.currentDate && progress.status === 'scanning' && (
                  <span className="text-neutral-400">
                    Processing {progress.currentDate}
                  </span>
                )}

                <span className="flex items-center gap-1 text-neutral-400 ml-auto">
                  <ClockIcon className="w-3.5 h-3.5" />
                  {fmtDuration(progress.elapsedMs)}
                </span>

                {progress.status === 'scanning' && progress.filesProcessed > 0 && (
                  <span className="text-neutral-400 tabular-nums">
                    ~{fmtDuration(
                      ((progress.totalFilesEstimate - progress.filesProcessed) / (progress.filesProcessed / progress.elapsedMs))
                    )} remaining
                  </span>
                )}
              </div>

              {/* Error message */}
              {progress.status === 'error' && progress.errorMessage && (
                <div className="mt-3 p-3 bg-danger-50 rounded-md border border-danger-200">
                  <p className="text-xs text-danger-700 font-mono">{progress.errorMessage}</p>
                </div>
              )}

              {/* Manual run hint */}
              {progress.status === 'error' && (
                <div className="mt-2 p-3 bg-neutral-50 rounded-md">
                  <p className="text-[10px] font-semibold text-neutral-500 mb-1">Run manually in terminal:</p>
                  <code className="text-xs text-neutral-600 font-mono">
                    pnpm tsx scripts/scanWithOCR.ts "{folderPath}" --concurrency 10
                  </code>
                </div>
              )}
            </div>
          )}

          {/* Manual run instructions when no progress */}
          {!progress && !isScanning && (
            <div className="p-3 bg-neutral-50 rounded-md">
              <p className="text-[10px] font-semibold text-neutral-500 mb-1">Or run from terminal:</p>
              <code className="text-xs text-neutral-600 font-mono block">
                pnpm tsx scripts/scanWithOCR.ts "./path/to/folder" --concurrency 10
              </code>
              <p className="text-[10px] text-neutral-400 mt-1">
                The progress bar will automatically appear when a scan is running.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
