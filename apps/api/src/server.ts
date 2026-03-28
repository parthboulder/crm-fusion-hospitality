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

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', { logLevel: 'silent' }, async () => ({
  status: 'ok',
  ts: new Date().toISOString(),
}));

// ─── Start ────────────────────────────────────────────────────────────────────

try {
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
  app.log.info(`Server listening on port ${env.API_PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
