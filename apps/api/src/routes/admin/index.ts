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

      return reply.send({
        success: true,
        data: listResult.data,
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

      return reply.send({ success: true, data: roles });
    },
  );
}
