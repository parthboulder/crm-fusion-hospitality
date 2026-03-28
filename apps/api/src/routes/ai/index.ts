/**
 * AI routes — on-demand summaries and portfolio insights.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '@fusion/db';
import { PERMISSIONS } from '../../config/constants.js';
import { AiService } from '../../services/ai.service.js';

export async function aiRoutes(app: FastifyInstance) {
  const auth = [app.verifyAuth, app.requirePermission(PERMISSIONS.AI_SUMMARIES)];
  const aiService = new AiService();

  // ─── POST /property/:id/summary ───────────────────────────────────────────
  app.post('/property/:id/summary', { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { period } = z
      .object({ period: z.enum(['daily', 'weekly', 'monthly']).default('daily') })
      .parse(req.body ?? {});

    const property = await db.property.findFirst({
      where: { id, orgId: req.authUser.orgId },
    });

    if (!property) {
      return reply.code(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Property not found.' },
      });
    }

    // Check cache — return if generated in last hour.
    const cached = await db.aiSummary.findFirst({
      where: {
        scope: 'property',
        scopeId: id,
        summaryType: period,
        validUntil: { gt: new Date() },
      },
      orderBy: { generatedAt: 'desc' },
    });

    if (cached) {
      return reply.send({ success: true, data: cached, cached: true });
    }

    const summary = await aiService.generatePropertySummary(id, req.authUser.orgId, period);

    const validUntil = new Date();
    validUntil.setHours(validUntil.getHours() + 1);

    const saved = await db.aiSummary.create({
      data: {
        orgId: req.authUser.orgId,
        scope: 'property',
        scopeId: id,
        summaryType: period,
        content: summary.content,
        modelUsed: summary.model,
        tokensUsed: summary.tokensUsed,
        validUntil,
        metadata: { period },
      },
    });

    await app.audit(req, {
      action: 'ai.summary.generate',
      resourceType: 'property',
      resourceId: id,
      afterValue: { type: period, tokensUsed: summary.tokensUsed },
    });

    return reply.send({ success: true, data: saved, cached: false });
  });

  // ─── POST /portfolio/insights ─────────────────────────────────────────────
  app.post('/portfolio/insights', { preHandler: auth }, async (req, reply) => {
    const { authUser } = req;

    const cached = await db.aiSummary.findFirst({
      where: {
        orgId: authUser.orgId,
        scope: 'portfolio',
        summaryType: 'insights',
        validUntil: { gt: new Date() },
      },
      orderBy: { generatedAt: 'desc' },
    });

    if (cached) {
      return reply.send({ success: true, data: cached, cached: true });
    }

    const insights = await aiService.generatePortfolioInsights(authUser.orgId, authUser.propertyIds);

    const validUntil = new Date();
    validUntil.setHours(validUntil.getHours() + 2);

    const saved = await db.aiSummary.create({
      data: {
        orgId: authUser.orgId,
        scope: 'portfolio',
        scopeId: authUser.orgId,
        summaryType: 'insights',
        content: insights.content,
        modelUsed: insights.model,
        tokensUsed: insights.tokensUsed,
        validUntil,
      },
    });

    return reply.send({ success: true, data: saved, cached: false });
  });

  // ─── POST /report/:id/root-cause ──────────────────────────────────────────
  app.post('/report/:id/root-cause', { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const report = await db.report.findFirst({
      where: { id, orgId: req.authUser.orgId },
      include: {
        property: true,
        dailyMetrics: { take: 1 },
        financialMetrics: { take: 1 },
        alerts: true,
      },
    });

    if (!report) {
      return reply.code(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Report not found.' },
      });
    }

    const analysis = await aiService.generateRootCauseAnalysis(report);

    return reply.send({ success: true, data: { analysis } });
  });
}
