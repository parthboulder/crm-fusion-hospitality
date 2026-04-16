/**
 * Metrics routes — daily KPIs, trends, financials, overrides.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabaseAdmin } from '../../lib/supabase.js';
import { PERMISSIONS } from '../../config/constants.js';

// Allowlisted columns that may be overridden via the /override endpoint.
const OVERRIDABLE_DAILY_FIELDS = [
  'total_rooms', 'rooms_sold', 'rooms_ooo', 'rooms_complimentary',
  'occupancy_pct', 'adr', 'revpar',
  'total_revenue', 'room_revenue', 'fb_revenue', 'other_revenue',
  'py_total_revenue', 'py_room_revenue', 'py_occupancy_pct', 'py_adr', 'py_revpar',
  'budget_occupancy_pct', 'budget_adr', 'budget_revpar', 'budget_total_revenue',
  'forecast_occupancy_pct', 'forecast_revenue',
] as const;

const OVERRIDABLE_FINANCIAL_FIELDS = [
  'ar_current', 'ar_30_days', 'ar_60_days', 'ar_90_days', 'ar_90_plus_days', 'ar_total',
  'cc_visa', 'cc_mastercard', 'cc_amex', 'cc_discover', 'cc_other', 'cc_total', 'cc_disputes',
  'cash_sales', 'cash_deposits', 'cash_variance',
  'adjustments_total', 'voids_total', 'comps_total', 'discounts_total',
  'tax_collected', 'tax_exempt_total', 'guest_ledger_balance', 'advance_deposits',
] as const;

const ALLOWED_OVERRIDE_FIELDS = new Set<string>([
  ...OVERRIDABLE_DAILY_FIELDS,
  ...OVERRIDABLE_FINANCIAL_FIELDS,
]);

export async function metricsRoutes(app: FastifyInstance) {
  const auth = [app.verifyAuth];

  // ─── GET /daily — date-range metrics for one or all properties ────────────
  app.get('/daily', { preHandler: auth }, async (req, reply) => {
    const query = z
      .object({
        propertyId: z.string().uuid().optional(),
        from: z.string(),
        to: z.string(),
      })
      .parse(req.query);

    const { authUser } = req;
    const supabase = supabaseAdmin();

    let q = supabase
      .from('daily_metrics')
      .select(`
        *,
        property:properties!property_id ( name, brand )
      `)
      .gte('metric_date', new Date(query.from).toISOString())
      .lte('metric_date', new Date(query.to).toISOString());

    // Scope to the org by joining through property.
    // Since daily_metrics has property_id, we filter via a sub-condition.
    if (query.propertyId) {
      q = q.eq('property_id', query.propertyId);
    }
    if (authUser.propertyIds.length > 0) {
      q = q.in('property_id', authUser.propertyIds);
    }

    // Filter by org through the joined property.
    q = q.eq('property.org_id', authUser.orgId);

    q = q
      .order('property_id', { ascending: true })
      .order('metric_date', { ascending: true });

    const { data: metrics, error } = await q;

    if (error) throw error;

    return reply.send({ success: true, data: metrics });
  });

  // ─── GET /financials — financial metrics ──────────────────────────────────
  app.get(
    '/financials',
    {
      preHandler: [...auth, app.requirePermission(PERMISSIONS.FINANCIALS_READ)],
    },
    async (req, reply) => {
      const query = z
        .object({
          propertyId: z.string().uuid().optional(),
          from: z.string(),
          to: z.string(),
        })
        .parse(req.query);

      const { authUser } = req;
      const supabase = supabaseAdmin();

      let q = supabase
        .from('financial_metrics')
        .select(`
          *,
          property:properties!property_id ( name )
        `)
        .gte('metric_date', new Date(query.from).toISOString())
        .lte('metric_date', new Date(query.to).toISOString());

      if (query.propertyId) {
        q = q.eq('property_id', query.propertyId);
      }
      if (authUser.propertyIds.length > 0) {
        q = q.in('property_id', authUser.propertyIds);
      }

      q = q.eq('property.org_id', authUser.orgId);

      q = q
        .order('property_id', { ascending: true })
        .order('metric_date', { ascending: true });

      const { data: metrics, error } = await q;

      if (error) throw error;

      return reply.send({ success: true, data: metrics });
    },
  );

  // ─── GET /trends — YoY / MoM comparisons ─────────────────────────────────
  app.get('/trends', { preHandler: auth }, async (req, reply) => {
    const query = z
      .object({
        propertyId: z.string().uuid().optional(),
        period: z.enum(['7d', '30d', '90d', 'mtd', 'ytd']).default('30d'),
      })
      .parse(req.query);

    const { authUser } = req;
    const today = new Date();
    let fromDate: Date;

    switch (query.period) {
      case '7d':
        fromDate = new Date(today);
        fromDate.setDate(today.getDate() - 7);
        break;
      case '30d':
        fromDate = new Date(today);
        fromDate.setDate(today.getDate() - 30);
        break;
      case '90d':
        fromDate = new Date(today);
        fromDate.setDate(today.getDate() - 90);
        break;
      case 'mtd':
        fromDate = new Date(today.getFullYear(), today.getMonth(), 1);
        break;
      case 'ytd':
        fromDate = new Date(today.getFullYear(), 0, 1);
        break;
    }

    const supabase = supabaseAdmin();

    let q = supabase
      .from('daily_metrics')
      .select('metric_date, property_id, occupancy_pct, adr, revpar, total_revenue, room_revenue, rooms_sold, py_total_revenue, py_revpar, py_occupancy_pct')
      .gte('metric_date', fromDate.toISOString())
      .lte('metric_date', today.toISOString());

    if (query.propertyId) {
      q = q.eq('property_id', query.propertyId);
    }
    if (authUser.propertyIds.length > 0) {
      q = q.in('property_id', authUser.propertyIds);
    }

    q = q.order('metric_date', { ascending: true });

    const { data: current, error } = await q;

    if (error) throw error;

    // Supabase JS client doesn't support aggregate functions directly.
    // Compute aggregates in-app from the fetched data.
    const aggregates = {
      _avg: {
        occupancy_pct: current.length > 0
          ? current.reduce((sum, r) => sum + (r.occupancy_pct ?? 0), 0) / current.length
          : null,
        adr: current.length > 0
          ? current.reduce((sum, r) => sum + (r.adr ?? 0), 0) / current.length
          : null,
        revpar: current.length > 0
          ? current.reduce((sum, r) => sum + (r.revpar ?? 0), 0) / current.length
          : null,
      },
      _sum: {
        total_revenue: current.reduce((sum, r) => sum + (r.total_revenue ?? 0), 0),
        room_revenue: current.reduce((sum, r) => sum + (r.room_revenue ?? 0), 0),
        rooms_sold: current.reduce((sum, r) => sum + (r.rooms_sold ?? 0), 0),
      },
    };

    return reply.send({ success: true, data: { current, aggregates } });
  });

  // ─── POST /override — propose a metric correction ─────────────────────────
  app.post(
    '/override',
    {
      preHandler: [...auth, app.requirePermission(PERMISSIONS.METRICS_OVERRIDE)],
    },
    async (req, reply) => {
      const body = z
        .object({
          tableName: z.enum(['daily_metrics', 'financial_metrics']),
          recordId: z.string().uuid(),
          fieldName: z.string().min(1),
          newValue: z.string(),
          overrideReason: z.string().min(10),
        })
        .parse(req.body);

      // Validate fieldName against allowlist to prevent arbitrary column updates.
      if (!ALLOWED_OVERRIDE_FIELDS.has(body.fieldName)) {
        return reply.code(400).send({
          success: false,
          error: {
            code: 'INVALID_FIELD',
            message: `Field '${body.fieldName}' is not overridable.`,
          },
        });
      }

      const supabase = supabaseAdmin();

      // Fetch old value for audit trail.
      let oldValue: string | undefined;
      if (body.tableName === 'daily_metrics') {
        const { data: rec } = await supabase
          .from('daily_metrics')
          .select('*')
          .eq('id', body.recordId)
          .single();
        oldValue = rec ? String((rec as Record<string, unknown>)[body.fieldName] ?? '') : undefined;
      }

      const requiresApproval = !req.authUser.permissions.includes(PERMISSIONS.METRICS_APPROVE);

      const { data: override, error: insertError } = await supabase
        .from('metric_overrides')
        .insert({
          table_name: body.tableName,
          record_id: body.recordId,
          field_name: body.fieldName,
          old_value: oldValue ?? null,
          new_value: body.newValue,
          override_reason: body.overrideReason,
          requires_approval: requiresApproval,
          created_by: req.authUser.id,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Auto-apply if user has approve permission.
      if (!requiresApproval) {
        if (body.tableName === 'daily_metrics') {
          const { error: rpcError } = await supabase.rpc('apply_metric_override', {
            p_table_name: body.tableName,
            p_field_name: body.fieldName,
            p_new_value: body.newValue,
            p_record_id: body.recordId,
          });
          if (rpcError) {
            app.log.error({ rpcError }, 'metric_override_apply_failed');
            // Fall back to direct update on the specific table.
            await supabase
              .from(body.tableName)
              .update({ [body.fieldName]: body.newValue })
              .eq('id', body.recordId);
          }
        }
        await supabase
          .from('metric_overrides')
          .update({
            approved_by: req.authUser.id,
            approved_at: new Date().toISOString(),
          })
          .eq('id', override.id);
      }

      await app.audit(req, {
        action: 'metrics.override.create',
        resourceType: body.tableName,
        resourceId: body.recordId,
        beforeValue: { [body.fieldName]: oldValue },
        afterValue: { [body.fieldName]: body.newValue, reason: body.overrideReason },
      });

      return reply.code(201).send({
        success: true,
        data: { override, applied: !requiresApproval },
      });
    },
  );

  // ─── POST /override/:id/approve ───────────────────────────────────────────
  app.post(
    '/override/:id/approve',
    {
      preHandler: [...auth, app.requirePermission(PERMISSIONS.METRICS_APPROVE)],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const supabase = supabaseAdmin();

      const { data: override, error: findError } = await supabase
        .from('metric_overrides')
        .select('*')
        .eq('id', id)
        .single();

      if (findError) throw findError;

      if (!override || override.approved_at) {
        return reply.code(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Override not found or already approved.' },
        });
      }

      // Enforce org scoping: look up the target record's property and verify org.
      const tableName = override.table_name as 'daily_metrics' | 'financial_metrics';
      const { data: targetRecord } = await supabase
        .from(tableName)
        .select('property_id')
        .eq('id', override.record_id)
        .single();

      if (targetRecord) {
        const { data: prop } = await supabase
          .from('properties')
          .select('org_id')
          .eq('id', targetRecord.property_id)
          .single();

        if (!prop || prop.org_id !== req.authUser.orgId) {
          return reply.code(403).send({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Access denied.' },
          });
        }
      }

      // Apply the override.
      const { error: rpcError } = await supabase.rpc('apply_metric_override', {
        p_table_name: override.table_name,
        p_field_name: override.field_name,
        p_new_value: override.new_value,
        p_record_id: override.record_id,
      });
      if (rpcError) {
        app.log.error({ rpcError }, 'metric_override_apply_failed');
        await supabase
          .from(override.table_name)
          .update({ [override.field_name]: override.new_value })
          .eq('id', override.record_id);
      }

      await supabase
        .from('metric_overrides')
        .update({
          approved_by: req.authUser.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', id);

      await app.audit(req, {
        action: 'metrics.override.approve',
        resourceType: override.table_name,
        resourceId: override.record_id,
      });

      return reply.send({ success: true, data: { message: 'Override applied.' } });
    },
  );
}
