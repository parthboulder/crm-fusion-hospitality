/**
 * Admin routes — users, roles, audit logs, session management.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabaseAdmin } from '../../lib/supabase.js';
import { env } from '../../config/env.js';
import { PERMISSIONS } from '../../config/constants.js';

export async function adminRoutes(app: FastifyInstance) {
  const adminAuth = [app.verifyAuth, app.requirePermission(PERMISSIONS.ADMIN_USERS)];

  // ─── GET /users ───────────────────────────────────────────────────────────
  app.get('/users', { preHandler: adminAuth }, async (req, reply) => {
    const supabase = supabaseAdmin();

    const { data: users, error } = await supabase
      .from('user_profiles')
      .select(`
        *,
        role:roles!role_id ( name, display_name )
      `)
      .eq('org_id', req.authUser.orgId)
      .order('full_name', { ascending: true });

    if (error) throw error;

    // Aggregate active session counts per user. Supabase doesn't support a
    // grouped count in a single query, so do one count call and bucket by id.
    const userIds = (users ?? []).map((u) => u.id as string);
    const sessionCounts = new Map<string, number>();
    if (userIds.length > 0) {
      const { data: sessions, error: sessErr } = await supabase
        .from('user_sessions')
        .select('user_id')
        .in('user_id', userIds)
        .eq('is_active', true)
        .gt('expires_at', new Date().toISOString());
      if (sessErr) {
        app.log.warn({ err: sessErr.message }, 'admin_users.session_count_failed');
      } else {
        for (const s of sessions ?? []) {
          const uid = (s as { user_id: string }).user_id;
          sessionCounts.set(uid, (sessionCounts.get(uid) ?? 0) + 1);
        }
      }
    }

    // Reshape to camelCase keys the frontend expects.
    const reshaped = (users ?? []).map((u) => {
      const r = (u as { role?: { name?: string; display_name?: string } }).role;
      return {
        id: u.id,
        email: u.email,
        fullName: u.full_name,
        isActive: u.is_active,
        mfaEnabled: u.mfa_enabled,
        lastLoginAt: u.last_login_at,
        role: r ? { name: r.name ?? '', displayName: r.display_name ?? r.name ?? '' } : null,
        _count: { sessions: sessionCounts.get(u.id as string) ?? 0 },
      };
    });

    return reply.send({ success: true, data: reshaped });
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

    const supabase = supabaseAdmin();

    // Create user in Supabase Auth (sends invite email).
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

    const { data: user, error: profileError } = await supabase
      .from('user_profiles')
      .insert({
        id: authData.user.id,
        org_id: req.authUser.orgId,
        email: body.email.toLowerCase(),
        full_name: body.fullName,
        role_id: body.roleId,
      })
      .select()
      .single();

    if (profileError) throw profileError;

    // Grant property access if provided.
    if (body.propertyIds?.length) {
      const accessRows = body.propertyIds.map((propertyId) => ({
        user_id: authData.user!.id,
        property_id: propertyId,
        granted_by: req.authUser.id,
      }));

      const { error: accessError } = await supabase
        .from('user_property_access')
        .insert(accessRows);

      if (accessError) throw accessError;
    }

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

    const supabase = supabaseAdmin();

    const { data: before, error: findError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', id)
      .eq('org_id', req.authUser.orgId)
      .limit(1)
      .maybeSingle();

    if (findError) throw findError;

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

    const updateData: Record<string, unknown> = {};
    if (body.roleId !== undefined) updateData.role_id = body.roleId;
    if (body.isActive !== undefined) updateData.is_active = body.isActive;

    const { data: updated, error: updateError } = await supabase
      .from('user_profiles')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    // Update property access if provided.
    if (body.propertyIds !== undefined) {
      // Remove existing access.
      await supabase
        .from('user_property_access')
        .delete()
        .eq('user_id', id);

      // Insert new access.
      if (body.propertyIds.length > 0) {
        const accessRows = body.propertyIds.map((propertyId) => ({
          user_id: id,
          property_id: propertyId,
          granted_by: req.authUser.id,
        }));

        const { error: accessError } = await supabase
          .from('user_property_access')
          .insert(accessRows);

        if (accessError) throw accessError;
      }
    }

    await app.audit(req, {
      action: 'admin.user.update',
      resourceType: 'user',
      resourceId: id,
      beforeValue: { role_id: before.role_id, is_active: before.is_active },
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
      const supabase = supabaseAdmin();

      // Supabase doesn't have updateMany — fetch active sessions and update them.
      const { data: activeSessions, error: fetchError } = await supabase
        .from('user_sessions')
        .select('id')
        .eq('user_id', id)
        .eq('is_active', true);

      if (fetchError) throw fetchError;

      if (activeSessions && activeSessions.length > 0) {
        const sessionIds = activeSessions.map((s) => s.id);
        const { error: revokeError } = await supabase
          .from('user_sessions')
          .update({
            is_active: false,
            revoked_at: new Date().toISOString(),
            revoked_by: req.authUser.id,
          })
          .in('id', sessionIds);

        if (revokeError) throw revokeError;
      }

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
      const supabase = supabaseAdmin();

      let countQuery = supabase
        .from('audit_logs')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', req.authUser.orgId);

      let listQuery = supabase
        .from('audit_logs')
        .select('*')
        .eq('org_id', req.authUser.orgId);

      if (query.userId) {
        countQuery = countQuery.eq('user_id', query.userId);
        listQuery = listQuery.eq('user_id', query.userId);
      }
      if (query.action) {
        countQuery = countQuery.ilike('action', `%${query.action}%`);
        listQuery = listQuery.ilike('action', `%${query.action}%`);
      }
      if (query.resourceType) {
        countQuery = countQuery.eq('resource_type', query.resourceType);
        listQuery = listQuery.eq('resource_type', query.resourceType);
      }
      if (query.from) {
        countQuery = countQuery.gte('created_at', new Date(query.from).toISOString());
        listQuery = listQuery.gte('created_at', new Date(query.from).toISOString());
      }
      if (query.to) {
        countQuery = countQuery.lte('created_at', new Date(query.to).toISOString());
        listQuery = listQuery.lte('created_at', new Date(query.to).toISOString());
      }

      listQuery = listQuery
        .order('created_at', { ascending: false })
        .range(skip, skip + query.limit - 1);

      const [countResult, listResult] = await Promise.all([countQuery, listQuery]);

      if (countResult.error) throw countResult.error;
      if (listResult.error) throw listResult.error;

      const total = countResult.count ?? 0;

      // Resolve user emails in one batched query so the Audit tab can show
      // "alice@example.com" instead of a UUID slice. For failed login attempts
      // there's no user_id — fall back to the email recorded in after_value.
      const userIds = Array.from(
        new Set(
          (listResult.data ?? [])
            .map((r) => (r as Record<string, unknown>)['user_id'] as string | null)
            .filter((v): v is string => !!v),
        ),
      );
      const emailById = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profs } = await supabase
          .from('user_profiles')
          .select('id, email')
          .in('id', userIds);
        for (const p of profs ?? []) {
          emailById.set(p.id as string, p.email as string);
        }
      }

      // Reshape to the camelCase shape the AuditTab expects.
      const reshaped = (listResult.data ?? []).map((r) => {
        const row = r as Record<string, unknown>;
        const userId = (row['user_id'] as string | null) ?? null;
        const after = (row['after_value'] as Record<string, unknown> | null) ?? null;
        const userEmail =
          (userId ? emailById.get(userId) : null) ??
          ((after?.['email'] as string | undefined) ?? null);
        return {
          id: row['id'],
          userId,
          userEmail,
          action: row['action'],
          resourceType: row['resource_type'],
          resourceId: (row['resource_id'] as string | null) ?? null,
          result: row['result'],
          failureReason: (row['failure_reason'] as string | null) ?? null,
          ipAddress: (row['ip_address'] as string | null) ?? null,
          createdAt: row['created_at'],
        };
      });

      return reply.send({
        success: true,
        data: reshaped,
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
      const supabase = supabaseAdmin();

      const { data: roles, error } = await supabase
        .from('roles')
        .select(`
          *,
          role_permissions (
            *,
            permission:permissions ( * )
          )
        `)
        .eq('org_id', req.authUser.orgId)
        .order('display_name', { ascending: true });

      if (error) throw error;

      // Count users per role so the Roles tab can show "N users".
      const roleIds = (roles ?? []).map((r) => r.id as string);
      const userCounts = new Map<string, number>();
      if (roleIds.length > 0) {
        const { data: profs, error: profErr } = await supabase
          .from('user_profiles')
          .select('role_id')
          .in('role_id', roleIds)
          .eq('is_active', true);
        if (profErr) {
          app.log.warn({ err: profErr.message }, 'admin_roles.user_count_failed');
        } else {
          for (const p of profs ?? []) {
            const rid = (p as { role_id: string }).role_id;
            userCounts.set(rid, (userCounts.get(rid) ?? 0) + 1);
          }
        }
      }

      // Reshape: camelCase + the keys the frontend expects.
      const reshaped = (roles ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        displayName: r.display_name,
        rolePermissions: (r as { role_permissions?: unknown[] }).role_permissions ?? [],
        _count: { userProfiles: userCounts.get(r.id as string) ?? 0 },
      }));

      return reply.send({ success: true, data: reshaped });
    },
  );
}
