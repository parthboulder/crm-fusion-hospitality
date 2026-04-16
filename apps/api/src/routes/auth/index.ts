/**
 * Auth routes — login, logout, MFA, session management.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { supabaseAdmin } from '../../lib/supabase.js';
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
      const supabase = supabaseAdmin();
      const body = loginSchema.parse(req.body);

      const { data: user, error: userError } = await supabase
        .from('user_profiles')
        .select('*, roles(*)')
        .eq('email', body.email.toLowerCase())
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (userError) {
        req.log.error({ err: userError }, 'Failed to query user_profiles');
        return reply.code(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' },
        });
      }

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
      if (user.mfa_enabled || mfaRequiredRoles.includes(user.roles.name)) {
        if (!user.mfa_enabled) {
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

        // Retrieve stored TOTP secret (stored in metadata JSONB column).
        const totpSecret = (user.metadata as Record<string, unknown> | null)?.totp_secret as string | undefined;
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
      const { count: activeSessions, error: countError } = await supabase
        .from('user_sessions')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_active', true)
        .gt('expires_at', new Date().toISOString());

      if (countError) {
        req.log.error({ err: countError }, 'Failed to count active sessions');
        return reply.code(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' },
        });
      }

      if ((activeSessions ?? 0) >= env.SESSION_MAX_CONCURRENT) {
        // Revoke oldest session to make room.
        const { data: oldest } = await supabase
          .from('user_sessions')
          .select('*')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .order('last_activity', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (oldest) {
          await supabase
            .from('user_sessions')
            .update({ is_active: false, revoked_at: new Date().toISOString() })
            .eq('id', oldest.id);
        }
      }

      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      const { data: session, error: sessionError } = await supabase
        .from('user_sessions')
        .insert({
          user_id: user.id,
          token_hash: '', // will be updated after JWT is signed
          ip_address: req.ip,
          user_agent: req.headers['user-agent'] ?? null,
          expires_at: expiresAt.toISOString(),
        })
        .select()
        .single();

      if (sessionError || !session) {
        req.log.error({ err: sessionError }, 'Failed to create session');
        return reply.code(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' },
        });
      }

      const token = app.jwt.sign(
        { sub: user.id, sessionId: session.id, orgId: user.org_id },
        { expiresIn: '8h' },
      );

      // Store hash of token (not the token itself).
      const { createHash } = await import('node:crypto');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      await supabase
        .from('user_sessions')
        .update({ token_hash: tokenHash })
        .eq('id', session.id);

      await app.audit(req, {
        action: 'auth.login.success',
        resourceType: 'auth',
        resourceId: user.id,
      });

      await supabase
        .from('user_profiles')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', user.id);

      reply.setCookie('session_token', token, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production' || env.NODE_ENV === 'test',
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
            fullName: user.full_name,
            role: user.roles.name,
            orgId: user.org_id,
          },
          expiresAt,
        },
      });
    },
  );

  // ─── POST /oauth-callback ────────────────────────────────────────────────────
  app.post(
    '/oauth-callback',
    {
      config: { rateLimit: { max: env.RATE_LIMIT_AUTH_MAX, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      const supabase = supabaseAdmin();
      const { access_token } = z
        .object({ access_token: z.string().min(1), provider: z.string() })
        .parse(req.body);

      // Verify the Supabase access token and get the OAuth user.
      const { createClient } = await import('@supabase/supabase-js');
      const adminClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data: supaUser, error: supaError } = await adminClient.auth.getUser(access_token);

      if (supaError || !supaUser.user?.email) {
        return reply.code(401).send({
          success: false,
          error: { code: 'OAUTH_INVALID_TOKEN', message: 'Invalid OAuth session.' },
        });
      }

      const oauthEmail = supaUser.user.email.toLowerCase();

      // Match against existing user profile.
      const { data: user, error: userError } = await supabase
        .from('user_profiles')
        .select('*, roles(*)')
        .eq('email', oauthEmail)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (userError) {
        req.log.error({ err: userError }, 'Failed to query user_profiles');
        return reply.code(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' },
        });
      }

      if (!user) {
        await app.audit(req, {
          action: 'auth.oauth.failed',
          resourceType: 'auth',
          result: 'failure',
          failureReason: 'user_not_found',
          afterValue: { email: oauthEmail },
        });
        return reply.code(403).send({
          success: false,
          error: {
            code: 'USER_NOT_PROVISIONED',
            message: 'No account found for this Microsoft account. Contact your administrator.',
          },
        });
      }

      // Enforce concurrent session limit.
      const { count: activeSessions, error: countError } = await supabase
        .from('user_sessions')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_active', true)
        .gt('expires_at', new Date().toISOString());

      if (countError) {
        req.log.error({ err: countError }, 'Failed to count active sessions');
        return reply.code(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' },
        });
      }

      if ((activeSessions ?? 0) >= env.SESSION_MAX_CONCURRENT) {
        const { data: oldest } = await supabase
          .from('user_sessions')
          .select('*')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .order('last_activity', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (oldest) {
          await supabase
            .from('user_sessions')
            .update({ is_active: false, revoked_at: new Date().toISOString() })
            .eq('id', oldest.id);
        }
      }

      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      const { data: session, error: sessionError } = await supabase
        .from('user_sessions')
        .insert({
          user_id: user.id,
          token_hash: '',
          ip_address: req.ip,
          user_agent: req.headers['user-agent'] ?? null,
          expires_at: expiresAt.toISOString(),
        })
        .select()
        .single();

      if (sessionError || !session) {
        req.log.error({ err: sessionError }, 'Failed to create session');
        return reply.code(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' },
        });
      }

      const token = app.jwt.sign(
        { sub: user.id, sessionId: session.id, orgId: user.org_id },
        { expiresIn: '8h' },
      );

      const { createHash } = await import('node:crypto');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      await supabase
        .from('user_sessions')
        .update({ token_hash: tokenHash })
        .eq('id', session.id);

      await app.audit(req, {
        action: 'auth.oauth.success',
        resourceType: 'auth',
        resourceId: user.id,
        afterValue: { provider: 'azure' },
      });

      await supabase
        .from('user_profiles')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', user.id);

      reply.setCookie('session_token', token, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production' || env.NODE_ENV === 'test',
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
            fullName: user.full_name,
            role: user.roles.name,
            orgId: user.org_id,
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
      const supabase = supabaseAdmin();

      await supabase
        .from('user_sessions')
        .update({ is_active: false, revoked_at: new Date().toISOString() })
        .eq('id', req.authUser.sessionId);

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
    const supabase = supabaseAdmin();
    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(req.authUser.email, 'Fusion Hospitality', secret);
    const qrDataUrl = await QRCode.toDataURL(otpauth);

    // Store secret temporarily (pending confirmation).
    // Fetch current metadata, merge, and update via Supabase ORM.
    const { data: current } = await supabase
      .from('user_profiles')
      .select('metadata')
      .eq('id', req.authUser.id)
      .single();

    const updatedMetadata = {
      ...(current?.metadata ?? {}),
      pending_totp_secret: secret,
    };

    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ metadata: updatedMetadata })
      .eq('id', req.authUser.id);

    if (updateError) {
      req.log.error({ err: updateError }, 'Failed to store pending TOTP secret');
      return reply.code(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' },
      });
    }

    return reply.send({ success: true, data: { qrDataUrl } });
  });

  // ─── POST /mfa/confirm ──────────────────────────────────────────────────────
  app.post('/mfa/confirm', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const supabase = supabaseAdmin();
    const { code } = z.object({ code: z.string().length(6) }).parse(req.body);

    const { data: userRow, error: fetchError } = await supabase
      .from('user_profiles')
      .select('metadata')
      .eq('id', req.authUser.id)
      .single();

    if (fetchError) {
      req.log.error({ err: fetchError }, 'Failed to fetch user metadata');
      return reply.code(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' },
      });
    }

    const pending = userRow?.metadata?.['pending_totp_secret'];
    if (!pending || !authenticator.check(code, pending)) {
      return reply.code(400).send({
        success: false,
        error: { code: 'INVALID_CODE', message: 'Invalid verification code.' },
      });
    }

    // Move pending secret to confirmed, enable MFA.
    const currentMetadata = userRow.metadata ?? {};
    const { pending_totp_secret: _, ...restMetadata } = currentMetadata as Record<string, unknown>;
    const updatedMetadata = { ...restMetadata, totp_secret: pending };

    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ mfa_enabled: true, metadata: updatedMetadata })
      .eq('id', req.authUser.id);

    if (updateError) {
      req.log.error({ err: updateError }, 'Failed to enable MFA');
      return reply.code(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' },
      });
    }

    await app.audit(req, { action: 'auth.mfa.enabled', resourceType: 'auth' });
    return reply.send({ success: true, data: { message: 'MFA enabled.' } });
  });

  // ─── GET /sessions ──────────────────────────────────────────────────────────
  app.get('/sessions', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const supabase = supabaseAdmin();

    const { data: sessions, error: sessionsError } = await supabase
      .from('user_sessions')
      .select('id, ip_address, user_agent, last_activity, created_at')
      .eq('user_id', req.authUser.id)
      .eq('is_active', true)
      .order('last_activity', { ascending: false });

    if (sessionsError) {
      req.log.error({ err: sessionsError }, 'Failed to fetch sessions');
      return reply.code(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' },
      });
    }

    return reply.send({ success: true, data: sessions });
  });

  // ─── DELETE /sessions/:id ───────────────────────────────────────────────────
  app.delete('/sessions/:id', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const supabase = supabaseAdmin();
    const { id } = req.params as { id: string };

    const { data: session, error: sessionError } = await supabase
      .from('user_sessions')
      .select('*')
      .eq('id', id)
      .eq('user_id', req.authUser.id)
      .limit(1)
      .maybeSingle();

    if (sessionError) {
      req.log.error({ err: sessionError }, 'Failed to query session');
      return reply.code(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' },
      });
    }

    if (!session) {
      return reply.code(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Session not found.' },
      });
    }

    const { error: updateError } = await supabase
      .from('user_sessions')
      .update({
        is_active: false,
        revoked_at: new Date().toISOString(),
        revoked_by: req.authUser.id,
      })
      .eq('id', id);

    if (updateError) {
      req.log.error({ err: updateError }, 'Failed to revoke session');
      return reply.code(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' },
      });
    }

    await app.audit(req, {
      action: 'auth.session.revoked',
      resourceType: 'session',
      resourceId: id,
    });

    return reply.send({ success: true, data: { message: 'Session revoked.' } });
  });
}
