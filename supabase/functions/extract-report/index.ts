/**
 * Edge Function: extract-report
 *
 * Step 2 of the processing pipeline.
 * Triggered by: ingest-file function after text extraction.
 *
 * Responsibilities:
 *  1. Call Claude to extract structured metrics from raw text
 *  2. Persist DailyMetrics + FinancialMetrics records
 *  3. Upsert into daily_hotel_performance (Stoneriver dashboard)
 *  4. Update report type, date, confidence score
 *  5. Invoke generate-alerts function
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getAdminClient } from '../_shared/supabase-client.ts';
import { callClaude, parseJsonFromResponse } from '../_shared/claude-client.ts';

const EXTRACTION_SYSTEM_PROMPT = `You are an expert hotel operations data analyst. Extract structured data from hotel management reports.

RULES:
1. Always respond with valid JSON only.
2. Set confidence_score between 0 and 1. Below 0.75 = requires_review: true.
3. Extract numbers as raw numbers (no $ or commas).
4. If a value is absent, use null — never guess or calculate unless instructed.
5. For report_type use only: ar_aging, credit_card_transactions, daily_report, downtime_report, financial_payment_revenue, guest_ledger, manager_flash, occupancy_forecast, operator_adjustments_voids, cash_out, out_of_order, reservation_report, revenue_summary, trial_balance.
6. Dates: ISO 8601 YYYY-MM-DD.
7. Percentages as raw percent values (e.g., 85.5 for 85.5%, NOT 0.855).
8. For daily_performance: extract Day / MTD / YTD breakdowns wherever the report provides them. If only Day data is available, set MTD/YTD to null.
9. For RevPAR: if not directly stated, calculate as occupancy_pct * adr / 100.
10. report_format identifies the PMS/brand format: "Hilton Hotel Statistics", "Hilton Hotel Statistics Extended", "IHG Manager Flash", "Marriott Manager Statistics", "Marriott Revenue Report", "Best Western Daily", "Hyatt Manager Flash", "Choice Hotels Statistics", or "Unknown".`;

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { reportId, rawText, mimeType } = await req.json() as {
    reportId: string;
    rawText: string;
    mimeType: string;
  };

  if (!reportId || !rawText) {
    return new Response(JSON.stringify({ error: 'reportId and rawText required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = getAdminClient();
  const startedAt = new Date().toISOString();

  // Fetch report + property context.
  const { data: report, error: reportErr } = await supabase
    .from('reports')
    .select('id, property_id, org_id, properties(name, brand)')
    .eq('id', reportId)
    .single();

  if (reportErr || !report) {
    return new Response(JSON.stringify({ error: 'Report not found' }), { status: 404 });
  }

  const propertyName: string = (report.properties as { name: string } | null)?.name ?? 'Unknown';

  const prompt = buildExtractionPrompt(rawText, mimeType, propertyName);
  let extraction: ExtractionResult;
  let tokensUsed = 0;
  let extractionStatus = 'completed';
  let errorMessage: string | null = null;

  try {
    const raw = await callClaude([{ role: 'user', content: prompt }], {
      system: EXTRACTION_SYSTEM_PROMPT,
      maxTokens: 4096,
    });

    extraction = parseJsonFromResponse(raw) as ExtractionResult;
    tokensUsed = Math.ceil(prompt.length / 4) + Math.ceil(raw.length / 4);
  } catch (err) {
    console.error('claude_extraction_error', err);
    errorMessage = String(err);
    extractionStatus = 'failed';

    extraction = {
      report_type: 'unknown',
      report_date: new Date().toISOString().split('T')[0]!,
      property_name: propertyName,
      report_format: 'Unknown',
      confidence_score: 0.1,
      requires_review: true,
      extraction_notes: `Extraction failed: ${errorMessage}`,
      metrics: {},
      financials: {},
      daily_performance: {},
      operational_flags: [],
    };
  }

  // Log extraction job.
  await supabase.from('extraction_jobs').insert({
    report_id: reportId,
    model_used: 'claude-sonnet-4-6',
    prompt_version: 'v2.1.0',
    tokens_used: tokensUsed,
    status: extractionStatus,
    error_message: errorMessage,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
  });

  // Update report with extracted metadata.
  const reportDate = isValidDate(extraction.report_date)
    ? extraction.report_date
    : new Date().toISOString().split('T')[0]!;

  await supabase.from('reports').update({
    report_type: extraction.report_type ?? 'unknown',
    report_date: reportDate,
    confidence_score: extraction.confidence_score,
    requires_review: extraction.requires_review,
    status: extraction.requires_review ? 'review_required' : 'extracted',
  }).eq('id', reportId);

  const m = extraction.metrics;
  const f = extraction.financials;
  const dp = extraction.daily_performance ?? {};

  // Upsert daily metrics (general store).
  if (hasAnyValue(m)) {
    await supabase.from('daily_metrics').upsert({
      report_id: reportId,
      property_id: report.property_id,
      metric_date: reportDate,
      total_rooms: m.total_rooms ?? null,
      rooms_sold: m.rooms_sold ?? null,
      rooms_ooo: m.rooms_ooo ?? null,
      rooms_complimentary: m.rooms_complimentary ?? null,
      occupancy_pct: m.occupancy_pct ?? null,
      adr: m.adr ?? null,
      revpar: m.revpar ?? null,
      total_revenue: m.total_revenue ?? null,
      room_revenue: m.room_revenue ?? null,
      fb_revenue: m.fb_revenue ?? null,
      other_revenue: m.other_revenue ?? null,
      py_total_revenue: m.py_total_revenue ?? null,
      py_room_revenue: m.py_room_revenue ?? null,
      py_occupancy_pct: m.py_occupancy_pct ?? null,
      py_adr: m.py_adr ?? null,
      py_revpar: m.py_revpar ?? null,
      budget_occupancy_pct: m.budget_occupancy_pct ?? null,
      budget_adr: m.budget_adr ?? null,
      budget_revpar: m.budget_revpar ?? null,
      budget_total_revenue: m.budget_total_revenue ?? null,
      forecast_occupancy_pct: m.forecast_occupancy_pct ?? null,
      forecast_revenue: m.forecast_revenue ?? null,
      confidence_score: extraction.confidence_score,
      extraction_notes: extraction.extraction_notes,
    }, { onConflict: 'property_id,metric_date' });
  }

  // Upsert financial metrics.
  if (hasAnyValue(f)) {
    await supabase.from('financial_metrics').upsert({
      report_id: reportId,
      property_id: report.property_id,
      metric_date: reportDate,
      ar_current: f.ar_current ?? null,
      ar_30_days: f.ar_30_days ?? null,
      ar_60_days: f.ar_60_days ?? null,
      ar_90_days: f.ar_90_days ?? null,
      ar_90_plus_days: f.ar_90_plus_days ?? null,
      ar_total: f.ar_total ?? null,
      cc_visa: f.cc_visa ?? null,
      cc_mastercard: f.cc_mastercard ?? null,
      cc_amex: f.cc_amex ?? null,
      cc_discover: f.cc_discover ?? null,
      cc_other: f.cc_other ?? null,
      cc_total: f.cc_total ?? null,
      cc_disputes: f.cc_disputes ?? null,
      cash_sales: f.cash_sales ?? null,
      cash_deposits: f.cash_deposits ?? null,
      cash_variance: f.cash_variance ?? null,
      adjustments_total: f.adjustments_total ?? null,
      voids_total: f.voids_total ?? null,
      comps_total: f.comps_total ?? null,
      discounts_total: f.discounts_total ?? null,
      tax_collected: f.tax_collected ?? null,
      tax_exempt_total: f.tax_exempt_total ?? null,
      guest_ledger_balance: f.guest_ledger_balance ?? null,
      advance_deposits: f.advance_deposits ?? null,
      confidence_score: extraction.confidence_score,
      extraction_notes: extraction.extraction_notes,
    }, { onConflict: 'property_id,metric_date' });
  }

  // Upsert into daily_hotel_performance (Stoneriver dashboard).
  // Only write if this looks like a daily performance report.
  const isDailyPerfReport = ['daily_report', 'manager_flash', 'revenue_summary'].includes(
    extraction.report_type,
  );

  if (isDailyPerfReport && propertyName !== 'Unknown') {
    // Resolve RevPAR for day if not provided (Occ% × ADR / 100).
    const occDay = dp.occupancy_day ?? m.occupancy_pct ?? null;
    const adrDay = dp.adr_day ?? m.adr ?? null;
    const revparDay =
      dp.revpar_day ??
      m.revpar ??
      (occDay != null && adrDay != null ? (occDay * adrDay) / 100 : null);

    await supabase.from('daily_hotel_performance').upsert({
      property_name: propertyName,
      property_group: extraction.report_format ?? 'Unknown',
      report_date: reportDate,

      occupancy_day: occDay,
      occupancy_mtd: dp.occupancy_mtd ?? null,
      occupancy_ytd: dp.occupancy_ytd ?? null,

      adr_day: adrDay,
      adr_mtd: dp.adr_mtd ?? null,
      adr_ytd: dp.adr_ytd ?? null,

      revpar_day: revparDay,
      revpar_mtd: dp.revpar_mtd ?? null,
      revpar_ytd: dp.revpar_ytd ?? null,

      total_rooms_sold: dp.total_rooms_sold ?? m.rooms_sold ?? null,
      total_rooms_available: dp.total_rooms_available ?? m.total_rooms ?? null,
      ooo_rooms: dp.ooo_rooms ?? m.rooms_ooo ?? null,

      revenue_day: dp.revenue_day ?? m.room_revenue ?? null,
      revenue_mtd: dp.revenue_mtd ?? null,
      revenue_ytd: dp.revenue_ytd ?? null,

      py_revenue_day: dp.py_revenue_day ?? m.py_room_revenue ?? null,
      py_revenue_mtd: dp.py_revenue_mtd ?? null,
      py_revenue_ytd: dp.py_revenue_ytd ?? null,

      report_format: extraction.report_format ?? 'Unknown',
      extracted_at: new Date().toISOString(),
    }, { onConflict: 'property_name,report_date' });
  }

  // Invoke alert generation.
  await supabase.functions.invoke('generate-alerts', {
    body: {
      reportId,
      propertyId: report.property_id,
      orgId: report.org_id,
      metrics: m,
      financials: f,
    },
  });

  return new Response(
    JSON.stringify({ success: true, reportId, requiresReview: extraction.requires_review }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface DailyPerformance {
  occupancy_day?: number | null;
  occupancy_mtd?: number | null;
  occupancy_ytd?: number | null;
  adr_day?: number | null;
  adr_mtd?: number | null;
  adr_ytd?: number | null;
  revpar_day?: number | null;
  revpar_mtd?: number | null;
  revpar_ytd?: number | null;
  total_rooms_sold?: number | null;
  total_rooms_available?: number | null;
  ooo_rooms?: number | null;
  revenue_day?: number | null;
  revenue_mtd?: number | null;
  revenue_ytd?: number | null;
  py_revenue_day?: number | null;
  py_revenue_mtd?: number | null;
  py_revenue_ytd?: number | null;
}

interface ExtractionResult {
  report_type: string;
  report_date: string;
  property_name: string;
  report_format: string;
  confidence_score: number;
  requires_review: boolean;
  extraction_notes: string;
  metrics: Record<string, number | null>;
  financials: Record<string, number | null>;
  daily_performance: DailyPerformance;
  operational_flags: Array<{ type: string; description: string; severity: string }>;
}

function isValidDate(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(Date.parse(dateStr));
}

function hasAnyValue(obj: Record<string, number | null>): boolean {
  return Object.values(obj).some((v) => v !== null && v !== undefined);
}

function buildExtractionPrompt(rawText: string, mimeType: string, propertyName: string): string {
  return `Extract structured data from this hotel management report for property: "${propertyName}".

File type: ${mimeType}

REPORT CONTENT:
${rawText.slice(0, 5000)}

Return ONLY a JSON object with this exact structure:
{
  "report_type": string,
  "report_date": "YYYY-MM-DD",
  "property_name": string,
  "report_format": string,
  "confidence_score": number,
  "requires_review": boolean,
  "extraction_notes": string,
  "daily_performance": {
    "occupancy_day": number|null,
    "occupancy_mtd": number|null,
    "occupancy_ytd": number|null,
    "adr_day": number|null,
    "adr_mtd": number|null,
    "adr_ytd": number|null,
    "revpar_day": number|null,
    "revpar_mtd": number|null,
    "revpar_ytd": number|null,
    "total_rooms_sold": number|null,
    "total_rooms_available": number|null,
    "ooo_rooms": number|null,
    "revenue_day": number|null,
    "revenue_mtd": number|null,
    "revenue_ytd": number|null,
    "py_revenue_day": number|null,
    "py_revenue_mtd": number|null,
    "py_revenue_ytd": number|null
  },
  "metrics": {
    "total_rooms": number|null, "rooms_sold": number|null, "rooms_ooo": number|null,
    "rooms_complimentary": number|null, "occupancy_pct": number|null, "adr": number|null,
    "revpar": number|null, "total_revenue": number|null, "room_revenue": number|null,
    "fb_revenue": number|null, "other_revenue": number|null,
    "py_total_revenue": number|null, "py_room_revenue": number|null,
    "py_occupancy_pct": number|null, "py_adr": number|null, "py_revpar": number|null,
    "budget_occupancy_pct": number|null, "budget_adr": number|null,
    "budget_revpar": number|null, "budget_total_revenue": number|null,
    "forecast_occupancy_pct": number|null, "forecast_revenue": number|null
  },
  "financials": {
    "ar_current": number|null, "ar_30_days": number|null, "ar_60_days": number|null,
    "ar_90_days": number|null, "ar_90_plus_days": number|null, "ar_total": number|null,
    "cc_visa": number|null, "cc_mastercard": number|null, "cc_amex": number|null,
    "cc_discover": number|null, "cc_other": number|null, "cc_total": number|null,
    "cc_disputes": number|null, "cash_sales": number|null, "cash_deposits": number|null,
    "cash_variance": number|null, "adjustments_total": number|null, "voids_total": number|null,
    "comps_total": number|null, "discounts_total": number|null,
    "tax_collected": number|null, "tax_exempt_total": number|null,
    "guest_ledger_balance": number|null, "advance_deposits": number|null
  },
  "operational_flags": [{"type": string, "description": string, "severity": "critical"|"high"|"medium"|"low"}]
}`;
}
