/**
 * AI service — Claude-powered extraction, summaries, and root cause analysis.
 * All prompts are versioned and logged.
 */

import Anthropic from '@anthropic-ai/sdk';
import { db } from '@fusion/db';
import { env } from '../config/env.js';
import type { ExtractionResult } from '../types/index.js';

const EXTRACTION_PROMPT_VERSION = 'v2.0.0';

export class AiService {
  private readonly client: Anthropic;
  private readonly model = 'claude-sonnet-4-6';

  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' });
  }

  // ─── Report Extraction ─────────────────────────────────────────────────────

  async extractReportData(
    rawText: string,
    mimeType: string,
    reportId: string,
  ): Promise<ExtractionResult> {
    const prompt = buildExtractionPrompt(rawText, mimeType);

    const startedAt = new Date();
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
      system: EXTRACTION_SYSTEM_PROMPT,
    });

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;
    const costUsd = (response.usage.input_tokens * 0.000003) + (response.usage.output_tokens * 0.000015);

    const rawText2 = response.content[0]?.type === 'text' ? response.content[0].text : '';
    let parsed: ExtractionResult;

    try {
      // Claude is instructed to return JSON — extract it from markdown code block if present.
      const jsonMatch = rawText2.match(/```json\s*([\s\S]*?)\s*```/) ?? rawText2.match(/(\{[\s\S]*\})/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1]! : rawText2) as ExtractionResult;
    } catch {
      parsed = {
        reportType: 'unknown',
        reportDate: new Date().toISOString().split('T')[0]!,
        propertyName: 'Unknown',
        confidenceScore: 0.1,
        requiresReview: true,
        extractionNotes: 'Failed to parse AI response as JSON.',
        metrics: {},
        financials: {},
        operationalFlags: [],
      };
    }

    // Log extraction job.
    await db.extractionJob.create({
      data: {
        reportId,
        modelUsed: this.model,
        promptVersion: EXTRACTION_PROMPT_VERSION,
        tokensUsed,
        costUsd: String(costUsd.toFixed(6)),
        durationMs,
        status: 'completed',
        rawResponse: response as unknown as object,
        startedAt,
        completedAt,
      },
    }).catch(() => null);

    return parsed;
  }

  // ─── Property Summary ──────────────────────────────────────────────────────

  async generatePropertySummary(
    propertyId: string,
    orgId: string,
    period: string,
  ): Promise<{ content: string; model: string; tokensUsed: number }> {
    const today = new Date();
    const from = new Date(today);
    if (period === 'weekly') from.setDate(today.getDate() - 7);
    else if (period === 'monthly') from.setDate(today.getDate() - 30);
    else from.setDate(today.getDate() - 1);

    const [property, metrics, alerts, tasks] = await Promise.all([
      db.property.findUnique({ where: { id: propertyId } }),
      db.dailyMetrics.findMany({
        where: { propertyId, metricDate: { gte: from, lte: today } },
        orderBy: { metricDate: 'desc' },
        take: 30,
      }),
      db.alert.findMany({
        where: { propertyId, status: 'open' },
        orderBy: { severity: 'asc' },
        take: 10,
      }),
      db.task.findMany({
        where: { propertyId, status: { in: ['open', 'in_progress'] } },
        take: 10,
      }),
    ]);

    const prompt = `You are a hospitality analytics expert. Generate a concise, actionable property performance summary.

Property: ${property?.name} (${property?.brand ?? 'Independent'})
Period: ${period} (${from.toDateString()} – ${today.toDateString()})

METRICS (most recent first):
${JSON.stringify(metrics.slice(0, 7), null, 2)}

OPEN ALERTS (${alerts.length} total):
${JSON.stringify(alerts.map((a) => ({ type: a.alertType, severity: a.severity, title: a.title })), null, 2)}

OPEN TASKS: ${tasks.length}

Write a 3-5 sentence executive summary covering:
1. Current performance vs prior year
2. Key concerns or wins
3. Recommended immediate actions

Be specific with numbers. Do not use generic filler language.`;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

    return { content, model: this.model, tokensUsed };
  }

  // ─── Portfolio Insights ────────────────────────────────────────────────────

  async generatePortfolioInsights(
    orgId: string,
    propertyIds: string[],
  ): Promise<{ content: string; model: string; tokensUsed: number }> {
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);

    const propertyFilter =
      propertyIds.length > 0
        ? { propertyId: { in: propertyIds } }
        : { property: { orgId } };

    const [aggregates, topAlerts, openTasks] = await Promise.all([
      db.dailyMetrics.aggregate({
        where: { ...propertyFilter, metricDate: { gte: thirtyDaysAgo } },
        _avg: { occupancyPct: true, adr: true, revpar: true },
        _sum: { totalRevenue: true },
        _count: { id: true },
      }),
      db.alert.findMany({
        where: {
          status: 'open',
          severity: { in: ['critical', 'high'] },
          property: { orgId },
          ...(propertyIds.length > 0 && { propertyId: { in: propertyIds } }),
        },
        include: { property: { select: { name: true } } },
        take: 5,
        orderBy: { createdAt: 'desc' },
      }),
      db.task.count({
        where: {
          status: { in: ['open', 'in_progress'] },
          property: { orgId },
        },
      }),
    ]);

    const prompt = `You are a hospitality portfolio analyst. Analyze this 30-day portfolio snapshot and produce 3-5 bullet-point insights with specific recommended actions.

30-DAY AGGREGATES:
- Properties reporting: ${aggregates._count.id}
- Avg Occupancy: ${aggregates._avg.occupancyPct ? Number(aggregates._avg.occupancyPct).toFixed(1) : 'N/A'}%
- Avg ADR: $${aggregates._avg.adr ? Number(aggregates._avg.adr).toFixed(2) : 'N/A'}
- Avg RevPAR: $${aggregates._avg.revpar ? Number(aggregates._avg.revpar).toFixed(2) : 'N/A'}
- Total Revenue: $${aggregates._sum.totalRevenue ? Number(aggregates._sum.totalRevenue).toLocaleString() : 'N/A'}

CRITICAL/HIGH ALERTS (${topAlerts.length}):
${topAlerts.map((a) => `- [${a.severity.toUpperCase()}] ${a.property.name}: ${a.title}`).join('\n')}

OPEN TASKS: ${openTasks}

Format your response as JSON: { "insights": [{ "title": string, "detail": string, "action": string, "priority": "high"|"medium"|"low" }] }`;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

    return { content, model: this.model, tokensUsed };
  }

  // ─── Root Cause Analysis ───────────────────────────────────────────────────

  async generateRootCauseAnalysis(report: {
    reportType: string;
    reportDate: Date;
    property: { name: string; brand: string | null };
    dailyMetrics: unknown[];
    financialMetrics: unknown[];
    alerts: unknown[];
  }): Promise<string> {
    const prompt = `You are a hospitality operations expert. Analyze this report and identify the root causes of any performance issues.

Property: ${report.property.name} (${report.property.brand ?? 'Independent'})
Report: ${report.reportType} for ${report.reportDate.toDateString()}

DAILY METRICS: ${JSON.stringify(report.dailyMetrics, null, 2)}
FINANCIAL METRICS: ${JSON.stringify(report.financialMetrics, null, 2)}
ALERTS GENERATED: ${JSON.stringify(report.alerts, null, 2)}

Provide a root cause analysis in this JSON format:
{
  "summary": "2-3 sentence overview",
  "rootCauses": [{ "issue": string, "likelyCause": string, "evidence": string, "recommendation": string }],
  "urgentActions": [string]
}`;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content[0]?.type === 'text' ? response.content[0].text : '';
  }
}

