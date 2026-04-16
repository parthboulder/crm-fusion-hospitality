/**
 * Webhook routes — Dropbox & OneDrive file-push integrations.
 * These endpoints are called by external services, not authenticated users.
 */

import type { FastifyInstance } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from '../../lib/supabase.js';
import { env } from '../../config/env.js';

function verifyHmacSignature(
  payload: string,
  signature: string,
  secret: string,
  algorithm: 'sha256' | 'sha1' = 'sha256',
): boolean {
  try {
    const expected = createHmac(algorithm, secret).update(payload).digest('hex');
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function webhooksRoutes(app: FastifyInstance) {
  // ─── GET /dropbox — challenge verification ────────────────────────────────
  app.get('/dropbox', async (req, reply) => {
    const { challenge } = req.query as { challenge?: string };
    if (!challenge) {
      return reply.code(400).send({ error: 'Missing challenge.' });
    }
    return reply
      .header('Content-Type', 'text/plain')
      .header('X-Content-Type-Options', 'nosniff')
      .send(challenge);
  });

  // ─── POST /dropbox — file change notification ─────────────────────────────
  app.post('/dropbox', async (req, reply) => {
    if (!env.DROPBOX_WEBHOOK_SECRET) {
      return reply.code(503).send({ error: 'Dropbox integration not configured.' });
    }

    const signature = req.headers['x-dropbox-signature'] as string | undefined;
    if (!signature) {
      return reply.code(401).send({ error: 'Missing signature.' });
    }

    const rawBody = JSON.stringify(req.body);
    if (!verifyHmacSignature(rawBody, signature, env.DROPBOX_WEBHOOK_SECRET, 'sha256')) {
      return reply.code(401).send({ error: 'Invalid signature.' });
    }

    const payload = req.body as { list_folder: { accounts: string[] } };
    const accounts = payload?.list_folder?.accounts ?? [];

    app.log.info({ accounts }, 'dropbox_webhook_received');

    // Fan out — one Edge Function call per changed Dropbox account.
    const supabase = supabaseAdmin();
    await Promise.allSettled(
      accounts.map((accountId) =>
        supabase.functions.invoke('sync-dropbox', { body: { accountId } }),
      ),
    );

    return reply.send({ success: true });
  });

  // ─── POST /onedrive — change notification ─────────────────────────────────
  app.post('/onedrive', async (req, reply) => {
    // OneDrive sends a validation token on subscription creation.
    const { validationToken } = req.query as { validationToken?: string };
    if (validationToken) {
      return reply.header('Content-Type', 'text/plain').send(validationToken);
    }

    if (!env.ONEDRIVE_WEBHOOK_SECRET) {
      return reply.code(503).send({ error: 'OneDrive integration not configured.' });
    }

    const payload = req.body as {
      value: Array<{ clientState: string; resource: string; subscriptionId: string }>;
    };

    // Verify client state secret.
    const invalidItem = payload.value?.find(
      (item) => item.clientState !== env.ONEDRIVE_WEBHOOK_SECRET,
    );

    if (invalidItem) {
      return reply.code(401).send({ error: 'Invalid client state.' });
    }

    app.log.info({ count: payload.value?.length }, 'onedrive_webhook_received');

    const supabase = supabaseAdmin();
    await Promise.allSettled(
      (payload.value ?? []).map((item) =>
        supabase.functions.invoke('sync-onedrive', {
          body: { resource: item.resource, subscriptionId: item.subscriptionId },
        }),
      ),
    );

    return reply.send({ success: true });
  });
}
