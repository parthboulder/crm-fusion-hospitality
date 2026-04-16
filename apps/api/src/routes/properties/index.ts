/**
 * Properties routes — CRUD + portfolio-level stats.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabaseAdmin } from '../../lib/supabase.js';
import { PERMISSIONS } from '../../config/constants.js';

const propertyBodySchema = z.object({
  name: z.string().min(1).max(200),
  brand: z.string().optional(),
  brandCode: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().default('US'),
  timezone: z.string().default('America/New_York'),
  totalRooms: z.number().int().positive().optional(),
  pmsType: z.string().optional(),
  adrFloor: z.number().positive().optional(),
});

export async function propertiesRoutes(app: FastifyInstance) {
  const auth = [app.verifyAuth];

  // ─── GET / — list properties the user can access ──────────────────────────
  app.get('/', { preHandler: auth }, async (req, reply) => {
    const { authUser } = req;
    const supabase = supabaseAdmin();

    let q = supabase
      .from('properties')
      .select('id, name, brand, brand_code, city, state, total_rooms, pms_type, timezone')
      .eq('org_id', authUser.orgId)
      .eq('is_active', true);

    if (authUser.propertyIds.length > 0) {
      q = q.in('id', authUser.propertyIds);
    }

    q = q.order('name', { ascending: true });

    const { data: properties, error } = await q;

    if (error) throw error;

    // Fetch open alert counts per property.
    const propertyIds = properties.map((p) => p.id);
    const { data: alertCounts, error: alertError } = await supabase
      .from('alerts')
      .select('property_id')
      .eq('status', 'open')
      .in('property_id', propertyIds);

    if (alertError) throw alertError;

    // Build a count map.
    const countMap: Record<string, number> = {};
    for (const row of alertCounts ?? []) {
      countMap[row.property_id] = (countMap[row.property_id] ?? 0) + 1;
    }

    const data = properties.map((p) => ({
      ...p,
      _count: { alerts: countMap[p.id] ?? 0 },
    }));

    return reply.send({ success: true, data });
  });

  // ─── GET /:id — single property with recent metrics ──────────────────────
  app.get(
    '/:id',
    {
      preHandler: [
        ...auth,
        app.requirePropertyAccess((req) => (req.params as { id: string }).id),
      ],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const supabase = supabaseAdmin();

      const { data: property, error } = await supabase
        .from('properties')
        .select('*')
        .eq('id', id)
        .eq('org_id', req.authUser.orgId)
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (!property) {
        return reply.code(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Property not found.' },
        });
      }

      // Fetch related counts.
      const [reportsCount, openAlertsCount, activeTasksCount] = await Promise.all([
        supabase
          .from('reports')
          .select('*', { count: 'exact', head: true })
          .eq('property_id', id),
        supabase
          .from('alerts')
          .select('*', { count: 'exact', head: true })
          .eq('property_id', id)
          .eq('status', 'open'),
        supabase
          .from('tasks')
          .select('*', { count: 'exact', head: true })
          .eq('property_id', id)
          .in('status', ['open', 'in_progress']),
      ]);

      const propertyWithCounts = {
        ...property,
        _count: {
          reports: reportsCount.count ?? 0,
          alerts: openAlertsCount.count ?? 0,
          tasks: activeTasksCount.count ?? 0,
        },
      };

      // Last 30 days of daily metrics.
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data: recentMetrics, error: metricsError } = await supabase
        .from('daily_metrics')
        .select('*')
        .eq('property_id', id)
        .gte('metric_date', thirtyDaysAgo.toISOString())
        .order('metric_date', { ascending: false })
        .limit(30);

      if (metricsError) throw metricsError;

      return reply.send({ success: true, data: { property: propertyWithCounts, recentMetrics } });
    },
  );

  // ─── POST / — create property ─────────────────────────────────────────────
  app.post(
    '/',
    {
      preHandler: [...auth, app.requirePermission(PERMISSIONS.ADMIN_PROPERTIES)],
    },
    async (req, reply) => {
      const body = propertyBodySchema.parse(req.body);
      const supabase = supabaseAdmin();

      const { data: property, error } = await supabase
        .from('properties')
        .insert({
          org_id: req.authUser.orgId,
          name: body.name,
          country: body.country,
          timezone: body.timezone,
          brand: body.brand ?? null,
          brand_code: body.brandCode ?? null,
          address: body.address ?? null,
          city: body.city ?? null,
          state: body.state ?? null,
          total_rooms: body.totalRooms ?? null,
          pms_type: body.pmsType ?? null,
          adr_floor: body.adrFloor ?? null,
        })
        .select()
        .single();

      if (error) throw error;

      await app.audit(req, {
        action: 'property.create',
        resourceType: 'property',
        resourceId: property.id,
        afterValue: body,
      });

      return reply.code(201).send({ success: true, data: property });
    },
  );

  // ─── PATCH /:id — update property ────────────────────────────────────────
  app.patch(
    '/:id',
    {
      preHandler: [
        ...auth,
        app.requirePermission(PERMISSIONS.PROPERTIES_WRITE),
        app.requirePropertyAccess((req) => (req.params as { id: string }).id),
      ],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = propertyBodySchema.partial().parse(req.body);
      const supabase = supabaseAdmin();

      const { data: before, error: findError } = await supabase
        .from('properties')
        .select('*')
        .eq('id', id)
        .eq('org_id', req.authUser.orgId)
        .limit(1)
        .maybeSingle();

      if (findError) throw findError;

      if (!before) {
        return reply.code(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Property not found.' },
        });
      }

      // Map camelCase body to snake_case for Supabase.
      const columnMap: Record<string, string> = {
        name: 'name',
        brand: 'brand',
        brandCode: 'brand_code',
        address: 'address',
        city: 'city',
        state: 'state',
        country: 'country',
        timezone: 'timezone',
        totalRooms: 'total_rooms',
        pmsType: 'pms_type',
        adrFloor: 'adr_floor',
      };

      const updateData: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(body)) {
        if (value !== undefined && columnMap[key]) {
          updateData[columnMap[key]] = value;
        }
      }

      const { data: updated, error: updateError } = await supabase
        .from('properties')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (updateError) throw updateError;

      await app.audit(req, {
        action: 'property.update',
        resourceType: 'property',
        resourceId: id,
        beforeValue: before,
        afterValue: body,
      });

      return reply.send({ success: true, data: updated });
    },
  );

  // ─── GET /portfolio/summary — org-wide KPIs ───────────────────────────────
  app.get('/portfolio/summary', { preHandler: auth }, async (req, reply) => {
    const { authUser } = req;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const supabase = supabaseAdmin();

    // Get property IDs scoped to this org/user.
    let propertyIds: string[];
    if (authUser.propertyIds.length > 0) {
      propertyIds = authUser.propertyIds;
    } else {
      const { data: props, error: propsError } = await supabase
        .from('properties')
        .select('id')
        .eq('org_id', authUser.orgId);
      if (propsError) throw propsError;
      propertyIds = (props ?? []).map((p) => p.id);
    }

    if (propertyIds.length === 0) {
      return reply.send({
        success: true,
        data: { todayMetrics: null, mtdMetrics: null, openAlerts: [] },
      });
    }

    // Fetch today's metrics.
    const { data: todayRows, error: todayError } = await supabase
      .from('daily_metrics')
      .select('total_revenue, room_revenue, rooms_sold, total_rooms, occupancy_pct, adr, revpar')
      .in('property_id', propertyIds)
      .eq('metric_date', today.toISOString().split('T')[0]);

    if (todayError) throw todayError;

    const mtdStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const { data: mtdRows, error: mtdError } = await supabase
      .from('daily_metrics')
      .select('total_revenue, room_revenue, occupancy_pct, adr, revpar')
      .in('property_id', propertyIds)
      .gte('metric_date', mtdStart.toISOString().split('T')[0])
      .lte('metric_date', today.toISOString().split('T')[0]);

    if (mtdError) throw mtdError;

    // Compute aggregates in-app.
    const todayMetrics = {
      _sum: {
        total_revenue: todayRows.reduce((s, r) => s + (r.total_revenue ?? 0), 0),
        room_revenue: todayRows.reduce((s, r) => s + (r.room_revenue ?? 0), 0),
        rooms_sold: todayRows.reduce((s, r) => s + (r.rooms_sold ?? 0), 0),
        total_rooms: todayRows.reduce((s, r) => s + (r.total_rooms ?? 0), 0),
      },
      _avg: {
        occupancy_pct: todayRows.length ? todayRows.reduce((s, r) => s + (r.occupancy_pct ?? 0), 0) / todayRows.length : null,
        adr: todayRows.length ? todayRows.reduce((s, r) => s + (r.adr ?? 0), 0) / todayRows.length : null,
        revpar: todayRows.length ? todayRows.reduce((s, r) => s + (r.revpar ?? 0), 0) / todayRows.length : null,
      },
      _count: { id: todayRows.length },
    };

    const mtdMetrics = {
      _sum: {
        total_revenue: mtdRows.reduce((s, r) => s + (r.total_revenue ?? 0), 0),
        room_revenue: mtdRows.reduce((s, r) => s + (r.room_revenue ?? 0), 0),
      },
      _avg: {
        occupancy_pct: mtdRows.length ? mtdRows.reduce((s, r) => s + (r.occupancy_pct ?? 0), 0) / mtdRows.length : null,
        adr: mtdRows.length ? mtdRows.reduce((s, r) => s + (r.adr ?? 0), 0) / mtdRows.length : null,
        revpar: mtdRows.length ? mtdRows.reduce((s, r) => s + (r.revpar ?? 0), 0) / mtdRows.length : null,
      },
    };

    // Open alerts grouped by severity.
    const { data: alertRows, error: alertError } = await supabase
      .from('alerts')
      .select('severity')
      .eq('status', 'open')
      .in('property_id', propertyIds);

    if (alertError) throw alertError;

    const severityMap: Record<string, number> = {};
    for (const row of alertRows ?? []) {
      severityMap[row.severity] = (severityMap[row.severity] ?? 0) + 1;
    }
    const openAlerts = Object.entries(severityMap).map(([severity, count]) => ({
      severity,
      _count: { id: count },
    }));

    return reply.send({
      success: true,
      data: { todayMetrics, mtdMetrics, openAlerts },
    });
  });
}
