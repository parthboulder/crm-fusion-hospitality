/**
 * Validated environment config — fails fast at startup if required vars are missing.
 * Loads .env from repo root (monorepo single-env convention) before validation.
 */

import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try repo root first (apps/api/src/config/env.ts → ../../../../.env), then CWD.
loadEnv({ path: path.resolve(__dirname, '../../../../.env') });
loadEnv(); // CWD fallback — no-op if already loaded

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().default(3001),
  API_HOST: z.string().default('0.0.0.0'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  STORAGE_BUCKET_REPORTS: z.string().default('reports-private'),
  STORAGE_BUCKET_OCR: z.string().default('ocr-uploads'),
  SIGNED_URL_EXPIRY_SECONDS: z.coerce.number().default(900),

  OCR_MAX_FILE_SIZE_BYTES: z.coerce.number().default(20 * 1024 * 1024),
  OCR_WORKER_INTERVAL_MS: z.coerce.number().default(7_000),
  OCR_WORKER_CONCURRENCY: z.coerce.number().default(2),
  OCR_WORKER_MAX_RETRIES: z.coerce.number().default(2),
  OCR_WORKER_ENABLED: z.coerce.boolean().default(true),
  NVIDIA_API_KEY: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('alerts@fusion-hospitality.com'),

  DROPBOX_APP_KEY: z.string().optional(),
  DROPBOX_APP_SECRET: z.string().optional(),
  DROPBOX_WEBHOOK_SECRET: z.string().optional(),

  ONEDRIVE_CLIENT_ID: z.string().optional(),
  ONEDRIVE_CLIENT_SECRET: z.string().optional(),
  ONEDRIVE_TENANT_ID: z.string().optional(),
  ONEDRIVE_WEBHOOK_SECRET: z.string().optional(),

  RATE_LIMIT_AUTH_MAX: z.coerce.number().default(10),
  RATE_LIMIT_API_MAX: z.coerce.number().default(300),
  SESSION_MAX_CONCURRENT: z.coerce.number().default(5),
  MFA_REQUIRED_ROLES: z.string().default('super_admin,finance,corporate'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌  Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
