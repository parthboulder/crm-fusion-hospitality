# OCR V1 - Hybrid Document Processing System

High-performance document extraction system built with TypeScript. Processes bulk PDFs, scanned documents, spreadsheets, and images using a smart 4-tier strategy that picks the fastest and most accurate method per file.

## How It Works

```
File arrives
  ├─ XLSX/CSV/ODS  →  Direct spreadsheet read       (instant, 100% accuracy)
  ├─ Text PDF      →  Native pdfjs extraction        (instant, 100% accuracy)
  ├─ Scanned PDF   →  NVIDIA NIM OCR                 (2-7s/page, ~96% accuracy)
  └─ No API key?   →  Tesseract.js fallback          (slower, ~70% accuracy)
```

The system auto-detects whether a PDF has embedded digital text or is a scanned image. ~83% of typical business PDFs are text-based and get processed instantly without OCR.

## Performance

Tested on 2,000+ hotel audit documents (PDFs, XLSX):

| Method | Speed | Accuracy | When Used |
|--------|-------|----------|-----------|
| Native PDF text | ~1-2s/file | 100% | PDFs with embedded text |
| Spreadsheet read | ~20-250ms/file | 100% | XLSX, CSV, ODS |
| NVIDIA NIM OCR | ~2-7s/page | 83-96% | Scanned/image PDFs |
| Tesseract.js | ~10-15s/page | 60-82% | Fallback (no API key) |

## Quick Start

```bash
# Install dependencies
npm install

# Run with NVIDIA OCR (recommended for scanned PDFs)
npx tsx index.ts "./input-folder" "./output" --nvidia-key=nvapi-YOUR_KEY

# Run without API key (uses Tesseract.js for scanned PDFs)
npx tsx index.ts "./input-folder" "./output"
```

## CLI Options

```
npx tsx index.ts <input-folder> [output-folder] [options]

Options:
  --nvidia-key=KEY   NVIDIA NIM API key for high-accuracy OCR
  --workers=N        Tesseract workers (default: CPU cores, max 6)
  --concurrency=N    Files processed in parallel (default: 4)
  --scale=N          PDF render scale for OCR (default: 1.5)
  --batch=N          Batch size for queue (default: 20)

Environment:
  NVIDIA_API_KEY     Alternative to --nvidia-key flag
```

## Output Format

For each processed file, the system generates:

**JSON** (structured):
```json
{
  "fileName": "Report.pdf",
  "method": "native",
  "pages": [
    { "pageNumber": 1, "text": "...", "confidence": 100 }
  ],
  "totalConfidence": 100,
  "processingTimeMs": 1200
}
```

**TXT** (plain text):
```
--- Page 1 ---
Full extracted text content...

--- Page 2 ---
More content...
```

**Summary** (`_summary.json`):
```json
{
  "totalFiles": 100,
  "successful": 98,
  "failed": 2,
  "nativeTextExtraction": 80,
  "spreadsheetExtraction": 10,
  "nvidiaOcr": 8,
  "tesseractOcr": 0,
  "totalPages": 450,
  "averageConfidence": 97.5
}
```

## Project Structure

```
├── index.ts                  # CLI entry point
├── lib/ocr/
│   ├── processor.ts          # Main orchestrator (hybrid pipeline)
│   ├── pdfTextExtractor.ts   # Native PDF text extraction (pdfjs-dist)
│   ├── pdfHandler.ts         # PDF-to-image rendering for OCR
│   ├── spreadsheetHandler.ts # XLSX/CSV/ODS direct reader
│   ├── nvidiaOcr.ts          # NVIDIA NIM OCR cloud client
│   ├── workerPool.ts         # Tesseract.js worker pool + scheduler
│   ├── preprocess.ts         # Sharp image preprocessing pipeline
│   ├── postprocess.ts        # OCR text cleanup + corrections
│   └── queue.ts              # Job queue with concurrency + retry
├── package.json
└── tsconfig.json
```

## Supported File Types

| Type | Extensions | Method |
|------|-----------|--------|
| PDF (text-based) | `.pdf` | Native extraction |
| PDF (scanned) | `.pdf` | NVIDIA OCR / Tesseract |
| Spreadsheet | `.xlsx`, `.xls`, `.csv`, `.ods`, `.tsv` | Direct read |
| Image | `.jpg`, `.jpeg`, `.png`, `.tiff`, `.bmp`, `.webp` | NVIDIA OCR / Tesseract |

## Tech Stack

- **TypeScript** + Node.js (ESM)
- **pdfjs-dist** - Native PDF text extraction
- **pdf-to-img** - PDF page rendering for OCR
- **NVIDIA NIM** - Cloud OCR (nemo-retriever-ocr-v1)
- **Tesseract.js** - Local OCR fallback (LSTM engine)
- **Sharp** - Image preprocessing (grayscale, normalize, threshold, sharpen)
- **xlsx** - Spreadsheet parsing

## Image Preprocessing Pipeline (for OCR)

```
Input → Grayscale → Normalize Contrast → Sharpen → Threshold → Resize (1500px) → OCR
```

Optimized for scanned business documents with tabular data.
