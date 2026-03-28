/**
 * Batch routes — ZIP upload, batch status, item review, and batch approval.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { env } from '../../config/env.js';
import { PERMISSIONS } from '../../config/constants.js';
import { processZipUpload, processApprovedItems } from '../../services/zip-ingestion.service.js';

const MAX_ZIP_SIZE = 500 * 1024 * 1024; // 500 MB

function getAdminSupabase() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function batchesRoutes(app: FastifyInstance) {
  const auth = [app.verifyAuth];

  // ─── POST /upload-zip — upload and process a ZIP file ───────────────────────
  app.post(
    '/upload-zip',
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
      const zipMimeTypes = [
        'application/zip',
        'application/x-zip-compressed',
        'application/x-zip',
        'multipart/x-zip',
      ];
      if (!zipMimeTypes.includes(data.mimetype) && !data.filename.toLowerCase().endsWith('.zip')) {
        return reply.code(415).send({
          success: false,
          error: { code: 'INVALID_FILE_TYPE', message: 'Only ZIP files are accepted.' },
        });
      }

      const buffer = await data.toBuffer();

      if (buffer.byteLength > MAX_ZIP_SIZE) {
        return reply.code(413).send({
          success: false,
          error: { code: 'FILE_TOO_LARGE', message: 'Max ZIP size is 500 MB.' },
        });
      }

      try {
        const result = await processZipUpload(
          buffer,
          data.filename,
          req.authUser.orgId,
          req.authUser.id,
        );

        await app.audit(req, {
          action: 'batch.upload_zip',
          resourceType: 'zip_batch',
          resourceId: result.batchId,
          afterValue: {
            filename: data.filename,
            size: buffer.byteLength,
            totalFiles: result.totalFiles,
            totalFolders: result.totalFolders,
            classifiedCount: result.classifiedCount,
            needsReviewCount: result.needsReviewCount,
            duplicateCount: result.duplicateCount,
          },
        });

        return reply.code(201).send({
          success: true,
          data: {
            batchId: result.batchId,
            totalFiles: result.totalFiles,
            totalFolders: result.totalFolders,
            classifiedCount: result.classifiedCount,
            needsReviewCount: result.needsReviewCount,
            notClassifiedCount: result.notClassifiedCount,
            duplicateCount: result.duplicateCount,
            folderGroups: result.folderGroups.map((fg) => ({
              folderName: fg.folderName,
              property: fg.property,
              itemCount: fg.items.length,
              items: fg.items.map((item) => ({
                filename: item.file.filename,
                extension: item.file.extension,
                fileSizeBytes: item.file.fileSizeBytes,
                folderName: item.file.folderName,
                property: item.property,
                reportType: item.reportType,
                detectedDate: item.detectedDate,
                overallConfidence: item.overallConfidence,
                isDuplicate: item.isDuplicate,
                status: item.status,
              })),
            })),
          },
        });
      } catch (err) {
        app.log.error({ err }, 'zip_upload_processing_failed');
        return reply.code(500).send({
          success: false,
          error: { code: 'PROCESSING_FAILED', message: 'ZIP processing failed.' },
        });
      }
    },
  );

  // ─── GET / — list batches ────────────────────────────────────────────────────
  app.get('/', { preHandler: auth }, async (req, reply) => {
    const query = z
      .object({
        status: z.string().optional(),
        page: z.coerce.number().default(1),
        limit: z.coerce.number().max(50).default(20),
      })
      .parse(req.query);

    const supabase = getAdminSupabase();
    const offset = (query.page - 1) * query.limit;

    let dbQuery = supabase
      .from('zip_batches')
      .select('*', { count: 'exact' })
      .eq('org_id', req.authUser.orgId)
      .order('created_at', { ascending: false })
      .range(offset, offset + query.limit - 1);

    if (query.status) {
      dbQuery = dbQuery.eq('status', query.status);
    }

    const { data: batches, count, error } = await dbQuery;

    if (error) {
      return reply.code(500).send({
        success: false,
        error: { code: 'QUERY_FAILED', message: 'Failed to fetch batches.' },
      });
    }

    return reply.send({
      success: true,
      data: batches ?? [],
      total: count ?? 0,
      page: query.page,
      limit: query.limit,
    });
  });

  // ─── GET /:batchId — batch detail with items ────────────────────────────────
  app.get('/:batchId', { preHandler: auth }, async (req, reply) => {
    const { batchId } = req.params as { batchId: string };
    const supabase = getAdminSupabase();

    const [batchResult, itemsResult] = await Promise.all([
      supabase
        .from('zip_batches')
        .select('*')
        .eq('id', batchId)
        .eq('org_id', req.authUser.orgId)
        .single(),
      supabase
        .from('zip_batch_items')
        .select('*')
        .eq('batch_id', batchId)
        .order('folder_name', { ascending: true })
        .order('original_filename', { ascending: true }),
    ]);

    if (batchResult.error || !batchResult.data) {
      return reply.code(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Batch not found.' },
      });
    }

    // Group items by folder for the frontend.
    const items = itemsResult.data ?? [];
    const folderGroups: Record<string, typeof items> = {};
    for (const item of items) {
      const folder = item.folder_name ?? '_root';
      if (!folderGroups[folder]) folderGroups[folder] = [];
      folderGroups[folder]!.push(item);
    }

    return reply.send({
      success: true,
      data: {
        batch: batchResult.data,
        items,
        folderGroups,
      },
    });
  });

  // ─── PATCH /:batchId/items/:itemId — review a single item ──────────────────
  app.patch(
    '/:batchId/items/:itemId',
    {
      preHandler: [
        ...auth,
        app.requirePermission(PERMISSIONS.REPORTS_REVIEW),
      ],
    },
    async (req, reply) => {
      const { batchId, itemId } = req.params as { batchId: string; itemId: string };
      const body = z
        .object({
          action: z.enum(['approve', 'skip', 'update']),
          propertyId: z.string().uuid().optional(),
          propertyName: z.string().optional(),
          reportTypeSlug: z.string().optional(),
          reportTypeName: z.string().optional(),
          detectedDate: z.string().optional(),
          notes: z.string().optional(),
        })
        .parse(req.body);

      const supabase = getAdminSupabase();

      // Verify item belongs to batch and org.
      const { data: item } = await supabase
        .from('zip_batch_items')
        .select('*')
        .eq('id', itemId)
        .eq('batch_id', batchId)
        .eq('org_id', req.authUser.orgId)
        .single();

      if (!item) {
        return reply.code(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Item not found.' },
        });
      }

      const updateData: Record<string, unknown> = {
        reviewed_by: req.authUser.id,
        reviewed_at: new Date().toISOString(),
        review_notes: body.notes ?? null,
        updated_at: new Date().toISOString(),
      };

      if (body.action === 'approve') {
        updateData.status = 'approved';
      } else if (body.action === 'skip') {
        updateData.status = 'skipped';
      } else if (body.action === 'update') {
        updateData.status = 'approved';
      }

      // Override detected values if provided.
      if (body.propertyId) {
        updateData.detected_property_id = body.propertyId;
        updateData.property_confidence = 1.0;
        updateData.property_source = 'manual';
      }
      if (body.propertyName) updateData.detected_property_name = body.propertyName;
      if (body.reportTypeSlug) updateData.report_type_slug = body.reportTypeSlug;
      if (body.reportTypeName) updateData.detected_report_type = body.reportTypeName;
      if (body.detectedDate) updateData.detected_date = body.detectedDate;

      await supabase.from('zip_batch_items').update(updateData).eq('id', itemId);

      // Recalculate batch review counts.
      const { data: remainingReview } = await supabase
        .from('zip_batch_items')
        .select('id')
        .eq('batch_id', batchId)
        .eq('status', 'needs_review');

      const { data: remainingUnclassified } = await supabase
        .from('zip_batch_items')
        .select('id')
        .eq('batch_id', batchId)
        .eq('status', 'not_classified');

      await supabase.from('zip_batches').update({
        needs_review_count: remainingReview?.length ?? 0,
        not_classified_count: remainingUnclassified?.length ?? 0,
      }).eq('id', batchId);

      await app.audit(req, {
        action: `batch.item.${body.action}`,
        resourceType: 'zip_batch_item',
        resourceId: itemId,
        afterValue: updateData,
      });

      return reply.send({ success: true });
    },
  );

  // ─── POST /:batchId/process — process all approved/classified items ─────────
  app.post(
    '/:batchId/process',
    {
      preHandler: [
        ...auth,
        app.requirePermission(PERMISSIONS.REPORTS_UPLOAD),
      ],
    },
    async (req, reply) => {
      const { batchId } = req.params as { batchId: string };
      const body = z
        .object({
          itemIds: z.array(z.string().uuid()).optional(),
        })
        .parse(req.body ?? {});

      try {
        const result = await processApprovedItems(batchId, req.authUser.orgId, body.itemIds);

        await app.audit(req, {
          action: 'batch.process',
          resourceType: 'zip_batch',
          resourceId: batchId,
          afterValue: result,
        });

        return reply.send({ success: true, data: result });
      } catch (err) {
        app.log.error({ err }, 'batch_processing_failed');
        return reply.code(500).send({
          success: false,
          error: { code: 'PROCESSING_FAILED', message: 'Batch processing failed.' },
        });
      }
    },
  );

  // ─── POST /:batchId/approve-all — approve all items and process ─────────────
  app.post(
    '/:batchId/approve-all',
    {
      preHandler: [
        ...auth,
        app.requirePermission(PERMISSIONS.REPORTS_REVIEW),
      ],
    },
    async (req, reply) => {
      const { batchId } = req.params as { batchId: string };
      const supabase = getAdminSupabase();

      // Approve all needs_review and not_classified items.
      await supabase
        .from('zip_batch_items')
        .update({
          status: 'approved',
          reviewed_by: req.authUser.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('batch_id', batchId)
        .in('status', ['needs_review', 'not_classified']);

      // Process all approved + classified items.
      const result = await processApprovedItems(batchId, req.authUser.orgId);

      await app.audit(req, {
        action: 'batch.approve_all',
        resourceType: 'zip_batch',
        resourceId: batchId,
        afterValue: result,
      });

      return reply.send({ success: true, data: result });
    },
  );
}
