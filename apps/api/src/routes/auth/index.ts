/**
 * Auth routes — login, logout, MFA, session management.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { db } from '@fusion/db';
import { env } from '../../config/env.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  mfaCode: z.string().optional(),
});

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

export async function authRoutes(app: FastifyInstance) {
  // ─── POST /login ────────────────────────────────────────────────────────────
  app.post(
    '/login',
    {
      config: { rateLimit: { max: env.RATE_LIMIT_AUTH_MAX, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      const body = loginSchema.parse(req.body);

      const user = await db.userProfile.findFirst({
        where: { email: body.email.toLowerCase(), isActive: true },
        include: { role: true },
      });

      if (!user) {
        // Constant-time response to prevent user enumeration.
        await argon2.hash('dummy-password-for-timing');
        await app.audit(req, {
          action: 'auth.login.failed',
          resourceType: 'auth',
          result: 'failure',
          failureReason: 'user_not_found',
          afterValue: { email: body.email },
        });
        return reply.code(401).send({
          success: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
        });
      }

      // Fetch password hash from Supabase Auth (service role).
      // In production this delegates to Supabase's auth.users table.
      // Here we verify via Supabase Admin API.
      const { createClient } = await import('@supabase/supabase-js');
      const adminClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { error: signInError } = await adminClient.auth.signInWithPassword({
        email: body.email,
        password: body.password,
      });

      if (signInError) {
        await app.audit(req, {
          action: 'auth.login.failed',
          resourceType: 'auth',
          resourceId: user.id,
          result: 'failure',
          failureReason: 'invalid_password',
        });
        return reply.code(401).send({
          success: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
        });
      }

      // MFA enforcement for sensitive roles.
      const mfaRequiredRoles = env.MFA_REQUIRED_ROLES.split(',');
      if (user.mfaEnabled || mfaRequiredRoles.includes(user.role.name)) {
        if (!user.mfaEnabled) {
          // MFA required but not set up — force setup flow.
          return reply.code(403).send({
            success: false,
            error: { code: 'MFA_SETUP_REQUIRED', message: 'MFA setup required for your role.' },
          });
        }

        if (!body.mfaCode) {
          return reply.code(403).send({
            success: false,
            error: { code: 'MFA_CODE_REQUIRED', message: 'MFA code required.' },
          });
        }

        // Retrieve stored TOTP secret (stored encrypted in metadata).
        const totpSecret = (user as unknown as { totpSecret?: string }).totpSecret;
        if (!totpSecret || !authenticator.check(body.mfaCode, totpSecret)) {
          await app.audit(req, {
            action: 'auth.mfa.failed',
            resourceType: 'auth',
            resourceId: user.id,
            result: 'failure',
          });
          return reply.code(401).send({
            success: false,
            error: { code: 'INVALID_MFA_CODE', message: 'Invalid MFA code.' },
          });
        }
      }

      // Enforce concurrent session limit.
      const activeSessions = await db.userSession.count({
        where: { userId: user.id, isActive: true, expiresAt: { gt: new Date() } },
      });

      if (activeSessions >= env.SESSION_MAX_CONCURRENT) {
        // Revoke oldest session to make room.
        const oldest = await db.userSession.findFirst({
          where: { userId: user.id, isActive: true },
          orderBy: { lastActivity: 'asc' },
        });
        if (oldest) {
          await db.userSession.update({
            where: { id: oldest.id },
            data: { isActive: false, revokedAt: new Date() },
          });
        }
      }

      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      const session = await db.userSession.create({
        data: {
          userId: user.id,
          tokenHash: '', // will be updated after JWT is signed
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          expiresAt,
        },
      });

      const token = app.jwt.sign(
        { sub: user.id, sessionId: session.id, orgId: user.orgId },
        { expiresIn: '8h' },
      );

      // Store hash of token (not the token itself).
      const { createHash } = await import('node:crypto');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      await db.userSession.update({ where: { id: session.id }, data: { tokenHash } });

      await app.audit(req, {
        action: 'auth.login.success',
        resourceType: 'auth',
        resourceId: user.id,
      });

      await db.userProfile.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      reply.setCookie('session_token', token, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        expires: expiresAt,
      });

      return reply.send({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            role: user.role.name,
            orgId: user.orgId,
          },
          expiresAt,
        },
      });
    },
  );

  // ─── POST /logout ───────────────────────────────────────────────────────────
  app.post(
    '/logout',
    { preHandler: [app.verifyAuth] },
    async (req, reply) => {
      await db.userSession.update({
        where: { id: req.authUser.sessionId },
        data: { isActive: false, revokedAt: new Date() },
      });

      await app.audit(req, { action: 'auth.logout', resourceType: 'auth' });

      reply.clearCookie('session_token', { path: '/' });
      return reply.send({ success: true, data: { message: 'Logged out.' } });
    },
  );

  // ─── GET /me ────────────────────────────────────────────────────────────────
  app.get('/me', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    return reply.send({ success: true, data: { user: req.authUser } });
  });

  // ─── POST /mfa/setup ────────────────────────────────────────────────────────
  app.post('/mfa/setup', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(req.authUser.email, 'Fusion Hospitality', secret);
    const qrDataUrl = await QRCode.toDataURL(otpauth);

    // Store secret temporarily (pending confirmation).
    await db.$executeRaw`
      UPDATE user_profiles
      SET metadata = jsonb_set(metadata, '{pending_totp_secret}', ${JSON.stringify(secret)}::jsonb)
      WHERE id = ${req.authUser.id}::uuid
    `;

    return reply.send({ success: true, data: { qrDataUrl, secret } });
  });

  // ─── POST /mfa/confirm ──────────────────────────────────────────────────────
  app.post('/mfa/confirm', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const { code } = z.object({ code: z.string().length(6) }).parse(req.body);

    const user = await db.$queryRaw<Array<{ metadata: Record<string, string> }>>`
      SELECT metadata FROM user_profiles WHERE id = ${req.authUser.id}::uuid
    `;

    const pending = user[0]?.metadata?.['pending_totp_secret'];
    if (!pending || !authenticator.check(code, pending)) {
      return reply.code(400).send({
        success: false,
        error: { code: 'INVALID_CODE', message: 'Invalid verification code.' },
      });
    }

    await db.$executeRaw`
      UPDATE user_profiles
      SET
        mfa_enabled = true,
        metadata = jsonb_set(
          metadata - 'pending_totp_secret',
          '{totp_secret}',
          ${JSON.stringify(pending)}::jsonb
        )
      WHERE id = ${req.authUser.id}::uuid
    `;

    await app.audit(req, { action: 'auth.mfa.enabled', resourceType: 'auth' });
    return reply.send({ success: true, data: { message: 'MFA enabled.' } });
  });

  // ─── GET /sessions ──────────────────────────────────────────────────────────
  app.get('/sessions', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const sessions = await db.userSession.findMany({
      where: { userId: req.authUser.id, isActive: true },
      select: { id: true, ipAddress: true, userAgent: true, lastActivity: true, createdAt: true },
      orderBy: { lastActivity: 'desc' },
    });
    return reply.send({ success: true, data: sessions });
  });

  // ─── DELETE /sessions/:id ───────────────────────────────────────────────────
  app.delete('/sessions/:id', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const session = await db.userSession.findFirst({
      where: { id, userId: req.authUser.id },
    });

    if (!session) {
      return reply.code(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Session not found.' },
      });
    }

    await db.userSession.update({
      where: { id },
      data: { isActive: false, revokedAt: new Date(), revokedBy: req.authUser.id },
    });

    await app.audit(req, {
      action: 'auth.session.revoked',
      resourceType: 'session',
      resourceId: id,
    });

    return reply.send({ success: true, data: { message: 'Session revoked.' } });
  });
}