// ─── Prompts ───────────────────────────────────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `You are an expert hotel operations data analyst. Your job is to extract structured data from hotel management reports — PDFs and Excel sheets — even when formats are inconsistent across brands (Hilton, Marriott, IHG, Best Western, independent hotels).

RULES:
1. Always respond with valid JSON only — no prose, no markdown outside the JSON block.
2. Set confidence_score between 0 and 1. Below 0.75 = set requires_review to true.
3. Extract numbers as raw numbers (not formatted strings). Remove $ and commas.
4. If a value is clearly absent, use null — do not guess.
5. For report_type, choose the closest match from: ar_aging, credit_card_transactions, daily_report, downtime_report, financial_payment_revenue, guest_ledger, manager_flash, occupancy_forecast, operator_adjustments_voids, cash_out, out_of_order, reservation_report, revenue_summary, trial_balance.
6. Dates must be ISO 8601: YYYY-MM-DD.
7. Flag any anomalies (excessive voids, large cash variance, high OOO rooms) in operational_flags.`;

function buildExtractionPrompt(rawText: string, mimeType: string): string {
  return `Extract structured data from this hotel report.

File type: ${mimeType}

REPORT CONTENT (first 4000 characters):
${rawText.slice(0, 4000)}

Return ONLY a JSON object matching this exact schema:
{
  "report_type": string,
  "report_date": "YYYY-MM-DD",
  "property_name": string,
  "confidence_score": number (0-1),
  "requires_review": boolean,
  "extraction_notes": string,
  "metrics": {
    "total_rooms": number | null,
    "rooms_sold": number | null,
    "rooms_ooo": number | null,
    "rooms_complimentary": number | null,
    "occupancy_pct": number | null,
    "adr": number | null,
    "revpar": number | null,
    "total_revenue": number | null,
    "room_revenue": number | null,
    "fb_revenue": number | null,
    "other_revenue": number | null,
    "py_total_revenue": number | null,
    "py_room_revenue": number | null,
    "py_occupancy_pct": number | null,
    "py_adr": number | null,
    "py_revpar": number | null,
    "budget_occupancy_pct": number | null,
    "budget_adr": number | null,
    "budget_revpar": number | null,
    "budget_total_revenue": number | null,
    "forecast_occupancy_pct": number | null,
    "forecast_revenue": number | null
  },
  "financials": {
    "ar_current": number | null,
    "ar_30_days": number | null,
    "ar_60_days": number | null,
    "ar_90_days": number | null,
    "ar_90_plus_days": number | null,
    "ar_total": number | null,
    "cc_visa": number | null,
    "cc_mastercard": number | null,
    "cc_amex": number | null,
    "cc_discover": number | null,
    "cc_other": number | null,
    "cc_total": number | null,
    "cc_disputes": number | null,
    "cash_sales": number | null,
    "cash_deposits": number | null,
    "cash_variance": number | null,
    "adjustments_total": number | null,
    "voids_total": number | null,
    "comps_total": number | null,
    "discounts_total": number | null,
    "tax_collected": number | null,
    "tax_exempt_total": number | null,
    "guest_ledger_balance": number | null,
    "advance_deposits": number | null
  },
  "operational_flags": [
    { "type": string, "description": string, "severity": "critical"|"high"|"medium"|"low" }
  ]
}`;
}
