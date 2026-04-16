/**
 * Auth plugin — JWT verification + session validation + user context hydration.
 * Attaches req.authUser on every authenticated request.
 */

import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabaseAdmin } from '../lib/supabase.js';
import { env } from '../config/env.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import type { AuthUser } from '../types/index.js';
import type { SystemRole } from '../config/constants.js';

export const authPlugin = fp(async (app: FastifyInstance) => {
  await app.register(cookie);

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET environment variable is required. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64\'))"');
  }

  await app.register(jwt, {
    secret: jwtSecret,
    cookie: { cookieName: 'session_token', signed: false },
  });

  // Decorate with a verifyAuth preHandler — add to any route that needs auth.
  app.decorate(
    'verifyAuth',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const supabase = supabaseAdmin();

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
      const { data: session, error: sessionError } = await supabase
        .from('user_sessions')
        .select('*')
        .eq('id', payload.sessionId)
        .eq('user_id', payload.sub)
        .eq('is_active', true)
        .gt('expires_at', new Date().toISOString())
        .limit(1)
        .maybeSingle();

      if (sessionError) {
        app.log.error({ err: sessionError }, 'session_lookup_failed');
        return reply.code(500).send({
          success: false,
          error: { code: 'INTERNAL', message: 'Session validation failed.' },
        });
      }

      if (!session) {
        return reply.code(401).send({
          success: false,
          error: { code: 'SESSION_EXPIRED', message: 'Session expired or revoked.' },
        });
      }

      // Hydrate user profile + role.
      const { data: user, error: userError } = await supabase
        .from('user_profiles')
        .select('*, role:roles(*)')
        .eq('id', payload.sub)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (userError) {
        app.log.error({ err: userError }, 'user_profile_lookup_failed');
        return reply.code(500).send({
          success: false,
          error: { code: 'INTERNAL', message: 'User profile lookup failed.' },
        });
      }

      if (!user) {
        return reply.code(401).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User account not found.' },
        });
      }

      // Fetch property access separately.
      const { data: propertyAccess } = await supabase
        .from('user_property_access')
        .select('property_id')
        .eq('user_id', payload.sub);

      const roleName = user.role.name as SystemRole;
      const permissions = ROLE_PERMISSIONS[roleName] ?? [];

      req.authUser = {
        id: user.id,
        orgId: user.org_id,
        email: user.email,
        fullName: user.full_name,
        roleId: user.role_id,
        roleName,
        sessionId: payload.sessionId,
        permissions,
        propertyIds:
          roleName === 'super_admin' || roleName === 'corporate'
            ? [] // empty means all properties
            : (propertyAccess ?? []).map((a: { property_id: string }) => a.property_id),
      } satisfies AuthUser;

      // Rolling session — update last activity.
      await supabase
        .from('user_sessions')
        .update({ last_activity: new Date().toISOString() })
        .eq('id', session.id)
        .then(null, () => null); // non-critical
    },
  );
});

// Augment FastifyInstance type.
declare module 'fastify' {
  interface FastifyInstance {
    verifyAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
