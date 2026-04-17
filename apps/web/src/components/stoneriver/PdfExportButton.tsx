/**
 * PDF export for the Revenue Flash table.
 * Captures the full table (all periods) as a landscape PDF.
 */

import { useState } from 'react';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { exportTableToPdf } from '../../lib/pdf-table-export';

interface PdfExportButtonProps {
  date: string;
}

export function PdfExportButton({ date }: PdfExportButtonProps) {
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const tableEl = document.getElementById('revenue-flash-table');
      if (!tableEl) return;

      await exportTableToPdf({
        element: tableEl,
        title: 'Fusion Hospitality Group — Revenue Flash',
        subtitle: `Report Date: ${date}`,
        filename: `revenue-flash-${date}`,
        orientation: 'landscape',
      });
    } catch (err) {
      console.error('PDF export failed:', err);
    } finally {
      setExporting(false);
    }
  }

  return (
    <button
      onClick={handleExport}
      disabled={exporting}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#1f2937] hover:bg-[#374151] disabled:opacity-50 transition-colors rounded"
    >
      <ArrowDownTrayIcon className="w-3.5 h-3.5" />
      {exporting ? 'Exporting...' : 'Export PDF'}
    </button>
  );
}
