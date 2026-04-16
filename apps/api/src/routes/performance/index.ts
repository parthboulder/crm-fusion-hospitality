/**
 * Performance data routes — serves dashboard data using the service role key.
 * Replaces direct Supabase queries from the frontend (anon key).
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabaseAdmin } from '../../lib/supabase.js';

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
      .from('daily_hotel_performance')
      .select('*')
      .eq('report_date', query.data.date);

    if (error) {
      app.log.error({ error }, 'revenue_flash_query_failed');
      return reply.code(500).send({
        success: false,
        error: { code: 'DB_ERROR', message: error.message },
      });
    }

    return reply.send({ success: true, data: data ?? [] });
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
      .from('flash_report')
      .select('*')
      .eq('report_date', query.data.date);

    if (error) {
      app.log.error({ error }, 'flash_report_query_failed');
      return reply.code(500).send({
        success: false,
        error: { code: 'DB_ERROR', message: error.message },
      });
    }

    return reply.send({ success: true, data: data ?? [] });
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
}
