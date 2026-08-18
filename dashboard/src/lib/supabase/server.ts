// Server-side Supabase client. Create a new one per request — never share
// across requests, never store in a module-scope variable.
//
// Reads + writes session cookies via the Next.js cookies() API (async in
// Next 16). setAll is wrapped in try/catch because cookies cannot be set
// during pure Server Component rendering; in that case the proxy.ts session
// refresh handles the writeback. See @supabase/ssr README for context.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — proxy.ts will handle the
            // session-cookie refresh on the next request.
          }
        },
      },
      // Next can cache fetch() by URL and ignore the Range header, which
      // makes page 2 of activities replay page 1 and double every count.
      global: {
        fetch: (url: RequestInfo | URL, init?: RequestInit) =>
          fetch(url, { ...init, cache: "no-store" }),
      },
    },
  );
}
