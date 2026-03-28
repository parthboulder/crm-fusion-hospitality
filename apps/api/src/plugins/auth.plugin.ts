/**
 * Auth plugin — JWT verification + session validation + user context hydration.
 * Attaches req.authUser on every authenticated request.
 */

import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '@fusion/db';
import { env } from '../config/env.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import type { AuthUser } from '../types/index.js';
import type { SystemRole } from '../config/constants.js';

export const authPlugin = fp(async (app: FastifyInstance) => {
  await app.register(cookie);

  await app.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: { cookieName: 'session_token', signed: false },
  });

  // Decorate with a verifyAuth preHandler — add to any route that needs auth.
  app.decorate(
    'verifyAuth',
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        await req.jwtVerify();
      } catch {
        return reply.code(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Invalid or expired session.' },
        });
      }

      const payload = req.user as { sub: string; sessionId: string };

      // Validate session is still active in DB.
      const session = await db.userSession.findFirst({
        where: {
          id: payload.sessionId,
          userId: payload.sub,
          isActive: true,
          expiresAt: { gt: new Date() },
        },
      });

      if (!session) {
        return reply.code(401).send({
          success: false,
          error: { code: 'SESSION_EXPIRED', message: 'Session expired or revoked.' },
        });
      }

      // Hydrate user profile + role.
      const user = await db.userProfile.findFirst({
        where: { id: payload.sub, isActive: true },
        include: { role: true, userPropertyAccess: { select: { propertyId: true } } },
      });

      if (!user) {
        return reply.code(401).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User account not found.' },
        });
      }

      const roleName = user.role.name as SystemRole;
      const permissions = ROLE_PERMISSIONS[roleName] ?? [];

      req.authUser = {
        id: user.id,
        orgId: user.orgId,
        email: user.email,
        fullName: user.fullName,
        roleId: user.roleId,
        roleName,
        sessionId: payload.sessionId,
        permissions,
        propertyIds:
          roleName === 'super_admin' || roleName === 'corporate'
            ? [] // empty means all properties
            : user.userPropertyAccess.map((a) => a.propertyId),
      } satisfies AuthUser;

      // Rolling session — update last activity.
      await db.userSession
        .update({
          where: { id: session.id },
          data: { lastActivity: new Date() },
        })
        .catch(() => null); // non-critical
    },
  );
});

// Augment FastifyInstance type.
declare module 'fastify' {
  interface FastifyInstance {
    verifyAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
