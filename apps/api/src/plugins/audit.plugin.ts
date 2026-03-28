/**
 * Audit plugin — structured audit logging to the DB on every mutating request.
 * Attaches app.audit() helper for manual audit entries.
 */

import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db } from '@fusion/db';

export interface AuditEntry {
  action: string;
  resourceType: string;
  resourceId?: string;
  beforeValue?: unknown;
  afterValue?: unknown;
  result?: 'success' | 'failure';
  failureReason?: string;
}

export const auditPlugin = fp(async (app: FastifyInstance) => {
  app.decorate(
    'audit',
    async (req: FastifyRequest, entry: AuditEntry): Promise<void> => {
      const user = req.authUser;
      await db.auditLog
        .create({
          data: {
            orgId: user?.orgId ?? null,
            userId: user?.id ?? null,
            sessionId: user?.sessionId ?? null,
            action: entry.action,
            resourceType: entry.resourceType,
            resourceId: entry.resourceId ?? null,
            beforeValue: entry.beforeValue ? (entry.beforeValue as object) : null,
            afterValue: entry.afterValue ? (entry.afterValue as object) : null,
            ipAddress: req.ip ?? null,
            userAgent: req.headers['user-agent'] ?? null,
            requestId: req.id,
            result: entry.result ?? 'success',
            failureReason: entry.failureReason ?? null,
          },
        })
        .catch((err: unknown) => {
          // Audit failures must never block the request — log only.
          app.log.error({ err }, 'audit_log_write_failed');
        });
    },
  );
});

declare module 'fastify' {
  interface FastifyInstance {
    audit: (req: FastifyRequest, entry: AuditEntry) => Promise<void>;
  }
}
