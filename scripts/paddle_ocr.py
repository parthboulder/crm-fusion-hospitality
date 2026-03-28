"""
PaddleOCR FastAPI Server.

Exposes a local OCR API that extracts text from PDF headers.
The TypeScript scanner calls this API instead of Mistral.

Endpoints:
    POST /ocr           — OCR a single PDF (send file path in JSON body)
    POST /ocr/batch     — OCR multiple PDFs
    GET  /health        — Health check

Usage:
    .venv/Scripts/python.exe scripts/paddle_ocr.py
    # Server starts on http://localhost:8010
"""

import os
import sys
import json
import logging

os.environ["FLAGS_use_mkldnn"] = "0"

import fitz  # PyMuPDF
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# Suppress noisy logs
logging.getLogger("ppocr").setLevel(logging.ERROR)

# ─── Lazy OCR init ────────────────────────────────────────────────────────────

_ocr = None

def get_ocr():
    global _ocr
    if _ocr is None:
        print("  Loading PaddleOCR model (first time takes ~10s)...")
        from paddleocr import PaddleOCR
        _ocr = PaddleOCR(
            use_angle_cls=True,
            lang="en",
            use_gpu=False,
            enable_mkldnn=False,
            show_log=False,
        )
        print("  PaddleOCR model loaded.")
    return _ocr


# ─── Core OCR function ───────────────────────────────────────────────────────

def extract_header(pdf_path: str) -> dict:
    """Extract text from the top ~35% of the first page."""
    try:
        if not os.path.exists(pdf_path):
            return {"text": "", "pageCount": 0, "error": f"File not found: {pdf_path}"}

        doc = fitz.open(pdf_path)
        if len(doc) == 0:
            doc.close()
            return {"text": "", "pageCount": 0, "error": None}

        page = doc[0]
        rect = page.rect
        # Crop to top 35%
        clip = fitz.Rect(rect.x0, rect.y0, rect.x1, rect.y0 + rect.height * 0.35)
        pix = page.get_pixmap(dpi=150, clip=clip)

        img_path = pdf_path + ".header.png"
        pix.save(img_path)
        page_count = len(doc)
        doc.close()

        try:
            ocr = get_ocr()
            result = ocr.ocr(img_path, cls=True)
            lines = []
            if result and result[0]:
                for line in result[0]:
                    lines.append(line[1][0])

            return {
                "text": "\n".join(lines),
                "pageCount": page_count,
                "error": None,
            }
        except Exception as ocr_err:
            return {
                "text": "",
                "pageCount": page_count,
                "error": f"OCR error: {ocr_err}",
            }
        finally:
            try:
                os.remove(img_path)
            except OSError:
                pass

    except Exception as e:
        return {"text": "", "pageCount": 0, "error": str(e)}


# ─── FastAPI app ──────────────────────────────────────────────────────────────

app = FastAPI(title="PaddleOCR Server", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class OCRRequest(BaseModel):
    filePath: str


class OCRBatchRequest(BaseModel):
    filePaths: list[str]


class OCRResponse(BaseModel):
    text: str
    pageCount: int
    error: str | None


@app.get("/health")
def health():
    return {"status": "ok", "engine": "PaddleOCR 2.9.1"}


@app.post("/ocr", response_model=OCRResponse)
def ocr_single(req: OCRRequest):
    import gc
    result = extract_header(req.filePath)
    gc.collect()  # Free memory after each OCR
    return result


@app.post("/ocr/batch")
def ocr_batch(req: OCRBatchRequest):
    results = []
    for i, path in enumerate(req.filePaths):
        r = extract_header(path)
        r["filePath"] = path
        results.append(r)
    return results


# ─── CLI entry ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # If called with a file path, run single OCR (for testing)
    if len(sys.argv) > 1 and sys.argv[1] != "--serve":
        result = extract_header(sys.argv[1])
        print(json.dumps(result, indent=2))
        sys.exit(0)

    # Start FastAPI server
    print("\n  PaddleOCR Server")
    print("  " + "-" * 40)
    print("  Endpoints:")
    print("    POST /ocr         — single PDF")
    print("    POST /ocr/batch   — batch PDFs")
    print("    GET  /health      — health check")
    print("  " + "-" * 40)

    # Pre-load the model
    get_ocr()

    print("\n  Starting server on http://localhost:8010\n")
    uvicorn.run(app, host="0.0.0.0", port=8010, log_level="warning")
