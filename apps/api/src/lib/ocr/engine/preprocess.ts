import sharp from 'sharp';

export interface PreprocessOptions {
  targetWidth?: number;
  grayscale?: boolean;
  normalize?: boolean;
  threshold?: number;
  sharpen?: boolean;
  denoise?: boolean;
}

const DEFAULT_OPTIONS: Required<PreprocessOptions> = {
  targetWidth: 1500,
  grayscale: true,
  normalize: true,
  threshold: 160,
  sharpen: true,
  denoise: false,
};

/**
 * Full preprocessing pipeline for OCR optimization:
 * image → grayscale → normalize → denoise → sharpen → threshold → resize
 */
export async function preprocessImage(
  input: Buffer | Uint8Array,
  opts: PreprocessOptions = {}
): Promise<Buffer> {
  const options = { ...DEFAULT_OPTIONS, ...opts };

  let pipeline = sharp(Buffer.from(input));

  // Get metadata to determine if resize is needed
  const metadata = await pipeline.metadata();

  // Step 1: Convert to grayscale
  if (options.grayscale) {
    pipeline = pipeline.grayscale();
  }

  // Step 2: Normalize contrast (stretch histogram)
  if (options.normalize) {
    pipeline = pipeline.normalize();
  }

  // Step 3: Median filter for noise removal (salt & pepper noise)
  if (options.denoise) {
    pipeline = pipeline.median(3);
  }

  // Step 4: Sharpen edges for better character recognition
  if (options.sharpen) {
    pipeline = pipeline.sharpen({ sigma: 1.5, m1: 1.0, m2: 0.5 });
  }

  // Step 5: Apply threshold (binarize for cleaner OCR)
  if (options.threshold > 0) {
    pipeline = pipeline.threshold(options.threshold);
  }

  // Step 6: Resize to optimal width for Tesseract (1200-1800px)
  const currentWidth = metadata.width || 0;
  if (currentWidth > 0 && currentWidth !== options.targetWidth) {
    const scale = options.targetWidth / currentWidth;
    const newHeight = Math.round((metadata.height || 0) * scale);
    if (newHeight > 0) {
      pipeline = pipeline.resize(options.targetWidth, newHeight, {
        fit: 'fill',
        kernel: 'lanczos3',
      });
    }
  }

  // Output as PNG (lossless) for best OCR results
  return pipeline.png({ compressionLevel: 1 }).toBuffer();
}

/**
 * Lightweight preprocessing for already-clean images.
 * Skips denoise and threshold for speed.
 */
export async function preprocessImageLight(
  input: Buffer | Uint8Array
): Promise<Buffer> {
  return preprocessImage(input, {
    denoise: false,
    threshold: 0,
    sharpen: false,
  });
}

/**
 * Aggressive preprocessing for very noisy/low-quality scans.
 */
export async function preprocessImageAggressive(
  input: Buffer | Uint8Array
): Promise<Buffer> {
  return preprocessImage(input, {
    targetWidth: 1800,
    threshold: 128,
    denoise: true,
    sharpen: true,
  });
}
