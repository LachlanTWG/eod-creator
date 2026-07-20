// Next.js 16 proxy (formerly middleware). Refreshes the Supabase session
// cookie on every request so server-rendered pages see a valid token, and
// gates all non-public routes behind auth.
//
// Pattern from the @supabase/ssr Next.js guide, adapted for proxy.ts.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// /eod-entry is the GHL-embedded form — auth is its signed URL token, not a
// session (third-party cookies don't survive inside the GHL iframe anyway).
const PUBLIC_PATHS = ["/login", "/auth/callback", "/eod-entry"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write to the request first so subsequent reads in this proxy
          // run see the new values, then rebuild the response with the
          // updated headers (per the Supabase SSR pattern).
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getClaims verifies the JWT (vs getSession which doesn't). Cheap when the
  // token is still valid; triggers a refresh when expired. Returns
  // { data: null } when no session — don't destructure blindly.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims ?? null;

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + "/"));

  if (!claims && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Run on every path except static assets and image optimisation.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
