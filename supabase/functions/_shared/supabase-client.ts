/**
 * Shared Supabase admin client for Edge Functions.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export function getAdminClient() {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Verify that the incoming request carries the service role key in the
 * Authorization header. Edge Functions should only be called by our API
 * server (via supabase.functions.invoke()), not directly by external clients.
 */
export function verifyServiceAuth(req: Request): boolean {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return token === serviceKey;
}
