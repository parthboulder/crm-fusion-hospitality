/**
 * Rate limiting plugin — separate buckets for auth vs general API.
 */

import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

export const rateLimiterPlugin = fp(async (app: FastifyInstance) => {
  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_API_MAX,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (_req, context) => ({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Too many requests. Try again in ${Math.ceil(context.ttl / 1000)}s.`,
      },
    }),
  });
});
