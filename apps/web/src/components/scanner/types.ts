/**
 * Shared types for the file scanner dashboard.
 * Matches the output of scripts/scanWithOCR.ts (Mistral OCR content-first scanner).
 */

export interface ExtractedKPIs {
  occupancyPct?: number;
  adr?: number;
  revpar?: number;
  roomsSold?: number;
  totalRevenue?: number;
  roomRevenue?: number;
  oooRooms?: number;
  arTotal?: number;
  ar90Plus?: number;
}

export interface ScannedFile {
  filePath: string;
  relativePath: string;
  fileName: string;
  displayName: string;
  extension: string;
  fileSizeBytes: number;
  reportType: string | null;
  reportTypeCategory: string;
  adrNumber: string | null;
  confidence: number;
  error: string | null;
  /** Number of PDF pages processed by OCR */
  ocrPageCount?: number;
  /** First 500 chars of OCR-extracted markdown */
  contentPreview?: string;
  /** Table headers found inside the document */
  tableHeaders?: string[];
  /** Data patterns detected (occupancy, adr, aging_buckets, etc.) */
  dataPatterns?: string[];
  /** Extracted KPIs from the document content */
  kpis?: ExtractedKPIs;
}

export interface PropertyFolder {
  folderName: string;
  folderPath: string;
  propertyCode: string | null;
  propertyName: string | null;
  propertyConfidence: number;
  reportDate: string;
  files: ScannedFile[];
  fileCount: number;
  reportTypeCounts: Record<string, number>;
}

export interface DateFolder {
  rawName: string;
  normalizedDate: string;
  propertyFolders: PropertyFolder[];
  standaloneFiles: ScannedFile[];
  totalFiles: number;
  totalProperties: number;
}

export interface FlatResult extends ScannedFile {
  dateFolder: string;
  propertyFolder: string;
  property: string | null;
}

export interface ScanSummary {
  scanRoot: string;
  scannedAt: string;
  executionTimeMs: number;
  totalFiles: number;
  totalPdfs: number;
  totalParsed: number;
  totalErrors: number;
  totalWithAdr: number;
  dateFolders: DateFolder[];
  categoryCounts: Record<string, number>;
  reportTypeCounts: Record<string, number>;
  propertyCounts: Record<string, number>;
  allDates: string[];
  allProperties: string[];
  results: FlatResult[];
}
