/**
 * Reports routes — upload, list, download signed URL, extraction review.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { supabaseAdmin } from '../../lib/supabase.js';
import { env } from '../../config/env.js';
import { PERMISSIONS, REPORT_STATUS } from '../../config/constants.js';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

export async function reportsRoutes(app: FastifyInstance) {
  const auth = [app.verifyAuth];

  // ─── POST /upload ─────────────────────────────────────────────────────────
  app.post(
    '/upload',
    {
      preHandler: [
        ...auth,
        app.requirePermission(PERMISSIONS.REPORTS_UPLOAD),
      ],
    },
    async (req, reply) => {
      const data = await req.file();
      if (!data) {
        return reply.code(400).send({
          success: false,
          error: { code: 'NO_FILE', message: 'No file attached.' },
        });
      }

      // Validate MIME type.
      if (!ALLOWED_MIME_TYPES.includes(data.mimetype)) {
        return reply.code(415).send({
          success: false,
          error: {
            code: 'INVALID_FILE_TYPE',
            message: 'Allowed types: PDF, Excel, CSV.',
          },
        });
      }

      const buffer = await data.toBuffer();

      // Validate file size.
      if (buffer.byteLength > MAX_FILE_SIZE) {
        return reply.code(413).send({
          success: false,
          error: { code: 'FILE_TOO_LARGE', message: 'Max file size is 50 MB.' },
        });
      }

      const { propertyId } = z.object({ propertyId: z.string().uuid() }).parse(req.query);

      const supabase = supabaseAdmin();

      // Verify property access.
      const { data: property, error: propError } = await supabase
        .from('properties')
        .select('*')
        .eq('id', propertyId)
        .eq('org_id', req.authUser.orgId)
        .limit(1)
        .maybeSingle();

      if (propError) throw propError;

      if (!property) {
        return reply.code(404).send({
          success: false,
          error: { code: 'PROPERTY_NOT_FOUND', message: 'Property not found.' },
        });
      }

      const checksum = createHash('sha256').update(buffer).digest('hex');
      const ext = data.filename.split('.').pop() ?? 'bin';
      const storagePath = `${req.authUser.orgId}/${propertyId}/${Date.now()}-${checksum.slice(0, 8)}.${ext}`;

      // Upload to private Supabase Storage bucket.
      const { error: uploadError } = await supabase.storage
        .from(env.STORAGE_BUCKET_REPORTS)
        .upload(storagePath, buffer, {
          contentType: data.mimetype,
          upsert: false,
        });

      if (uploadError) {
        app.log.error({ uploadError }, 'storage_upload_failed');
        return reply.code(500).send({
          success: false,
          error: { code: 'UPLOAD_FAILED', message: 'File upload failed.' },
        });
      }

      // Create report record.
      const { data: report, error: reportError } = await supabase
        .from('reports')
        .insert({
          org_id: req.authUser.orgId,
          property_id: propertyId,
          report_type: 'pending_detection',
          report_date: new Date().toISOString(),
          source: 'manual_upload',
          status: REPORT_STATUS.PENDING,
          uploaded_by: req.authUser.id,
        })
        .select()
        .single();

      if (reportError) throw reportError;

      // Create report file record.
      const { data: reportFile, error: fileError } = await supabase
        .from('report_files')
        .insert({
          report_id: report.id,
          storage_path: storagePath,
          original_name: data.filename,
          mime_type: data.mimetype,
          file_size_bytes: buffer.byteLength,
          checksum_sha256: checksum,
          uploaded_by: req.authUser.id,
        })
        .select()
        .single();

      if (fileError) throw fileError;

      await app.audit(req, {
        action: 'report.upload',
        resourceType: 'report',
        resourceId: report.id,
        afterValue: { propertyId, filename: data.filename, size: buffer.byteLength },
      });

      // Trigger async extraction via Supabase Edge Function.
      await supabase.functions.invoke('ingest-file', {
        body: { reportId: report.id, fileId: reportFile.id },
      });

      return reply.code(201).send({ success: true, data: { reportId: report.id } });
    },
  );

  // ─── GET / — list reports ─────────────────────────────────────────────────
  app.get('/', { preHandler: auth }, async (req, reply) => {
    const query = z
      .object({
        propertyId: z.string().uuid().optional(),
        reportType: z.string().optional(),
        status: z.string().optional(),
        page: z.coerce.number().default(1),
        limit: z.coerce.number().max(100).default(20),
      })
      .parse(req.query);

    const { authUser } = req;
    const skip = (query.page - 1) * query.limit;
    const supabase = supabaseAdmin();

    let countQuery = supabase
      .from('reports')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', authUser.orgId);

    let listQuery = supabase
      .from('reports')
      .select(`
        *,
        property:properties!property_id ( name, brand ),
        files:report_files ( original_name, mime_type )
      `)
      .eq('org_id', authUser.orgId);

    if (query.propertyId) {
      countQuery = countQuery.eq('property_id', query.propertyId);
      listQuery = listQuery.eq('property_id', query.propertyId);
    }
    if (query.reportType) {
      countQuery = countQuery.eq('report_type', query.reportType);
      listQuery = listQuery.eq('report_type', query.reportType);
    }
    if (query.status) {
      countQuery = countQuery.eq('status', query.status);
      listQuery = listQuery.eq('status', query.status);
    }
    if (authUser.propertyIds.length > 0) {
      countQuery = countQuery.in('property_id', authUser.propertyIds);
      listQuery = listQuery.in('property_id', authUser.propertyIds);
    }

    // Filter files to current only.
    listQuery = listQuery.eq('files.is_current', true);

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
  });

  // ─── GET /:id/download — signed URL ───────────────────────────────────────
  app.get(
    '/:id/download',
    {
      preHandler: [
        ...auth,
        app.requirePermission(PERMISSIONS.REPORTS_DOWNLOAD),
      ],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const supabase = supabaseAdmin();

      const { data: report, error: findError } = await supabase
        .from('reports')
        .select(`
          *,
          files:report_files ( * )
        `)
        .eq('id', id)
        .eq('org_id', req.authUser.orgId)
        .eq('files.is_current', true)
        .limit(1)
        .maybeSingle();

      if (findError) throw findError;

      if (!report) {
        return reply.code(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Report not found.' },
        });
      }

      if (
        req.authUser.propertyIds.length > 0 &&
        !req.authUser.propertyIds.includes(report.property_id)
      ) {
        return reply.code(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Access denied to this report.' },
        });
      }

      const file = report.files?.[0];
      if (!file) {
        return reply.code(404).send({
          success: false,
          error: { code: 'NO_FILE', message: 'No file attached to this report.' },
        });
      }

      const { data: signedData, error } = await supabase.storage
        .from(env.STORAGE_BUCKET_REPORTS)
        .createSignedUrl(file.storage_path, env.SIGNED_URL_EXPIRY_SECONDS);

      if (error || !signedData) {
        return reply.code(500).send({
          success: false,
          error: { code: 'SIGNED_URL_FAILED', message: 'Could not generate download link.' },
        });
      }

      await app.audit(req, {
        action: 'report.download',
        resourceType: 'report',
        resourceId: id,
      });

      return reply.send({
        success: true,
        data: { url: signedData.signedUrl, expiresIn: env.SIGNED_URL_EXPIRY_SECONDS },
      });
    },
  );

  // ─── PATCH /:id/review — approve or reject extracted data ─────────────────
  app.patch(
    '/:id/review',
    {
      preHandler: [
        ...auth,
        app.requirePermission(PERMISSIONS.REPORTS_REVIEW),
      ],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z
        .object({
          action: z.enum(['approve', 'reject']),
          notes: z.string().optional(),
          reportDate: z.string().optional(),
          reportType: z.string().optional(),
        })
        .parse(req.body);

      const supabase = supabaseAdmin();

      const { data: report, error: findError } = await supabase
        .from('reports')
        .select('*')
        .eq('id', id)
        .eq('org_id', req.authUser.orgId)
        .limit(1)
        .maybeSingle();

      if (findError) throw findError;

      if (!report) {
        return reply.code(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Report not found.' },
        });
      }

      const { data: updated, error: updateError } = await supabase
        .from('reports')
        .update({
          status: body.action === 'approve' ? REPORT_STATUS.APPROVED : REPORT_STATUS.FAILED,
          reviewed_by: req.authUser.id,
          reviewed_at: new Date().toISOString(),
          review_notes: body.notes ?? null,
          requires_review: false,
          ...(body.reportDate && { report_date: new Date(body.reportDate).toISOString() }),
          ...(body.reportType && { report_type: body.reportType }),
        })
        .eq('id', id)
        .select()
        .single();

      if (updateError) throw updateError;

      await app.audit(req, {
        action: `report.review.${body.action}`,
        resourceType: 'report',
        resourceId: id,
        beforeValue: { status: report.status },
        afterValue: { status: updated.status, notes: body.notes },
      });

      return reply.send({ success: true, data: updated });
    },
  );

  // ─── GET /search — full-text + filter search ──────────────────────────────
  // NOTE: must be registered before GET /:id to avoid "search" being captured as an id.
  app.get('/search', { preHandler: auth }, async (req, reply) => {
    const query = z
      .object({
        q:          z.string().optional(),
        propertyId: z.string().uuid().optional(),
        reportType: z.string().optional(),
        status:     z.string().optional(),
        dateFrom:   z.string().optional(),
        dateTo:     z.string().optional(),
        page:       z.coerce.number().default(1),
        limit:      z.coerce.number().max(100).default(60),
      })
      .parse(req.query);

    const { authUser } = req;
    const skip = (query.page - 1) * query.limit;
    const supabase = supabaseAdmin();

    let countQuery = supabase
      .from('reports')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', authUser.orgId);

    let listQuery = supabase
      .from('reports')
      .select(`
        *,
        property:properties!property_id ( name, brand ),
        files:report_files ( original_name, mime_type, file_size_bytes )
      `)
      .eq('org_id', authUser.orgId);

    if (query.propertyId) {
      countQuery = countQuery.eq('property_id', query.propertyId);
      listQuery = listQuery.eq('property_id', query.propertyId);
    }
    if (query.reportType) {
      countQuery = countQuery.eq('report_type', query.reportType);
      listQuery = listQuery.eq('report_type', query.reportType);
    }
    if (query.status) {
      countQuery = countQuery.eq('status', query.status);
      listQuery = listQuery.eq('status', query.status);
    }
    if (query.dateFrom) {
      countQuery = countQuery.gte('report_date', new Date(query.dateFrom).toISOString());
      listQuery = listQuery.gte('report_date', new Date(query.dateFrom).toISOString());
    }
    if (query.dateTo) {
      countQuery = countQuery.lte('report_date', new Date(query.dateTo).toISOString());
      listQuery = listQuery.lte('report_date', new Date(query.dateTo).toISOString());
    }
    if (authUser.propertyIds.length > 0) {
      countQuery = countQuery.in('property_id', authUser.propertyIds);
      listQuery = listQuery.in('property_id', authUser.propertyIds);
    }

    // Filter files to current only.
    listQuery = listQuery.eq('files.is_current', true);

    // Text search on file original_name via ilike.
    // The count query uses an inner join to report_files so the filter works.
    if (query.q) {
      // Escape LIKE metacharacters to prevent wildcard injection.
      const escapedQ = query.q.replace(/[%_\\]/g, '\\$&');

      countQuery = supabase
        .from('reports')
        .select('*, report_files!inner(original_name)', { count: 'exact', head: true })
        .eq('org_id', authUser.orgId);
      if (query.propertyId) countQuery = countQuery.eq('property_id', query.propertyId);
      if (query.reportType) countQuery = countQuery.eq('report_type', query.reportType);
      if (query.status) countQuery = countQuery.eq('status', query.status);
      if (query.dateFrom) countQuery = countQuery.gte('report_date', new Date(query.dateFrom).toISOString());
      if (query.dateTo) countQuery = countQuery.lte('report_date', new Date(query.dateTo).toISOString());
      if (authUser.propertyIds.length > 0) countQuery = countQuery.in('property_id', authUser.propertyIds);
      countQuery = countQuery.ilike('report_files.original_name', `%${escapedQ}%`);
      listQuery = listQuery.ilike('files.original_name', `%${escapedQ}%`);
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
  });

  // ─── GET /:id — single report with full extracted data ────────────────────
  app.get('/:id', { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const supabase = supabaseAdmin();

    const { data: report, error } = await supabase
      .from('reports')
      .select(`
        *,
        property:properties!property_id ( name, brand ),
        files:report_files ( * ),
        uploader:user_profiles!uploaded_by ( full_name ),
        reviewer:user_profiles!reviewed_by ( full_name )
      `)
      .eq('id', id)
      .eq('org_id', req.authUser.orgId)
      .eq('files.is_current', true)
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!report) {
      return reply.code(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Report not found.' },
      });
    }

    if (
      req.authUser.propertyIds.length > 0 &&
      !req.authUser.propertyIds.includes(report.property_id)
    ) {
      return reply.code(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied.' },
      });
    }

    // Fetch related metrics and extraction jobs separately.
    const [dailyResult, financialResult, extractionResult] = await Promise.all([
      supabase
        .from('daily_metrics')
        .select('*')
        .eq('report_id', id)
        .order('metric_date', { ascending: false })
        .limit(1),
      supabase
        .from('financial_metrics')
        .select('*')
        .eq('report_id', id)
        .order('metric_date', { ascending: false })
        .limit(1),
      supabase
        .from('extraction_jobs')
        .select('*')
        .eq('report_id', id)
        .order('created_at', { ascending: false })
        .limit(1),
    ]);

    const data = {
      ...report,
      dailyMetrics: dailyResult.data ?? [],
      financialMetrics: financialResult.data ?? [],
      extractionJobs: extractionResult.data ?? [],
    };

    return reply.send({ success: true, data });
  });

  // ─── POST /:id/reclassify — change document type ──────────────────────────
  app.post(
    '/:id/reclassify',
    {
      preHandler: [
        ...auth,
        app.requirePermission(PERMISSIONS.REPORTS_REVIEW),
      ],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z
        .object({ reportType: z.string().min(1), reportDate: z.string().optional() })
        .parse(req.body);

      const supabase = supabaseAdmin();

      const { data: report, error: findError } = await supabase
        .from('reports')
        .select('*')
        .eq('id', id)
        .eq('org_id', req.authUser.orgId)
        .limit(1)
        .maybeSingle();

      if (findError) throw findError;

      if (!report) {
        return reply.code(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Report not found.' },
        });
      }

      const { data: updated, error: updateError } = await supabase
        .from('reports')
        .update({
          report_type: body.reportType,
          ...(body.reportDate && { report_date: new Date(body.reportDate).toISOString() }),
          requires_review: false,
        })
        .eq('id', id)
        .select()
        .single();

      if (updateError) throw updateError;

      await app.audit(req, {
        action: 'report.reclassify',
        resourceType: 'report',
        resourceId: id,
        beforeValue: { reportType: report.report_type },
        afterValue: { reportType: body.reportType },
      });

      return reply.send({ success: true, data: updated });
    },
  );
}
