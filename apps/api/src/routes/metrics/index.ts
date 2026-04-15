/**
 * Metrics routes — daily KPIs, trends, financials, overrides.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '@fusion/db';
import { PERMISSIONS } from '../../config/constants.js';

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

    const where = {
      metricDate: { gte: new Date(query.from), lte: new Date(query.to) },
      property: { orgId: authUser.orgId },
      ...(query.propertyId && { propertyId: query.propertyId }),
      ...(authUser.propertyIds.length > 0 && {
        propertyId: { in: authUser.propertyIds },
      }),
    };

    const metrics = await db.dailyMetrics.findMany({
      where,
      orderBy: [{ propertyId: 'asc' }, { metricDate: 'asc' }],
      include: { property: { select: { name: true, brand: true } } },
    });

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

      const where = {
        metricDate: { gte: new Date(query.from), lte: new Date(query.to) },
        property: { orgId: authUser.orgId },
        ...(query.propertyId && { propertyId: query.propertyId }),
        ...(authUser.propertyIds.length > 0 && {
          propertyId: { in: authUser.propertyIds },
        }),
      };

      const metrics = await db.financialMetrics.findMany({
        where,
        orderBy: [{ propertyId: 'asc' }, { metricDate: 'asc' }],
        include: { property: { select: { name: true } } },
      });

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

    const where = {
      metricDate: { gte: fromDate, lte: today },
      property: { orgId: authUser.orgId },
      ...(query.propertyId && { propertyId: query.propertyId }),
      ...(authUser.propertyIds.length > 0 && {
        propertyId: { in: authUser.propertyIds },
      }),
    };

    const [current, aggregates] = await Promise.all([
      db.dailyMetrics.findMany({
        where,
        orderBy: { metricDate: 'asc' },
        select: {
          metricDate: true,
          propertyId: true,
          occupancyPct: true,
          adr: true,
          revpar: true,
          totalRevenue: true,
          roomRevenue: true,
          pyTotalRevenue: true,
          pyRevpar: true,
          pyOccupancyPct: true,
        },
      }),
      db.dailyMetrics.aggregate({
        where,
        _avg: { occupancyPct: true, adr: true, revpar: true },
        _sum: { totalRevenue: true, roomRevenue: true, roomsSold: true },
      }),
    ]);

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

      // Fetch old value for audit trail.
      let oldValue: string | undefined;
      if (body.tableName === 'daily_metrics') {
        const rec = await db.dailyMetrics.findUnique({ where: { id: body.recordId } });
        oldValue = rec ? String((rec as Record<string, unknown>)[body.fieldName] ?? '') : undefined;
      }

      const requiresApproval = !req.authUser.permissions.includes(PERMISSIONS.METRICS_APPROVE);

      const override = await db.metricOverride.create({
        data: {
          tableName: body.tableName,
          recordId: body.recordId,
          fieldName: body.fieldName,
          oldValue: oldValue ?? null,
          newValue: body.newValue,
          overrideReason: body.overrideReason,
          requiresApproval,
          createdBy: req.authUser.id,
        },
      });

      // Auto-apply if user has approve permission.
      if (!requiresApproval) {
        if (body.tableName === 'daily_metrics') {
          await db.$executeRawUnsafe(
            `UPDATE daily_metrics SET "${body.fieldName}" = $1 WHERE id = $2::uuid`,
            body.newValue,
            body.recordId,
          );
        }
        await db.metricOverride.update({
          where: { id: override.id },
          data: { approvedBy: req.authUser.id, approvedAt: new Date() },
        });
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

      const override = await db.metricOverride.findUnique({ where: { id } });
      if (!override || override.approvedAt) {
        return reply.code(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Override not found or already approved.' },
        });
      }

      // Apply the override.
      await db.$executeRawUnsafe(
        `UPDATE ${override.tableName} SET "${override.fieldName}" = $1 WHERE id = $2::uuid`,
        override.newValue,
        override.recordId,
      );

      await db.metricOverride.update({
        where: { id },
        data: { approvedBy: req.authUser.id, approvedAt: new Date() },
      });

      await app.audit(req, {
        action: 'metrics.override.approve',
        resourceType: override.tableName,
        resourceId: override.recordId,
      });

      return reply.send({ success: true, data: { message: 'Override applied.' } });
    },
  );
}
