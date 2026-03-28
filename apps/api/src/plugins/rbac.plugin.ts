/**
 * RBAC plugin — permission guard and property-scope guard factories.
 * Usage: { preHandler: [app.verifyAuth, app.requirePermission('reports:upload')] }
 */

import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Permission } from '../config/constants.js';

export const rbacPlugin = fp(async (app: FastifyInstance) => {
  /**
   * Returns a preHandler that asserts the caller has `permission`.
   */
  app.decorate('requirePermission', (permission: Permission) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      if (!req.authUser.permissions.includes(permission)) {
        return reply.code(403).send({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: `Required permission: ${permission}`,
          },
        });
      }
    };
  });

  /**
   * Returns a preHandler that asserts the caller can access propertyId
   * found in req.params or req.body.
   */
  app.decorate(
    'requirePropertyAccess',
    (getPropertyId: (req: FastifyRequest) => string) => {
      return async (req: FastifyRequest, reply: FastifyReply) => {
        const { authUser } = req;
        // super_admin and corporate have cross-property access (empty array = all).
        if (authUser.propertyIds.length === 0) return;

        const propertyId = getPropertyId(req);
        if (!authUser.propertyIds.includes(propertyId)) {
          return reply.code(403).send({
            success: false,
            error: {
              code: 'PROPERTY_ACCESS_DENIED',
              message: 'You do not have access to this property.',
            },
          });
        }
      };
    },
  );
});

declare module 'fastify' {
  interface FastifyInstance {
    requirePermission: (
      permission: Permission,
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

    requirePropertyAccess: (
      getPropertyId: (req: FastifyRequest) => string,
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
