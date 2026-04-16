/**
 * Post-processing module for cleaning OCR output.
 * Fixes common Tesseract misrecognitions and normalizes text.
 */

// Common OCR character substitution errors
const CHAR_CORRECTIONS: [RegExp, string][] = [
  // Letter O misread as zero in numeric contexts
  [/(\d)O/g, '$10'],
  [/O(\d)/g, '0$1'],
  // Letter l/I misread as 1 in numeric contexts
  [/(\d)[lI]/g, '$11'],
  [/[lI](\d)/g, '1$1'],
  // Letter S misread as 5 in numeric contexts
  [/(\d)S(\d)/g, '$15$2'],
  // Letter B misread as 8 in numeric contexts
  [/(\d)B(\d)/g, '$18$2'],
  // Common word-level fixes for hotel/financial reports
  [/\bRoorn\b/g, 'Room'],
  [/\bTotaI\b/g, 'Total'],
  [/\bRoorns\b/g, 'Rooms'],
  [/\bArnount\b/g, 'Amount'],
  [/\bNurnber\b/g, 'Number'],
  [/\bBaIance\b/g, 'Balance'],
  [/\bCreclit\b/g, 'Credit'],
  [/\bDeblt\b/g, 'Debit'],
  [/\bPayrnent\b/g, 'Payment'],
  [/\bRecelpt\b/g, 'Receipt'],
  [/\bTransactlon\b/g, 'Transaction'],
  [/\brn\b/g, 'm'], // common: rn → m
];

// Fix broken dollar amounts: $ 1 2 3 . 4 5 → $123.45
const MONEY_PATTERN = /\$\s*(\d[\d\s]*\.\s*\d{2})/g;

// Fix broken dates: 0 3 / 1 7 / 2 0 2 6 → 03/17/2026
const DATE_PATTERN =
  /(\d)\s+(\d)\s*[\/\-\.]\s*(\d)\s+(\d)\s*[\/\-\.]\s*(\d)\s*(\d)\s*(\d)\s*(\d)/g;

/**
 * Clean and normalize raw OCR text output.
 */
export function postprocessText(rawText: string): string {
  let text = rawText;

  // Step 1: Normalize line endings
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Step 2: Remove noise characters (isolated special chars that aren't punctuation)
  text = text.replace(/(?<=\s)[|}{~`^](?=\s)/g, '');
  text = text.replace(/[^\S\n]+/g, ' '); // collapse multiple spaces to one

  // Step 3: Fix broken words (word split across spaces)
  // Only rejoin if both parts are short and lowercase
  text = text.replace(/\b([a-z]{1,2})\s([a-z]{2,})\b/g, (match, p1, p2) => {
    const joined = p1 + p2;
    // Only rejoin if it looks like a real word (heuristic: common lengths)
    if (joined.length >= 3 && joined.length <= 15) {
      return joined;
    }
    return match;
  });

  // Step 4: Apply character-level corrections
  for (const [pattern, replacement] of CHAR_CORRECTIONS) {
    text = text.replace(pattern, replacement);
  }

  // Step 5: Fix money formatting
  text = text.replace(MONEY_PATTERN, (match) => {
    return match.replace(/\s/g, '');
  });

  // Step 6: Fix date formatting
  text = text.replace(DATE_PATTERN, '$1$2/$3$4/$5$6$7$8');

  // Step 7: Normalize whitespace
  text = text.replace(/\n{3,}/g, '\n\n'); // max 2 consecutive newlines
  text = text.replace(/[ \t]+$/gm, ''); // trailing whitespace per line
  text = text.replace(/^[ \t]+/gm, (match) => match); // preserve leading indent
  text = text.trim();

  return text;
}

/**
 * Extract email addresses from OCR text.
 */
export function extractEmails(text: string): string[] {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  return [...new Set(text.match(emailRegex) || [])];
}

/**
 * Extract dollar amounts from OCR text.
 */
export function extractAmounts(text: string): string[] {
  const amountRegex = /\$[\d,]+\.?\d{0,2}/g;
  return text.match(amountRegex) || [];
}

/**
 * Filter text by confidence score.
 * Returns null if confidence is below the threshold.
 */
export function filterByConfidence(
  text: string,
  confidence: number,
  threshold: number = 40
): string | null {
  if (confidence < threshold) {
    return null;
  }
  return text;
}
