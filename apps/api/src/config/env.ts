/**
 * Validated environment config — fails fast at startup if required vars are missing.
 */

import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().default(3001),
  API_HOST: z.string().default('0.0.0.0'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  STORAGE_BUCKET_REPORTS: z.string().default('reports-private'),
  SIGNED_URL_EXPIRY_SECONDS: z.coerce.number().default(900),

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
