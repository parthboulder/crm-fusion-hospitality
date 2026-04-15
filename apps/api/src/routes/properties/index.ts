/**
 * Properties routes — CRUD + portfolio-level stats.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '@fusion/db';
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

    const where = {
      orgId: authUser.orgId,
      isActive: true,
      ...(authUser.propertyIds.length > 0 && { id: { in: authUser.propertyIds } }),
    };

    const properties = await db.property.findMany({
      where,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        brand: true,
        brandCode: true,
        city: true,
        state: true,
        totalRooms: true,
        pmsType: true,
        timezone: true,
        _count: { select: { alerts: { where: { status: 'open' } } } },
      },
    });

    return reply.send({ success: true, data: properties });
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

      const property = await db.property.findFirst({
        where: { id, orgId: req.authUser.orgId },
        include: {
          _count: {
            select: {
              reports: true,
              alerts: { where: { status: 'open' } },
              tasks: { where: { status: { in: ['open', 'in_progress'] } } },
            },
          },
        },
      });

      if (!property) {
        return reply.code(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Property not found.' },
        });
      }

      // Last 30 days of daily metrics.
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const recentMetrics = await db.dailyMetrics.findMany({
        where: { propertyId: id, metricDate: { gte: thirtyDaysAgo } },
        orderBy: { metricDate: 'desc' },
        take: 30,
      });

      return reply.send({ success: true, data: { property, recentMetrics } });
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

      const property = await db.property.create({
        data: {
          orgId: req.authUser.orgId,
          name: body.name,
          country: body.country,
          timezone: body.timezone,
          brand: body.brand ?? null,
          brandCode: body.brandCode ?? null,
          address: body.address ?? null,
          city: body.city ?? null,
          state: body.state ?? null,
          totalRooms: body.totalRooms ?? null,
          pmsType: body.pmsType ?? null,
          adrFloor: body.adrFloor ?? null,
        },
      });

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
      const data = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));

      const before = await db.property.findFirst({ where: { id, orgId: req.authUser.orgId } });
      if (!before) {
        return reply.code(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Property not found.' },
        });
      }

      const updated = await db.property.update({ where: { id }, data });

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

    const propertyFilter =
      authUser.propertyIds.length > 0
        ? { propertyId: { in: authUser.propertyIds } }
        : { property: { orgId: authUser.orgId } };

    const [todayMetrics, mtdMetrics, openAlerts] = await Promise.all([
      db.dailyMetrics.aggregate({
        where: { ...propertyFilter, metricDate: today },
        _sum: { totalRevenue: true, roomRevenue: true, roomsSold: true, totalRooms: true },
        _avg: { occupancyPct: true, adr: true, revpar: true },
        _count: { id: true },
      }),

      db.dailyMetrics.aggregate({
        where: {
          ...propertyFilter,
          metricDate: {
            gte: new Date(today.getFullYear(), today.getMonth(), 1),
            lte: today,
          },
        },
        _sum: { totalRevenue: true, roomRevenue: true },
        _avg: { occupancyPct: true, adr: true, revpar: true },
      }),

      db.alert.groupBy({
        by: ['severity'],
        where: {
          status: 'open',
          property: { orgId: authUser.orgId },
          ...(authUser.propertyIds.length > 0 && {
            propertyId: { in: authUser.propertyIds },
          }),
        },
        _count: { id: true },
      }),
    ]);

    return reply.send({
      success: true,
      data: { todayMetrics, mtdMetrics, openAlerts },
    });
  });
}
