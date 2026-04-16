/**
 * Security headers plugin — helmet + strict CSP.
 */

import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';

export const securityHeadersPlugin = fp(async (app: FastifyInstance) => {
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Tailwind injects <style> tags at build time. In production the styles
        // are in an external CSS file, so 'unsafe-inline' is only needed for
        // dev hot-reload. Use 'unsafe-inline' only in development.
        styleSrc:
          process.env.NODE_ENV === 'production'
            ? ["'self'", 'https://rsms.me']
            : ["'self'", "'unsafe-inline'", 'https://rsms.me'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", process.env['SUPABASE_URL'] ?? 'https://*.supabase.co'],
        fontSrc: ["'self'", 'https://rsms.me'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false, // relaxed for file previews
  });
});
