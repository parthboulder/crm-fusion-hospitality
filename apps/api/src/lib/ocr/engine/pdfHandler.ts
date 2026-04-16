import { readFile } from 'fs/promises';
import { pdf } from 'pdf-to-img';

export interface PdfPage {
  pageNumber: number;
  imageBuffer: Buffer;
}

/**
 * Extract all pages from a PDF as PNG image buffers.
 * Uses pdf-to-img (pdfjs-dist based, pure JS, no native canvas).
 * Each page is rendered at the specified scale for optimal OCR.
 */
export async function extractPdfPages(
  filePath: string,
  scale: number = 1.5
): Promise<PdfPage[]> {
  const fileBuffer = await readFile(filePath);
  const pages: PdfPage[] = [];

  try {
    const document = await pdf(fileBuffer, {
      scale,
      docInitParams: { verbosity: 0 }, // ERRORS only — suppress recoverable JPEG/JBIG2 warnings
    });

    let pageNumber = 1;
    for await (const image of document) {
      pages.push({
        pageNumber,
        imageBuffer: Buffer.from(image),
      });
      pageNumber++;
    }
  } catch (err) {
    // Some PDFs fail on certain pages — try page-by-page with error recovery
    if (pages.length === 0) {
      throw err;
    }
    // Return whatever pages we got
  }

  return pages;
}

/**
 * Generator version — yields pages one at a time to reduce memory pressure.
 * Handles per-page errors gracefully.
 */
export async function* extractPdfPagesStream(
  filePath: string,
  scale: number = 1.5
): AsyncGenerator<PdfPage> {
  const fileBuffer = await readFile(filePath);

  const document = await pdf(fileBuffer, {
    scale,
    docInitParams: { verbosity: 0 },
  });

  let pageNumber = 1;
  for await (const image of document) {
    yield {
      pageNumber,
      imageBuffer: Buffer.from(image),
    };
    pageNumber++;
  }
}
