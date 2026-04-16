import XLSX from 'xlsx';

export interface SheetResult {
  sheetName: string;
  text: string;
  rows: number;
  columns: number;
}

export interface SpreadsheetResult {
  sheets: SheetResult[];
  totalText: string;
}

const SUPPORTED_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv', '.ods', '.tsv']);

export function isSupportedSpreadsheet(ext: string): boolean {
  return SUPPORTED_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * Extract all text content from a spreadsheet file (XLSX, CSV, ODS, XLS).
 * Returns structured text per sheet, plus a combined plain text version.
 * No OCR needed — reads the data directly.
 */
export function extractSpreadsheet(filePath: string): SpreadsheetResult {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheets: SheetResult[] = [];

  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;

    // Get as array-of-arrays for row/col counting
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    // Filter out fully empty rows
    const nonEmptyRows = rows.filter((row) => row.some((cell: any) => cell !== '' && cell != null));

    if (nonEmptyRows.length === 0) continue;

    // Build readable text: tab-separated values per row
    const lines = nonEmptyRows.map((row) =>
      row
        .map((cell: any) => formatCell(cell))
        .join('\t')
        .trimEnd()
    );

    const maxCols = Math.max(...nonEmptyRows.map((r) => r.length));

    sheets.push({
      sheetName: name,
      text: lines.join('\n'),
      rows: nonEmptyRows.length,
      columns: maxCols,
    });
  }

  // Combined text across all sheets
  const totalText = sheets
    .map((s) =>
      sheets.length > 1
        ? `=== Sheet: ${s.sheetName} ===\n${s.text}`
        : s.text
    )
    .join('\n\n');

  return { sheets, totalText };
}

function formatCell(cell: any): string {
  if (cell == null || cell === '') return '';
  if (cell instanceof Date) {
    return formatDate(cell);
  }
  if (typeof cell === 'number') {
    // Preserve dollar amounts and decimals
    if (Number.isInteger(cell)) return cell.toString();
    return cell.toFixed(2);
  }
  return String(cell).trim();
}

function formatDate(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const year = d.getFullYear();
  return `${month}/${day}/${year}`;
}
