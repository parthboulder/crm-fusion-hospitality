/**
 * Audit plugin — structured audit logging to the DB on every mutating request.
 * Attaches app.audit() helper for manual audit entries.
 */

import fp from 'fastify-plugin';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { supabaseAdmin } from '../lib/supabase.js';

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
      const supabase = supabaseAdmin();
      const user = req.authUser;

      const { error } = await supabase
        .from('audit_logs')
        .insert({
          org_id: user?.orgId ?? null,
          user_id: user?.id ?? null,
          session_id: user?.sessionId ?? null,
          action: entry.action,
          resource_type: entry.resourceType,
          resource_id: entry.resourceId ?? null,
          before_value: entry.beforeValue ? (entry.beforeValue as object) : null,
          after_value: entry.afterValue ? (entry.afterValue as object) : null,
          ip_address: req.ip ?? null,
          user_agent: req.headers['user-agent'] ?? null,
          request_id: req.id,
          result: entry.result ?? 'success',
          failure_reason: entry.failureReason ?? null,
        });

      if (error) {
        // Audit failures must never block the request — log and write to fallback file.
        app.log.error({ err: error }, 'audit_log_write_failed');

        // Fallback: append to local audit log file so security events are never lost.
        try {
          const fallbackPath = path.resolve(process.cwd(), 'audit-fallback.jsonl');
          const fallbackLine = JSON.stringify({
            ts: new Date().toISOString(),
            action: entry.action,
            resourceType: entry.resourceType,
            resourceId: entry.resourceId ?? null,
            userId: user?.id ?? null,
            orgId: user?.orgId ?? null,
            ip: req.ip ?? null,
            requestId: req.id,
            dbError: error.message,
          }) + '\n';
          fs.appendFileSync(fallbackPath, fallbackLine);
        } catch {
          // Last resort — already logged to stdout above.
        }
      }
    },
  );
});

declare module 'fastify' {
  interface FastifyInstance {
    audit: (req: FastifyRequest, entry: AuditEntry) => Promise<void>;
  }
}
