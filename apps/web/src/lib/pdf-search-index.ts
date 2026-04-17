/**
 * Number-search across OCR'd PDFs, served by the API from the DB (no JSON file).
 * Used by the Revenue Flash dashboard to let users click a number and see
 * which source PDFs contain that value.
 */

import { api } from './api-client';

export interface PdfMatch {
  jobId: string;
  fileName: string;
  /** Same as `fileName` — kept for modal backward-compat. */
  filePath: string;
  /** Signed Supabase storage URL — expires per env.SIGNED_URL_EXPIRY_SECONDS. */
  url: string;
  reportType: string;
  property: string | null;
  dateFolder: string;
  /** Snippet of text around the match */
  snippet: string;
}

interface SearchResponse {
  success: boolean;
  data: Array<{
    jobId: string;
    fileName: string;
    property: string | null;
    reportType: string | null;
    dateFolder: string | null;
    snippet: string;
    url: string;
  }>;
}

/**
 * Search for a number/value across all completed OCR jobs. If `date` is
 * given, results are scoped to jobs whose `date_folder` matches it. Returns
 * jobs that contain the number along with a signed preview URL.
 */
export async function searchPdfs(query: string, date: string): Promise<PdfMatch[]> {
  if (!query || query.length < 2) return [];

  const mapRow = (r: SearchResponse['data'][number]): PdfMatch => ({
    jobId: r.jobId,
    fileName: r.fileName,
    filePath: r.fileName,
    url: r.url,
    reportType: r.reportType ?? 'Unknown',
    property: r.property,
    dateFolder: r.dateFolder ?? '',
    snippet: r.snippet,
  });

  // Only preview PDFs — xlsx/csv won't render inline and just download.
  const isPdf = (r: SearchResponse['data'][number]) => /\.pdf$/i.test(r.fileName);

  try {
    // First try a date-scoped search — the most precise result for when the
    // user is looking at a specific report date's numbers.
    if (date) {
      const scopedParams = new URLSearchParams({ q: query, date });
      const scoped = await api.get<SearchResponse>(
        `/ocr/jobs/search-number?${scopedParams.toString()}`,
      );
      const pdfs = (scoped?.data ?? []).filter(isPdf);
      if (pdfs.length > 0) return pdfs.map(mapRow);
    }

    // Fallback: search across all dates. The dashboard's selected date often
    // doesn't match the OCR'd PDFs' date_folder (e.g. today's dashboard vs
    // last week's uploaded files), so returning cross-date matches beats an
    // empty result.
    const wide = await api.get<SearchResponse>(
      `/ocr/jobs/search-number?${new URLSearchParams({ q: query }).toString()}`,
    );
    const pdfs = (wide?.data ?? []).filter(isPdf);
    return pdfs.map(mapRow);
  } catch (err) {
    console.error('pdf search failed', err);
    return [];
  }
}

/**
 * For the modal: the match already carries a signed URL, so this just
 * returns it. Kept as a function so callers don't need to special-case
 * which field to use.
 */
export function pdfFileUrl(match: PdfMatch | string): string {
  if (typeof match === 'string') return match;
  return match.url;
}
