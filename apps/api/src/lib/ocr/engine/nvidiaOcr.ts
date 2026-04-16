/**
 * NVIDIA NIM Image OCR client.
 * Uses the nemo-retriever OCR v1 model via NVCF cloud API.
 * Sends images as base64, returns structured text with bounding boxes.
 */

const NVCF_BASE = 'https://api.nvcf.nvidia.com/v2/nvcf/pexec/functions';
const OCR_FUNCTION_ID = '95298231-10d9-4ec9-801b-ab0d439c73a2'; // ai-nemoretriever-ocr-v1

export interface NvidiaOcrDetection {
  text: string;
  confidence: number;
  boundingBox: { x: number; y: number }[];
}

export interface NvidiaOcrResult {
  text: string;
  confidence: number;
  detections: NvidiaOcrDetection[];
}

export interface NvidiaOcrOptions {
  apiKey: string;
  mergeLevel?: 'word' | 'sentence' | 'paragraph';
  maxRetries?: number;
}

/**
 * OCR a single image buffer using NVIDIA NIM cloud API.
 * Sends the image inline as base64 — no asset upload needed for reasonable sizes.
 */
export async function nvidiaOcrRecognize(
  imageBuffer: Buffer | Uint8Array,
  options: NvidiaOcrOptions
): Promise<NvidiaOcrResult> {
  const {
    apiKey,
    mergeLevel = 'paragraph',
    maxRetries = 2,
  } = options;

  const base64 = Buffer.from(imageBuffer).toString('base64');
  const dataUrl = `data:image/png;base64,${base64}`;

  const endpoint = `${NVCF_BASE}/${OCR_FUNCTION_ID}`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          input: [{ type: 'image_url', url: dataUrl }],
          merge_levels: [mergeLevel],
        }),
      });

      if (res.status === 429) {
        // Rate limited — wait and retry
        const waitMs = Math.min(2000 * (attempt + 1), 10000);
        console.log(`[NVIDIA OCR] Rate limited, waiting ${waitMs}ms...`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`NVIDIA OCR HTTP ${res.status}: ${errBody.slice(0, 200)}`);
      }

      const data = await res.json() as any;

      const detections: NvidiaOcrDetection[] = (
        data.data?.[0]?.text_detections || []
      ).map((d: any) => ({
        text: d.text_prediction.text,
        confidence: d.text_prediction.confidence,
        boundingBox: d.bounding_box.points,
      }));

      // Build full text sorted by position (top-to-bottom, left-to-right)
      const sorted = [...detections].sort((a, b) => {
        const ay = a.boundingBox[0]?.y ?? 0;
        const by = b.boundingBox[0]?.y ?? 0;
        if (Math.abs(ay - by) > 0.008) return ay - by;
        return (a.boundingBox[0]?.x ?? 0) - (b.boundingBox[0]?.x ?? 0);
      });

      const fullText = sorted.map((d) => d.text).join('\n');
      const avgConfidence =
        detections.length > 0
          ? detections.reduce((s, d) => s + d.confidence, 0) / detections.length
          : 0;

      return {
        text: fullText,
        confidence: avgConfidence * 100,
        detections,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new Error('NVIDIA OCR failed after retries');
}

/**
 * Batch OCR — processes multiple images sequentially with the NVIDIA API.
 * (NVIDIA NIM processes one image per request.)
 */
export async function nvidiaOcrBatch(
  imageBuffers: (Buffer | Uint8Array)[],
  options: NvidiaOcrOptions
): Promise<NvidiaOcrResult[]> {
  const results: NvidiaOcrResult[] = [];

  for (const buf of imageBuffers) {
    const result = await nvidiaOcrRecognize(buf, options);
    results.push(result);
  }

  return results;
}
