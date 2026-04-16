/**
 * Edge Function: ingest-file
 *
 * Step 1 of the processing pipeline.
 * Triggered by: Supabase DB Webhook on reports INSERT, or direct API call from upload route.
 *
 * Responsibilities:
 *  1. Download the file from private storage
 *  2. Extract raw text (PDF → pdf-parse equivalent via fetch, Excel → CSV conversion)
 *  3. Update report status to "processing"
 *  4. Invoke extract-report function with raw text
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getAdminClient, verifyServiceAuth } from '../_shared/supabase-client.ts';

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  if (!verifyServiceAuth(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { reportId, fileId } = await req.json() as { reportId: string; fileId: string };

  if (!reportId || !fileId) {
    return new Response(JSON.stringify({ error: 'reportId and fileId required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = getAdminClient();

  // Mark as processing.
  await supabase
    .from('reports')
    .update({ status: 'processing' })
    .eq('id', reportId);

  // Fetch file metadata.
  const { data: fileRecord, error: fileErr } = await supabase
    .from('report_files')
    .select('storage_path, mime_type, original_name')
    .eq('id', fileId)
    .single();

  if (fileErr || !fileRecord) {
    console.error('file_fetch_error', fileErr);
    await supabase.from('reports').update({ status: 'failed' }).eq('id', reportId);
    return new Response(JSON.stringify({ error: 'File record not found' }), { status: 404 });
  }

  // Download file from private storage.
  const { data: fileData, error: downloadErr } = await supabase.storage
    .from('reports-private')
    .download(fileRecord.storage_path);

  if (downloadErr || !fileData) {
    console.error('storage_download_error', downloadErr);
    await supabase.from('reports').update({ status: 'failed' }).eq('id', reportId);
    return new Response(JSON.stringify({ error: 'File download failed' }), { status: 500 });
  }

  // Extract text based on file type.
  let rawText = '';
  const mimeType: string = fileRecord.mime_type;

  try {
    if (mimeType === 'application/pdf') {
      rawText = await extractPdfText(fileData);
    } else if (
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimeType === 'application/vnd.ms-excel'
    ) {
      rawText = await extractExcelText(fileData);
    } else if (mimeType === 'text/csv') {
      rawText = await fileData.text();
    } else {
      rawText = await fileData.text();
    }
  } catch (err) {
    console.error('text_extraction_error', err);
    rawText = `[Extraction failed: ${String(err)}]`;
  }

  // Store raw text on the report for traceability.
  await supabase
    .from('reports')
    .update({ status: 'processing' })
    .eq('id', reportId);

  // Hand off to extract-report function.
  const { error: invokeErr } = await supabase.functions.invoke('extract-report', {
    body: { reportId, rawText, mimeType },
  });

  if (invokeErr) {
    console.error('extract_invoke_error', invokeErr);
    await supabase.from('reports').update({ status: 'failed' }).eq('id', reportId);
    return new Response(JSON.stringify({ error: 'Extract function failed' }), { status: 500 });
  }

  return new Response(JSON.stringify({ success: true, reportId }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

// ─── Text Extraction Helpers ──────────────────────────────────────────────────

async function extractPdfText(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const raw = decoder.decode(bytes);

  const textBlocks: string[] = [];

  // Strategy 1: Extract text between BT...ET blocks (PDF text operators).
  // Works for uncompressed text streams.
  const btEtPattern = /BT([\s\S]*?)ET/g;
  let match;
  while ((match = btEtPattern.exec(raw)) !== null) {
    const block = match[1] ?? '';
    const stringPattern = /\(([^)]+)\)/g;
    let strMatch;
    while ((strMatch = stringPattern.exec(block)) !== null) {
      const extracted = (strMatch[1] ?? '').trim();
      if (extracted.length > 1) textBlocks.push(extracted);
    }
  }

  // Strategy 2: Extract text from FlateDecode streams that were stored uncompressed,
  // and readable strings between common PDF delimiters.
  if (textBlocks.length < 10) {
    // Extract any long runs of printable ASCII (catches text in many PDF variants).
    const printableRuns = raw.match(/[\x20-\x7E]{4,}/g) ?? [];
    for (const run of printableRuns) {
      // Filter out PDF operators and binary-looking strings.
      if (!/^[A-Z]{1,2}\s/.test(run) && !/^[0-9\s.]+$/.test(run) && run.length > 5) {
        textBlocks.push(run);
      }
    }
  }

  if (textBlocks.length === 0) {
    return '[PDF text extraction returned no content — this PDF may use compressed streams or scanned images. Route through the API OCR pipeline for proper extraction.]';
  }

  return textBlocks.join(' ').slice(0, 16000);
}

async function extractExcelText(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  // xlsx files are ZIP archives. The shared strings and sheet data
  // may be compressed. We try multiple extraction strategies.
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const raw = decoder.decode(bytes);
  const values: string[] = [];

  // Strategy 1: Extract from sharedStrings.xml <t> tags and sheet <v> tags.
  const xmlTextPattern = /<t[^>]*>([^<]+)<\/t>/g;
  let match;
  while ((match = xmlTextPattern.exec(raw)) !== null) {
    const val = (match[1] ?? '').trim();
    if (val.length > 0 && val.length < 500) values.push(val);
  }

  // Strategy 2: Extract cell values from <v> tags.
  const cellValuePattern = /<v>([^<]+)<\/v>/g;
  while ((match = cellValuePattern.exec(raw)) !== null) {
    const val = (match[1] ?? '').trim();
    if (val.length > 0 && val.length < 200) values.push(val);
  }

  // Strategy 3: If nothing found (compressed xlsx), extract printable strings.
  if (values.length < 5) {
    const printableRuns = raw.match(/[\x20-\x7E]{6,}/g) ?? [];
    for (const run of printableRuns) {
      if (run.length > 3 && run.length < 500 && !/^PK/.test(run)) {
        values.push(run);
      }
    }
  }

  if (values.length === 0) {
    return '[Excel text extraction returned no content — this file may use heavy compression. Route through the API OCR pipeline for proper extraction.]';
  }

  return [...new Set(values)].join('\t').slice(0, 16000);
}
