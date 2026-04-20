/**
 * Performance data routes — serves dashboard data using the service role key.
 * Replaces direct Supabase queries from the frontend (anon key).
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabaseAdmin } from '../../lib/supabase.js';
import { ingestOcrResult } from '../../lib/report-parsers.js';

export async function performanceRoutes(app: FastifyInstance) {
  // ─── GET /latest-date — most recent date with data ─────────────────────────
  app.get('/latest-date', async (req, reply) => {
    const query = z
      .object({
        table: z.enum(['daily_hotel_performance', 'flash_report', 'engineering_ooo_rooms']),
      })
      .safeParse(req.query);

    if (!query.success) {
      return reply.code(400).send({
        success: false,
        error: { code: 'INVALID_QUERY', message: 'table parameter required.' },
      });
    }

    const supabase = supabaseAdmin();
    const { data, error } = await supabase
      .from(query.data.table)
      .select('report_date')
      .order('report_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      app.log.error({ error }, 'performance_latest_date_failed');
      return reply.code(500).send({
        success: false,
        error: { code: 'DB_ERROR', message: error.message },
      });
    }

    return reply.send({
      success: true,
      data: { date: data?.report_date ?? null },
    });
  });

  // ─── GET /revenue-flash — daily hotel performance for a date ───────────────
  app.get('/revenue-flash', async (req, reply) => {
    const query = z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        includeReview: z.coerce.boolean().default(false),
      })
      .safeParse(req.query);

    if (!query.success) {
      return reply.code(400).send({
        success: false,
        error: { code: 'INVALID_QUERY', message: 'date parameter required (YYYY-MM-DD).' },
      });
    }

    const supabase = supabaseAdmin();
    // Order by extracted_at DESC so that if two rows ever share (property_name,
    // report_date) the latest one wins when we dedupe below. Upserts should
    // keep this to one row, but a concurrent ingest race could briefly produce
    // duplicates and we'd rather be deterministic about it.
    const { data, error } = await supabase
      .from('daily_hotel_performance')
      .select('*')
      .eq('report_date', query.data.date)
      .order('extracted_at', { ascending: false });

    if (error) {
      app.log.error({ error }, 'revenue_flash_query_failed');
      return reply.code(500).send({
        success: false,
        error: { code: 'DB_ERROR', message: error.message },
      });
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const filtered = query.data.includeReview ? rows : rows.filter((r) => !r['needs_review']);
    // Dedupe: first occurrence wins (ordered by extracted_at DESC above).
    const seen = new Set<string>();
    const deduped = filtered.filter((r) => {
      const key = r['property_name'] as string;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return reply.send({ success: true, data: deduped });
  });

  // ─── GET /revenue-flash/sparklines — last 30 days for trend charts ─────────
  app.get('/revenue-flash/sparklines', async (req, reply) => {
    const query = z
      .object({ endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
      .safeParse(req.query);

    if (!query.success) {
      return reply.code(400).send({
        success: false,
        error: { code: 'INVALID_QUERY', message: 'endDate parameter required (YYYY-MM-DD).' },
      });
    }

    const endDate = query.data.endDate;
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 29);
    const startStr = startDate.toISOString().split('T')[0]!;

    const supabase = supabaseAdmin();
    const { data, error } = await supabase
      .from('daily_hotel_performance')
      .select('property_name, report_date, occupancy_day, revpar_day, revenue_day')
      .gte('report_date', startStr)
      .lte('report_date', endDate)
      .order('report_date', { ascending: true });

    if (error) {
      app.log.error({ error }, 'sparklines_query_failed');
      return reply.code(500).send({
        success: false,
        error: { code: 'DB_ERROR', message: error.message },
      });
    }

    return reply.send({ success: true, data: data ?? [] });
  });

  // ─── GET /flash-report — flash report data for a date ──────────────────────
  app.get('/flash-report', async (req, reply) => {
    const query = z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        includeReview: z.coerce.boolean().default(false),
      })
      .safeParse(req.query);

    if (!query.success) {
      return reply.code(400).send({
        success: false,
        error: { code: 'INVALID_QUERY', message: 'date parameter required (YYYY-MM-DD).' },
      });
    }

    const supabase = supabaseAdmin();
    const { data, error } = await supabase
      .from('flash_report')
      .select('*')
      .eq('report_date', query.data.date)
      .order('extracted_at', { ascending: false });

    if (error) {
      app.log.error({ error }, 'flash_report_query_failed');
      return reply.code(500).send({
        success: false,
        error: { code: 'DB_ERROR', message: error.message },
      });
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const filtered = query.data.includeReview ? rows : rows.filter((r) => !r['needs_review']);
    const seen = new Set<string>();
    const deduped = filtered.filter((r) => {
      const key = r['property_name'] as string;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return reply.send({ success: true, data: deduped });
  });

  // ─── GET /engineering — engineering OOO rooms for a date ───────────────────
  app.get('/engineering', async (req, reply) => {
    const query = z
      .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
      .safeParse(req.query);

    if (!query.success) {
      return reply.code(400).send({
        success: false,
        error: { code: 'INVALID_QUERY', message: 'date parameter required (YYYY-MM-DD).' },
      });
    }

    const supabase = supabaseAdmin();
    const { data, error } = await supabase
      .from('engineering_ooo_rooms')
      .select('*')
      .eq('report_date', query.data.date);

    if (error) {
      app.log.error({ error }, 'engineering_query_failed');
      return reply.code(500).send({
        success: false,
        error: { code: 'DB_ERROR', message: error.message },
      });
    }

    return reply.send({ success: true, data: data ?? [] });
  });

  // ─── POST /reingest-from-ocr — rebuild performance tables from ocr_jobs ────
  // After Stage 0 truncation, run this once to repopulate the flash tables
  // from every completed ocr_jobs row that has extracted_data.fullText. Safe
  // to run again — every row is upserted on (property_name, report_date) and
  // stamped with source_ocr_job_id, so re-running produces the same result.
  //
  // Filters: default walks every Revenue Flash / Flash Report / Engineering
  // Flash job. Pass {since:'YYYY-MM-DD'} to scope to recent uploads only.
  app.post('/reingest-from-ocr', async (req, reply) => {
    const parsed = z
      .object({ since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { code: 'INVALID_BODY', message: 'Invalid request body.' },
      });
    }
    const { since } = parsed.data;

    const supabase = supabaseAdmin();
    const PAGE = 100;
    let offset = 0;
    let processed = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Lightweight adapter — ingestOcrResult's log type is (...args: unknown[]).
    // Pino takes (obj, msg); we narrow at the call site.
    const log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void } = {
      info: (...args: unknown[]) => { app.log.info(args[0] as object, args[1] as string | undefined); },
      warn: (...args: unknown[]) => { app.log.warn(args[0] as object, args[1] as string | undefined); },
      error: (...args: unknown[]) => { app.log.error(args[0] as object, args[1] as string | undefined); },
    };

    while (true) {
      let q = supabase
        .from('ocr_jobs')
        .select('id, original_name, extracted_data, report_category')
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (since) q = q.gte('created_at', since);

      const { data, error } = await q;
      if (error) {
        errors.push(`page ${offset}: ${error.message}`);
        break;
      }
      if (!data || data.length === 0) break;

      for (const row of data as Array<Record<string, unknown>>) {
        const fullText = ((row.extracted_data as { fullText?: string } | null)?.fullText) ?? '';
        const originalName = row.original_name as string;
        if (!fullText) { skipped++; continue; }
        // Only reingest performance-report PDFs. The detector inside
        // ingestOcrResult will early-return for everything else.
        try {
          await ingestOcrResult(row.id as string, originalName, fullText, log);
          processed++;
        } catch (e) {
          errors.push(`${originalName}: ${(e as Error).message}`);
          skipped++;
        }
      }

      if (data.length < PAGE) break;
      offset += PAGE;
    }

    return reply.send({
      success: errors.length === 0,
      data: { processed, skipped, errors },
    });
  });
}
