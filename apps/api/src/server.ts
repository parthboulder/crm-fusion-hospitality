/**
 * Fastify server entry point — registers all plugins and route modules.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { env } from './config/env.js';

// Plugins
import { securityHeadersPlugin } from './plugins/security-headers.plugin.js';
import { rateLimiterPlugin } from './plugins/rate-limiter.plugin.js';
import { authPlugin } from './plugins/auth.plugin.js';
import { rbacPlugin } from './plugins/rbac.plugin.js';
import { auditPlugin } from './plugins/audit.plugin.js';
import { errorHandlerPlugin } from './plugins/error-handler.plugin.js';

// Routes
import { authRoutes } from './routes/auth/index.js';
import { propertiesRoutes } from './routes/properties/index.js';
import { reportsRoutes } from './routes/reports/index.js';
import { metricsRoutes } from './routes/metrics/index.js';
import { alertsRoutes } from './routes/alerts/index.js';
import { tasksRoutes } from './routes/tasks/index.js';
import { aiRoutes } from './routes/ai/index.js';
import { adminRoutes } from './routes/admin/index.js';
import { webhooksRoutes } from './routes/webhooks/index.js';
import { batchesRoutes } from './routes/batches/index.js';
import { scannerRoutes } from './routes/scanner/index.js';
import { ocrRoutes } from './routes/ocr/index.js';

// Workers
import { startOcrWorker } from './workers/ocr-worker.js';
import { ensureOcrBucket } from './workers/ocr-bucket-init.js';

const app = Fastify({
  logger: {
    level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    ...(env.NODE_ENV !== 'production' && {
      transport: { target: 'pino-pretty', options: { colorize: true } },
    }),
  },
  genReqId: () => crypto.randomUUID(),
  trustProxy: true,
});

// ─── Core Plugins ─────────────────────────────────────────────────────────────

await app.register(cors, {
  origin: env.CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});

await app.register(multipart, {
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB (supports ZIP batch uploads)
});

await app.register(securityHeadersPlugin);
await app.register(rateLimiterPlugin);
await app.register(authPlugin);
await app.register(rbacPlugin);
await app.register(auditPlugin);
await app.register(errorHandlerPlugin);

// ─── Routes ───────────────────────────────────────────────────────────────────

await app.register(authRoutes, { prefix: '/api/v1/auth' });
await app.register(propertiesRoutes, { prefix: '/api/v1/properties' });
await app.register(reportsRoutes, { prefix: '/api/v1/reports' });
await app.register(metricsRoutes, { prefix: '/api/v1/metrics' });
await app.register(alertsRoutes, { prefix: '/api/v1/alerts' });
await app.register(tasksRoutes, { prefix: '/api/v1/tasks' });
await app.register(aiRoutes, { prefix: '/api/v1/ai' });
await app.register(adminRoutes, { prefix: '/api/v1/admin' });
await app.register(webhooksRoutes, { prefix: '/api/v1/webhooks' });
await app.register(batchesRoutes, { prefix: '/api/v1/batches' });
await app.register(scannerRoutes, { prefix: '/api/v1/scanner' });
await app.register(ocrRoutes, { prefix: '/api/v1/ocr' });

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', { logLevel: 'silent' }, async () => ({
  status: 'ok',
  ts: new Date().toISOString(),
}));

// ─── Process-level crash guards ──────────────────────────────────────────────
// Node 15+ crashes the process on unhandled promise rejections. The OCR
// worker handles everything it can in its inner try/catch, but third-party
// libs (pdfjs, tesseract) occasionally throw from internal async streams
// we can't wrap. These handlers keep the server alive — the affected job
// remains in 'processing' and gets reclaimed on the next worker startup
// sweep (see ocr-worker.ts).
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
  app.log.error({ reason: message }, 'process.unhandledRejection');
});

process.on('uncaughtException', (err) => {
  app.log.error({ err: err.stack ?? err.message }, 'process.uncaughtException');
  // Do NOT re-throw or exit. Node's default behavior is to terminate, which
  // is correct for unknown state corruption — but for our OCR pipeline,
  // single-PDF library bugs should not take down the whole API. The worker's
  // stuck-job reclaimer will clean up any jobs that got orphaned.
});

// ─── Start ────────────────────────────────────────────────────────────────────

try {
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
  app.log.info(`Server listening on port ${env.API_PORT}`);

  // Ensure Supabase bucket exists before the worker (or any upload) hits it.
  // Non-fatal: if it fails, we still start — uploads will error with a clear
  // message and an operator can fix the bucket manually.
  await ensureOcrBucket(app.log).catch((err) => {
    app.log.error({ err: err instanceof Error ? err.message : err }, 'ocr_bucket.init_failed');
  });

  const ocrWorker = startOcrWorker(app.log);

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'server.shutdown.start');
    await ocrWorker.stop();
    await app.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
