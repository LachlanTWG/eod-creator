// Service-role Supabase client for the token-gated /eod-entry page, which has
// no user session (it renders inside a GoHighLevel iframe, cookie-free).
// Bypasses RLS — import only from server code, never client components, and
// keep its use read-scoped (company + roster lookups). Writes still go
// through the backend's /api/activities/manual dual-write, not this client.

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
