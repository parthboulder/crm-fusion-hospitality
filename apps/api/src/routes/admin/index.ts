/**
 * Admin routes — users, roles, audit logs, session management.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { db } from '@fusion/db';
import { env } from '../../config/env.js';
import { PERMISSIONS } from '../../config/constants.js';

export async function adminRoutes(app: FastifyInstance) {
  const adminAuth = [app.verifyAuth, app.requirePermission(PERMISSIONS.ADMIN_USERS)];

  // ─── GET /users ───────────────────────────────────────────────────────────
  app.get('/users', { preHandler: adminAuth }, async (req, reply) => {
    const users = await db.userProfile.findMany({
      where: { orgId: req.authUser.orgId },
      include: {
        role: { select: { name: true, displayName: true } },
        _count: { select: { sessions: { where: { isActive: true } } } },
      },
      orderBy: { fullName: 'asc' },
    });

    return reply.send({ success: true, data: users });
  });

  // ─── POST /users — invite new user ────────────────────────────────────────
  app.post('/users', { preHandler: adminAuth }, async (req, reply) => {
    const body = z
      .object({
        email: z.string().email(),
        fullName: z.string().min(2),
        roleId: z.string().uuid(),
        propertyIds: z.array(z.string().uuid()).optional(),
      })
      .parse(req.body);

    // Create user in Supabase Auth (sends invite email).
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: authData, error: authError } = await supabase.auth.admin.inviteUserByEmail(
      body.email,
      { data: { orgId: req.authUser.orgId, fullName: body.fullName } },
    );

    if (authError || !authData.user) {
      app.log.error({ authError }, 'user_invite_failed');
      return reply.code(500).send({
        success: false,
        error: { code: 'INVITE_FAILED', message: 'Failed to send invite.' },
      });
    }

    const user = await db.userProfile.create({
      data: {
        id: authData.user.id,
        orgId: req.authUser.orgId,
        email: body.email.toLowerCase(),
        fullName: body.fullName,
        roleId: body.roleId,
        userPropertyAccess: body.propertyIds?.length
          ? {
              createMany: {
                data: body.propertyIds.map((propertyId) => ({
                  propertyId,
                  grantedBy: req.authUser.id,
                })),
              },
            }
          : undefined,
      },
    });

    await app.audit(req, {
      action: 'admin.user.invite',
      resourceType: 'user',
      resourceId: user.id,
      afterValue: { email: body.email, roleId: body.roleId },
    });

    return reply.code(201).send({ success: true, data: user });
  });

  // ─── PATCH /users/:id ─────────────────────────────────────────────────────
  app.patch('/users/:id', { preHandler: adminAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        roleId: z.string().uuid().optional(),
        isActive: z.boolean().optional(),
        propertyIds: z.array(z.string().uuid()).optional(),
      })
      .parse(req.body);

    const before = await db.userProfile.findFirst({
      where: { id, orgId: req.authUser.orgId },
    });

    if (!before) {
      return reply.code(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'User not found.' },
      });
    }

    // Prevent deactivating yourself.
    if (body.isActive === false && id === req.authUser.id) {
      return reply.code(400).send({
        success: false,
        error: { code: 'SELF_DEACTIVATE', message: 'Cannot deactivate your own account.' },
      });
    }

    const updated = await db.userProfile.update({
      where: { id },
      data: {
        ...(body.roleId !== undefined && { roleId: body.roleId }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
    });

    // Update property access if provided.
    if (body.propertyIds !== undefined) {
      await db.userPropertyAccess.deleteMany({ where: { userId: id } });
      if (body.propertyIds.length > 0) {
        await db.userPropertyAccess.createMany({
          data: body.propertyIds.map((propertyId) => ({
            userId: id,
            propertyId,
            grantedBy: req.authUser.id,
          })),
        });
      }
    }

    await app.audit(req, {
      action: 'admin.user.update',
      resourceType: 'user',
      resourceId: id,
      beforeValue: { roleId: before.roleId, isActive: before.isActive },
      afterValue: body,
    });

    return reply.send({ success: true, data: updated });
  });

  // ─── DELETE /users/:id/sessions — force-revoke all sessions ──────────────
  app.delete(
    '/users/:id/sessions',
    { preHandler: [app.verifyAuth, app.requirePermission(PERMISSIONS.ADMIN_SESSIONS)] },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      await db.userSession.updateMany({
        where: { userId: id, isActive: true },
        data: { isActive: false, revokedAt: new Date(), revokedBy: req.authUser.id },
      });

      await app.audit(req, {
        action: 'admin.sessions.revoke_all',
        resourceType: 'user',
        resourceId: id,
      });

      return reply.send({ success: true, data: { message: 'All sessions revoked.' } });
    },
  );

  // ─── GET /audit-logs ──────────────────────────────────────────────────────
  app.get(
    '/audit-logs',
    { preHandler: [app.verifyAuth, app.requirePermission(PERMISSIONS.ADMIN_AUDIT)] },
    async (req, reply) => {
      const query = z
        .object({
          userId: z.string().uuid().optional(),
          action: z.string().optional(),
          resourceType: z.string().optional(),
          from: z.string().optional(),
          to: z.string().optional(),
          page: z.coerce.number().default(1),
          limit: z.coerce.number().max(200).default(50),
        })
        .parse(req.query);

      const skip = (query.page - 1) * query.limit;

      const where = {
        orgId: req.authUser.orgId,
        ...(query.userId && { userId: query.userId }),
        ...(query.action && { action: { contains: query.action } }),
        ...(query.resourceType && { resourceType: query.resourceType }),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from && { gte: new Date(query.from) }),
                ...(query.to && { lte: new Date(query.to) }),
              },
            }
          : {}),
      };

      const [total, logs] = await Promise.all([
        db.auditLog.count({ where }),
        db.auditLog.findMany({
          where,
          skip,
          take: query.limit,
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      return reply.send({
        success: true,
        data: logs,
        total,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(total / query.limit),
      });
    },
  );

  // ─── GET /roles ───────────────────────────────────────────────────────────
  app.get(
    '/roles',
    { preHandler: [app.verifyAuth, app.requirePermission(PERMISSIONS.ADMIN_ROLES)] },
    async (req, reply) => {
      const roles = await db.role.findMany({
        where: { orgId: req.authUser.orgId },
        include: {
          rolePermissions: { include: { permission: true } },
          _count: { select: { userProfiles: true } },
        },
        orderBy: { displayName: 'asc' },
      });

      return reply.send({ success: true, data: roles });
    },
  );
}
