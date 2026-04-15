/**
 * Tasks routes — CRUD, assignment, status transitions, comments.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '@fusion/db';
import { PERMISSIONS } from '../../config/constants.js';

const taskBodySchema = z.object({
  propertyId: z.string().uuid(),
  alertId: z.string().uuid().optional(),
  title: z.string().min(3).max(300),
  description: z.string().optional(),
  taskType: z.string().min(1),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  assignedTo: z.string().uuid().optional(),
  dueDate: z.string().optional(),
});

export async function tasksRoutes(app: FastifyInstance) {
  const auth = [app.verifyAuth];

  // ─── GET / ────────────────────────────────────────────────────────────────
  app.get('/', { preHandler: auth }, async (req, reply) => {
    const query = z
      .object({
        propertyId: z.string().uuid().optional(),
        status: z.string().optional(),
        priority: z.string().optional(),
        assignedTo: z.string().uuid().optional(),
        page: z.coerce.number().default(1),
        limit: z.coerce.number().max(100).default(20),
      })
      .parse(req.query);

    const { authUser } = req;
    const skip = (query.page - 1) * query.limit;

    const where = {
      orgId: authUser.orgId,
      ...(query.propertyId && { propertyId: query.propertyId }),
      ...(query.status && { status: query.status }),
      ...(query.priority && { priority: query.priority }),
      ...(query.assignedTo && { assignedTo: query.assignedTo }),
      ...(authUser.propertyIds.length > 0 && {
        propertyId: { in: authUser.propertyIds },
      }),
    };

    const [total, tasks] = await Promise.all([
      db.task.count({ where }),
      db.task.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        include: {
          property: { select: { name: true } },
          assignee: { select: { fullName: true, avatarUrl: true } },
          alert: { select: { alertType: true, severity: true } },
          _count: { select: { comments: true } },
        },
      }),
    ]);

    return reply.send({
      success: true,
      data: tasks,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    });
  });

  // ─── POST / — create task ─────────────────────────────────────────────────
  app.post(
    '/',
    { preHandler: [...auth, app.requirePermission(PERMISSIONS.TASKS_CREATE)] },
    async (req, reply) => {
      const body = taskBodySchema.parse(req.body);

      const task = await db.task.create({
        data: {
          orgId: req.authUser.orgId,
          propertyId: body.propertyId,
          alertId: body.alertId ?? null,
          title: body.title,
          description: body.description ?? null,
          taskType: body.taskType,
          priority: body.priority,
          assignedTo: body.assignedTo ?? null,
          ...(body.assignedTo ? { assignedBy: req.authUser.id } : {}),
          ...(body.dueDate ? { dueDate: new Date(body.dueDate) } : {}),
        },
      });

      await app.audit(req, {
        action: 'task.create',
        resourceType: 'task',
        resourceId: task.id,
        afterValue: body,
      });

      return reply.code(201).send({ success: true, data: task });
    },
  );

  // ─── PATCH /:id — update task status or assignee ─────────────────────────
  app.patch(
    '/:id',
    { preHandler: [...auth, app.requirePermission(PERMISSIONS.TASKS_ASSIGN)] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z
        .object({
          status: z.enum(['open', 'in_progress', 'blocked', 'completed', 'cancelled']).optional(),
          assignedTo: z.string().uuid().nullable().optional(),
          priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
          dueDate: z.string().nullable().optional(),
          description: z.string().optional(),
        })
        .parse(req.body);

      const before = await db.task.findFirst({ where: { id, orgId: req.authUser.orgId } });
      if (!before) {
        return reply.code(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Task not found.' },
        });
      }

      const { dueDate, ...rest } = body;
      const data: Record<string, unknown> = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== undefined),
      );
      if (dueDate !== undefined) {
        data.dueDate = dueDate === null ? null : new Date(dueDate);
      }
      if (body.status === 'completed') data.completedAt = new Date();
      if (body.assignedTo !== undefined) data.assignedBy = req.authUser.id;

      const updated = await db.task.update({
        where: { id },
        data,
      });

      await app.audit(req, {
        action: 'task.update',
        resourceType: 'task',
        resourceId: id,
        beforeValue: { status: before.status, assignedTo: before.assignedTo },
        afterValue: body,
      });

      return reply.send({ success: true, data: updated });
    },
  );

  // ─── POST /:id/comments ───────────────────────────────────────────────────
  app.post(
    '/:id/comments',
    { preHandler: auth },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { body: commentBody } = z
        .object({ body: z.string().min(1).max(2000) })
        .parse(req.body);

      const task = await db.task.findFirst({ where: { id, orgId: req.authUser.orgId } });
      if (!task) {
        return reply.code(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Task not found.' },
        });
      }

      const comment = await db.taskComment.create({
        data: { taskId: id, authorId: req.authUser.id, body: commentBody },
        include: { author: { select: { fullName: true, avatarUrl: true } } },
      });

      return reply.code(201).send({ success: true, data: comment });
    },
  );

  // ─── GET /:id/comments ────────────────────────────────────────────────────
  app.get('/:id/comments', { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const comments = await db.taskComment.findMany({
      where: { taskId: id },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { fullName: true, avatarUrl: true } } },
    });

    return reply.send({ success: true, data: comments });
  });
}
