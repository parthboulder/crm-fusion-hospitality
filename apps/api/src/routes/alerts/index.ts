/**
 * Alerts routes — list, acknowledge, resolve.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabaseAdmin } from '../../lib/supabase.js';
import { PERMISSIONS } from '../../config/constants.js';

export async function alertsRoutes(app: FastifyInstance) {
  const auth = [app.verifyAuth];

  // ─── GET / — paginated alert list ─────────────────────────────────────────
  app.get('/', { preHandler: auth }, async (req, reply) => {
    const query = z
      .object({
        propertyId: z.string().uuid().optional(),
        severity: z.string().optional(),
        status: z.string().optional(),
        alertType: z.string().optional(),
        page: z.coerce.number().default(1),
        limit: z.coerce.number().max(100).default(20),
      })
      .parse(req.query);

    const { authUser } = req;
    const skip = (query.page - 1) * query.limit;
    const supabase = supabaseAdmin();

    // Build base query filters.
    let countQuery = supabase
      .from('alerts')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', authUser.orgId);

    let listQuery = supabase
      .from('alerts')
      .select(`
        *,
        property:properties!property_id ( name, brand ),
        report:reports!report_id ( report_type, report_date ),
        tasks ( id, status, assigned_to )
      `)
      .eq('org_id', authUser.orgId);

    // Apply optional filters to both queries.
    if (query.propertyId) {
      countQuery = countQuery.eq('property_id', query.propertyId);
      listQuery = listQuery.eq('property_id', query.propertyId);
    }
    if (query.severity) {
      countQuery = countQuery.eq('severity', query.severity);
      listQuery = listQuery.eq('severity', query.severity);
    }
    const statusFilter = query.status ?? 'open';
    countQuery = countQuery.eq('status', statusFilter);
    listQuery = listQuery.eq('status', statusFilter);

    if (query.alertType) {
      countQuery = countQuery.eq('alert_type', query.alertType);
      listQuery = listQuery.eq('alert_type', query.alertType);
    }
    if (authUser.propertyIds.length > 0) {
      countQuery = countQuery.in('property_id', authUser.propertyIds);
      listQuery = listQuery.in('property_id', authUser.propertyIds);
    }

    // Filter tasks to only open/in_progress.
    listQuery = listQuery.in('tasks.status', ['open', 'in_progress']);

    // Ordering + pagination.
    listQuery = listQuery
      .order('severity', { ascending: true })
      .order('created_at', { ascending: false })
      .range(skip, skip + query.limit - 1);

    const [countResult, listResult] = await Promise.all([countQuery, listQuery]);

    if (countResult.error) throw countResult.error;
    if (listResult.error) throw listResult.error;

    const total = countResult.count ?? 0;

    return reply.send({
      success: true,
      data: listResult.data,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    });
  });

  // ─── GET /:id — single alert with full detail ─────────────────────────────
  app.get('/:id', { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const supabase = supabaseAdmin();

    const { data: alert, error } = await supabase
      .from('alerts')
      .select(`
        *,
        property:properties!property_id ( * ),
        report:reports!report_id (
          *,
          files:report_files ( storage_path, original_name )
        ),
        tasks (
          *,
          assignee:user_profiles!assigned_to ( full_name, email )
        )
      `)
      .eq('id', id)
      .eq('org_id', req.authUser.orgId)
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!alert) {
      return reply.code(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Alert not found.' },
      });
    }

    if (
      req.authUser.propertyIds.length > 0 &&
      !req.authUser.propertyIds.includes(alert.property_id)
    ) {
      return reply.code(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied.' },
      });
    }

    return reply.send({ success: true, data: alert });
  });

  // ─── POST /:id/acknowledge ────────────────────────────────────────────────
  app.post(
    '/:id/acknowledge',
    {
      preHandler: [...auth, app.requirePermission(PERMISSIONS.ALERTS_ACKNOWLEDGE)],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const supabase = supabaseAdmin();

      const { data: alert, error: findError } = await supabase
        .from('alerts')
        .select('*')
        .eq('id', id)
        .eq('org_id', req.authUser.orgId)
        .limit(1)
        .maybeSingle();

      if (findError) throw findError;

      if (!alert) {
        return reply.code(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Alert not found.' },
        });
      }

      const { data: updated, error: updateError } = await supabase
        .from('alerts')
        .update({
          status: 'acknowledged',
          acknowledged_by: req.authUser.id,
          acknowledged_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (updateError) throw updateError;

      await app.audit(req, {
        action: 'alert.acknowledge',
        resourceType: 'alert',
        resourceId: id,
      });

      return reply.send({ success: true, data: updated });
    },
  );

  // ─── POST /:id/resolve ────────────────────────────────────────────────────
  app.post(
    '/:id/resolve',
    {
      preHandler: [...auth, app.requirePermission(PERMISSIONS.ALERTS_RESOLVE)],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z
        .object({ resolutionNotes: z.string().min(10) })
        .parse(req.body);

      const supabase = supabaseAdmin();

      const { data: alert, error: findError } = await supabase
        .from('alerts')
        .select('*')
        .eq('id', id)
        .eq('org_id', req.authUser.orgId)
        .limit(1)
        .maybeSingle();

      if (findError) throw findError;

      if (!alert) {
        return reply.code(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Alert not found.' },
        });
      }

      const { data: updated, error: updateError } = await supabase
        .from('alerts')
        .update({
          status: 'resolved',
          resolved_by: req.authUser.id,
          resolved_at: new Date().toISOString(),
          resolution_notes: body.resolutionNotes,
        })
        .eq('id', id)
        .select()
        .single();

      if (updateError) throw updateError;

      await app.audit(req, {
        action: 'alert.resolve',
        resourceType: 'alert',
        resourceId: id,
        afterValue: { notes: body.resolutionNotes },
      });

      return reply.send({ success: true, data: updated });
    },
  );
}
