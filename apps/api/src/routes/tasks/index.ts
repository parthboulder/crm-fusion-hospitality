/**
 * Tasks routes — CRUD, assignment, status transitions, comments.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabaseAdmin } from '../../lib/supabase.js';
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
    const supabase = supabaseAdmin();

    // Count query.
    let countQuery = supabase
      .from('tasks')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', authUser.orgId);

    // List query with joins.
    let listQuery = supabase
      .from('tasks')
      .select(`
        *,
        property:properties!property_id ( name ),
        assignee:user_profiles!assigned_to ( full_name, avatar_url ),
        alert:alerts!alert_id ( alert_type, severity )
      `)
      .eq('org_id', authUser.orgId);

    if (query.propertyId) {
      countQuery = countQuery.eq('property_id', query.propertyId);
      listQuery = listQuery.eq('property_id', query.propertyId);
    }
    if (query.status) {
      countQuery = countQuery.eq('status', query.status);
      listQuery = listQuery.eq('status', query.status);
    }
    if (query.priority) {
      countQuery = countQuery.eq('priority', query.priority);
      listQuery = listQuery.eq('priority', query.priority);
    }
    if (query.assignedTo) {
      countQuery = countQuery.eq('assigned_to', query.assignedTo);
      listQuery = listQuery.eq('assigned_to', query.assignedTo);
    }
    if (authUser.propertyIds.length > 0) {
      countQuery = countQuery.in('property_id', authUser.propertyIds);
      listQuery = listQuery.in('property_id', authUser.propertyIds);
    }

    listQuery = listQuery
      .order('priority', { ascending: true })
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
  });

  // ─── POST / — create task ─────────────────────────────────────────────────
  app.post(
    '/',
    { preHandler: [...auth, app.requirePermission(PERMISSIONS.TASKS_CREATE)] },
    async (req, reply) => {
      const body = taskBodySchema.parse(req.body);
      const supabase = supabaseAdmin();

      const { data: task, error } = await supabase
        .from('tasks')
        .insert({
          org_id: req.authUser.orgId,
          property_id: body.propertyId,
          alert_id: body.alertId ?? null,
          title: body.title,
          description: body.description ?? null,
          task_type: body.taskType,
          priority: body.priority,
          assigned_to: body.assignedTo ?? null,
          ...(body.assignedTo ? { assigned_by: req.authUser.id } : {}),
          ...(body.dueDate ? { due_date: new Date(body.dueDate).toISOString() } : {}),
        })
        .select()
        .single();

      if (error) throw error;

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

      const supabase = supabaseAdmin();

      const { data: before, error: findError } = await supabase
        .from('tasks')
        .select('*')
        .eq('id', id)
        .eq('org_id', req.authUser.orgId)
        .limit(1)
        .maybeSingle();

      if (findError) throw findError;

      if (!before) {
        return reply.code(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Task not found.' },
        });
      }

      // Build the snake_case update payload.
      const updateData: Record<string, unknown> = {};
      if (body.status !== undefined) updateData.status = body.status;
      if (body.priority !== undefined) updateData.priority = body.priority;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.assignedTo !== undefined) {
        updateData.assigned_to = body.assignedTo;
        updateData.assigned_by = req.authUser.id;
      }
      if (body.dueDate !== undefined) {
        updateData.due_date = body.dueDate === null ? null : new Date(body.dueDate).toISOString();
      }
      if (body.status === 'completed') {
        updateData.completed_at = new Date().toISOString();
      }

      const { data: updated, error: updateError } = await supabase
        .from('tasks')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (updateError) throw updateError;

      await app.audit(req, {
        action: 'task.update',
        resourceType: 'task',
        resourceId: id,
        beforeValue: { status: before.status, assigned_to: before.assigned_to },
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

      const supabase = supabaseAdmin();

      const { data: task, error: findError } = await supabase
        .from('tasks')
        .select('id')
        .eq('id', id)
        .eq('org_id', req.authUser.orgId)
        .limit(1)
        .maybeSingle();

      if (findError) throw findError;

      if (!task) {
        return reply.code(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Task not found.' },
        });
      }

      const { data: comment, error: insertError } = await supabase
        .from('task_comments')
        .insert({
          task_id: id,
          author_id: req.authUser.id,
          body: commentBody,
        })
        .select(`
          *,
          author:user_profiles!author_id ( full_name, avatar_url )
        `)
        .single();

      if (insertError) throw insertError;

      return reply.code(201).send({ success: true, data: comment });
    },
  );

  // ─── GET /:id/comments ────────────────────────────────────────────────────
  app.get('/:id/comments', { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const supabase = supabaseAdmin();

    const { data: comments, error } = await supabase
      .from('task_comments')
      .select(`
        *,
        author:user_profiles!author_id ( full_name, avatar_url )
      `)
      .eq('task_id', id)
      .order('created_at', { ascending: true });

    if (error) throw error;

    return reply.send({ success: true, data: comments });
  });
}
