/**
 * Alerts routes — list, acknowledge, resolve.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '@fusion/db';
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

    const where = {
      orgId: authUser.orgId,
      ...(query.propertyId && { propertyId: query.propertyId }),
      ...(query.severity && { severity: query.severity }),
      ...(query.status ? { status: query.status } : { status: 'open' }),
      ...(query.alertType && { alertType: query.alertType }),
      ...(authUser.propertyIds.length > 0 && {
        propertyId: { in: authUser.propertyIds },
      }),
    };

    const [total, alerts] = await Promise.all([
      db.alert.count({ where }),
      db.alert.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
        include: {
          property: { select: { name: true, brand: true } },
          report: { select: { reportType: true, reportDate: true } },
          tasks: {
            where: { status: { in: ['open', 'in_progress'] } },
            select: { id: true, status: true, assignedTo: true },
          },
        },
      }),
    ]);

    return reply.send({
      success: true,
      data: alerts,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    });
  });

  // ─── GET /:id — single alert with full detail ─────────────────────────────
  app.get('/:id', { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const alert = await db.alert.findFirst({
      where: { id, orgId: req.authUser.orgId },
      include: {
        property: true,
        report: {
          include: { files: { where: { isCurrent: true }, select: { storagePath: true, originalName: true } } },
        },
        tasks: { include: { assignee: { select: { fullName: true, email: true } } } },
      },
    });

    if (!alert) {
      return reply.code(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Alert not found.' },
      });
    }

    if (
      req.authUser.propertyIds.length > 0 &&
      !req.authUser.propertyIds.includes(alert.propertyId)
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

      const alert = await db.alert.findFirst({
        where: { id, orgId: req.authUser.orgId },
      });

      if (!alert) {
        return reply.code(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Alert not found.' },
        });
      }

      const updated = await db.alert.update({
        where: { id },
        data: {
          status: 'acknowledged',
          acknowledgedBy: req.authUser.id,
          acknowledgedAt: new Date(),
        },
      });

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

      const alert = await db.alert.findFirst({
        where: { id, orgId: req.authUser.orgId },
      });

      if (!alert) {
        return reply.code(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Alert not found.' },
        });
      }

      const updated = await db.alert.update({
        where: { id },
        data: {
          status: 'resolved',
          resolvedBy: req.authUser.id,
          resolvedAt: new Date(),
          resolutionNotes: body.resolutionNotes,
        },
      });

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
