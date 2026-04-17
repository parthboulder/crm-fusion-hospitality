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
  // Override the actor when req.authUser isn't set yet (e.g. login success
  // is logged before the auth middleware ever ran). For most calls leave
  // these blank — the plugin reads from req.authUser.
  actorUserId?: string;
  actorOrgId?: string;
}

/**
 * Prefer a real public IP when available.
 *
 * `req.ip` comes from the socket / X-Forwarded-For chain. In local dev it's
 * always 127.0.0.1; behind a mis-configured proxy it can be the proxy's IP.
 * The SPA attaches `X-Client-Public-IP` (resolved via ipify) on every
 * request — we trust it only when the socket IP is private/local so callers
 * outside the SPA can't spoof their audit trail from the public internet.
 */
function resolveClientIp(req: FastifyRequest): string | null {
  const sockIp = req.ip ?? null;
  const isPrivate = (ip: string): boolean =>
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    ip.startsWith('fc') ||
    ip.startsWith('fd');

  if (sockIp && !isPrivate(sockIp)) return sockIp;

  const hdr = req.headers['x-client-public-ip'];
  const claimed = Array.isArray(hdr) ? hdr[0] : hdr;
  if (claimed && /^[0-9a-fA-F.:]+$/.test(claimed) && !isPrivate(claimed)) {
    return claimed;
  }
  return sockIp;
}

export const auditPlugin = fp(async (app: FastifyInstance) => {
  app.decorate(
    'audit',
    async (req: FastifyRequest, entry: AuditEntry): Promise<void> => {
      const supabase = supabaseAdmin();
      const user = req.authUser;
      const ip = resolveClientIp(req);

      const { error } = await supabase
        .from('audit_logs')
        .insert({
          org_id: entry.actorOrgId ?? user?.orgId ?? null,
          user_id: entry.actorUserId ?? user?.id ?? null,
          session_id: user?.sessionId ?? null,
          action: entry.action,
          resource_type: entry.resourceType,
          resource_id: entry.resourceId ?? null,
          before_value: entry.beforeValue ? (entry.beforeValue as object) : null,
          after_value: entry.afterValue ? (entry.afterValue as object) : null,
          ip_address: ip,
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
            ip,
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
