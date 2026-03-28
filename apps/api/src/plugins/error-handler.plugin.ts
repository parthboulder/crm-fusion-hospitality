/**
 * Global error handler — normalises all thrown errors into the API envelope.
 * Never leaks internal stack traces to clients in production.
 */

import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyError } from 'fastify';
import { ZodError } from 'zod';
import { env } from '../config/env.js';

export const errorHandlerPlugin = fp(async (app: FastifyInstance) => {
  app.setErrorHandler((error: FastifyError | Error, req, reply) => {
    const isDev = env.NODE_ENV === 'development';

    // Zod validation errors.
    if (error instanceof ZodError) {
      return reply.code(422).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed.',
          details: error.flatten().fieldErrors,
        },
      });
    }

    // Fastify validation errors (schema-level).
    const fe = error as FastifyError;
    if (fe.validation) {
      return reply.code(400).send({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid request payload.',
          details: isDev ? fe.validation : undefined,
        },
      });
    }

    const statusCode = fe.statusCode ?? 500;

    // Known HTTP errors (4xx) — safe to surface.
    if (statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({
        success: false,
        error: {
          code: fe.code ?? 'CLIENT_ERROR',
          message: fe.message,
        },
      });
    }

    // 5xx — log and return a safe message.
    app.log.error(
      { err: error, requestId: req.id, path: req.url },
      'unhandled_server_error',
    );

    return reply.code(500).send({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: isDev ? error.message : 'An unexpected error occurred.',
      },
    });
  });

  // 404 handler.
  app.setNotFoundHandler((_req, reply) => {
    return reply.code(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route not found.' },
    });
  });
});
