/**
 * Reports routes — upload, list, download signed URL, extraction review.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { db } from '@fusion/db';
import { env } from '../../config/env.js';
import { PERMISSIONS, REPORT_STATUS } from '../../config/constants.js';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

function getAdminSupabase() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

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

      // Verify property access.
      const property = await db.property.findFirst({
        where: { id: propertyId, orgId: req.authUser.orgId },
      });
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
      const supabase = getAdminSupabase();
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

      // Create report + file records.
      const report = await db.report.create({
        data: {
          orgId: req.authUser.orgId,
          propertyId,
          reportType: 'pending_detection', // AI will classify
          reportDate: new Date(),
          source: 'manual_upload',
          status: REPORT_STATUS.PENDING,
          uploadedBy: req.authUser.id,
          files: {
            create: {
              storagePath,
              originalName: data.filename,
              mimeType: data.mimetype,
              fileSizeBytes: BigInt(buffer.byteLength),
              checksumSha256: checksum,
              uploadedBy: req.authUser.id,
            },
          },
        },
        include: { files: true },
      });

      await app.audit(req, {
        action: 'report.upload',
        resourceType: 'report',
        resourceId: report.id,
        afterValue: { propertyId, filename: data.filename, size: buffer.byteLength },
      });

      // Trigger async extraction via Supabase Edge Function.
      await supabase.functions.invoke('ingest-file', {
        body: { reportId: report.id, fileId: report.files[0]!.id },
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

    const where = {
      orgId: authUser.orgId,
      ...(query.propertyId && { propertyId: query.propertyId }),
      ...(query.reportType && { reportType: query.reportType }),
      ...(query.status && { status: query.status }),
      ...(authUser.propertyIds.length > 0 && {
        propertyId: { in: authUser.propertyIds },
      }),
    };

    const [total, reports] = await Promise.all([
      db.report.count({ where }),
      db.report.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          property: { select: { name: true, brand: true } },
          files: { where: { isCurrent: true }, select: { originalName: true, mimeType: true } },
          _count: { select: { alerts: true } },
        },
      }),
    ]);

    return reply.send({
      success: true,
      data: reports,
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

      const report = await db.report.findFirst({
        where: { id, orgId: req.authUser.orgId },
        include: { files: { where: { isCurrent: true } } },
      });

      if (!report) {
        return reply.code(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Report not found.' },
        });
      }

      if (
        req.authUser.propertyIds.length > 0 &&
        !req.authUser.propertyIds.includes(report.propertyId)
      ) {
        return reply.code(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Access denied to this report.' },
        });
      }

      const file = report.files[0];
      if (!file) {
        return reply.code(404).send({
          success: false,
          error: { code: 'NO_FILE', message: 'No file attached to this report.' },
        });
      }

      const supabase = getAdminSupabase();
      const { data: signedData, error } = await supabase.storage
        .from(env.STORAGE_BUCKET_REPORTS)
        .createSignedUrl(file.storagePath, env.SIGNED_URL_EXPIRY_SECONDS);

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

      const report = await db.report.findFirst({
        where: { id, orgId: req.authUser.orgId },
      });

      if (!report) {
        return reply.code(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Report not found.' },
        });
      }

      const updated = await db.report.update({
        where: { id },
        data: {
          status: body.action === 'approve' ? REPORT_STATUS.APPROVED : REPORT_STATUS.FAILED,
          reviewedBy: req.authUser.id,
          reviewedAt: new Date(),
          reviewNotes: body.notes ?? null,
          requiresReview: false,
          ...(body.reportDate && { reportDate: new Date(body.reportDate) }),
          ...(body.reportType && { reportType: body.reportType }),
        },
      });

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

    const where = {
      orgId: authUser.orgId,
      ...(query.propertyId && { propertyId: query.propertyId }),
      ...(query.reportType && { reportType: query.reportType }),
      ...(query.status     && { status: query.status }),
      ...((query.dateFrom || query.dateTo) && {
        reportDate: {
          ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
          ...(query.dateTo   && { lte: new Date(query.dateTo) }),
        },
      }),
      ...(query.q && {
        files: { some: { originalName: { contains: query.q, mode: 'insensitive' as const } } },
      }),
      ...(authUser.propertyIds.length > 0 && { propertyId: { in: authUser.propertyIds } }),
    };

    const [total, reports] = await Promise.all([
      db.report.count({ where }),
      db.report.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          property: { select: { name: true, brand: true } },
          files: {
            where: { isCurrent: true },
            select: { originalName: true, mimeType: true, fileSizeBytes: true },
          },
          _count: { select: { alerts: true } },
        },
      }),
    ]);

    // Serialize BigInt fileSizeBytes to Number for JSON transport.
    const serialized = reports.map((r) => ({
      ...r,
      files: r.files.map((f) => ({ ...f, fileSizeBytes: Number(f.fileSizeBytes) })),
    }));

    return reply.send({
      success: true,
      data: serialized,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    });
  });

  // ─── GET /:id — single report with full extracted data ────────────────────
  app.get('/:id', { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const report = await db.report.findFirst({
      where: { id, orgId: req.authUser.orgId },
      include: {
        property:          { select: { name: true, brand: true } },
        files:             { where: { isCurrent: true } },
        extractionJobs:    { orderBy: { createdAt: 'desc' }, take: 1 },
        dailyMetrics:      { orderBy: { metricDate: 'desc' }, take: 1 },
        financialMetrics:  { orderBy: { metricDate: 'desc' }, take: 1 },
        uploader:          { select: { fullName: true } },
        reviewer:          { select: { fullName: true } },
        _count:            { select: { alerts: true } },
      },
    });

    if (!report) {
      return reply.code(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Report not found.' },
      });
    }

    if (
      req.authUser.propertyIds.length > 0 &&
      !req.authUser.propertyIds.includes(report.propertyId)
    ) {
      return reply.code(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied.' },
      });
    }

    // Serialize BigInt fileSizeBytes on file records.
    const data = {
      ...report,
      files: report.files.map((f) => ({ ...f, fileSizeBytes: Number(f.fileSizeBytes) })),
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

      const report = await db.report.findFirst({
        where: { id, orgId: req.authUser.orgId },
      });

      if (!report) {
        return reply.code(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Report not found.' },
        });
      }

      const updated = await db.report.update({
        where: { id },
        data: {
          reportType: body.reportType,
          ...(body.reportDate && { reportDate: new Date(body.reportDate) }),
          requiresReview: false,
        },
      });

      await app.audit(req, {
        action: 'report.reclassify',
        resourceType: 'report',
        resourceId: id,
        beforeValue: { reportType: report.reportType },
        afterValue: { reportType: body.reportType },
      });

      return reply.send({ success: true, data: updated });
    },
  );
}
