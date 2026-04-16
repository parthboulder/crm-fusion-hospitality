import { readFile } from 'fs/promises';
import { createRequire } from 'module';
import path from 'path';

/**
 * Native PDF text extraction using pdfjs-dist.
 * Extracts embedded digital text WITHOUT OCR — instant and 100% accurate.
 * Returns null if the PDF is image-only (needs OCR fallback).
 */

// Lazy-load pdfjs-dist (ESM module)
let pdfjsLib: any = null;
let pdfjsStandardFontDataUrl: string = '';
async function getPdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

    // Resolve the standard_fonts and cmaps paths from the pdfjs-dist package
    const require = createRequire(import.meta.url);
    const pdfjsPath = path.dirname(require.resolve('pdfjs-dist/package.json')).replace(/\\/g, '/');
    pdfjsStandardFontDataUrl = pdfjsPath + '/standard_fonts/';

    // Only show errors, not warnings (pdfjs warns on recoverable JPEG/JBIG2 issues in scanned PDFs)
    pdfjsLib.VerbosityLevel && pdfjsLib.setVerbosityLevel?.(pdfjsLib.VerbosityLevel.ERRORS);
  }
  return pdfjsLib;
}

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export interface PdfTextResult {
  pages: ExtractedPage[];
  isTextBased: boolean;
}

const MIN_TEXT_ITEMS = 10; // threshold to consider a page as "text-based"

/**
 * Try extracting text natively from a PDF.
 * Returns { isTextBased: true, pages } if text is found.
 * Returns { isTextBased: false, pages: [] } if the PDF is scanned/image-only.
 */
export async function extractPdfText(filePath: string): Promise<PdfTextResult> {
  const pdfjs = await getPdfjs();
  const buf = new Uint8Array(await readFile(filePath));

  const doc = await pdfjs.getDocument({
    data: buf,
    useSystemFonts: true,
    standardFontDataUrl: pdfjsStandardFontDataUrl,
    cMapUrl: pdfjsStandardFontDataUrl.replace('standard_fonts', 'cmaps'),
    cMapPacked: true,
    verbosity: 0, // ERRORS only
  }).promise;

  const pages: ExtractedPage[] = [];
  let totalTextItems = 0;
  let successPages = 0;

  for (let i = 1; i <= doc.numPages; i++) {
    try {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();

      totalTextItems += textContent.items.length;
      successPages++;

      const text = reconstructPageText(textContent.items);
      pages.push({ pageNumber: i, text });
    } catch {
      // Page extraction failed — push empty placeholder
      pages.push({ pageNumber: i, text: '' });
    }
  }

  // Determine if this PDF has real embedded text
  const avgItemsPerPage = successPages > 0 ? totalTextItems / successPages : 0;
  const isTextBased = avgItemsPerPage >= MIN_TEXT_ITEMS && successPages > 0;

  return { pages, isTextBased };
}

/**
 * Quick check — only inspect first page to decide text vs image.
 * Much faster than extracting all pages.
 */
export async function isPdfTextBased(filePath: string): Promise<boolean> {
  const pdfjs = await getPdfjs();
  const buf = new Uint8Array(await readFile(filePath));

  const doc = await pdfjs.getDocument({
    data: buf,
    standardFontDataUrl: pdfjsStandardFontDataUrl,
    verbosity: 0,
  }).promise;
  const page = await doc.getPage(1);
  const textContent = await page.getTextContent();

  return textContent.items.length >= MIN_TEXT_ITEMS;
}

/**
 * Reconstruct readable text from pdfjs text content items.
 * Handles spacing, line breaks, and column layout.
 */
function reconstructPageText(items: any[]): string {
  if (items.length === 0) return '';

  // Sort items by Y position (top to bottom), then X (left to right)
  const sorted = [...items].filter(item => item.str !== undefined).sort((a, b) => {
    const yDiff = b.transform[5] - a.transform[5]; // Y is inverted in PDF
    if (Math.abs(yDiff) > 3) return yDiff; // different line
    return a.transform[4] - b.transform[4]; // same line, sort by X
  });

  const lines: string[] = [];
  let currentLine: string[] = [];
  let lastY = sorted[0]?.transform?.[5] ?? 0;

  for (const item of sorted) {
    const y = item.transform[5];
    const text = item.str;

    if (text === '' || text === undefined) continue;

    // New line if Y position changed significantly
    if (Math.abs(y - lastY) > 3) {
      if (currentLine.length > 0) {
        lines.push(currentLine.join(' ').trim());
      }
      currentLine = [];
      lastY = y;
    }

    currentLine.push(text);
  }

  // Don't forget the last line
  if (currentLine.length > 0) {
    lines.push(currentLine.join(' ').trim());
  }

  return lines.filter(l => l.length > 0).join('\n');
}
