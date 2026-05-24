// Browser-side Supabase client. Ships with the anon key only — RLS enforces
// visibility. Safe to call from Client Components and to subscribe to
// realtime channels.

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
