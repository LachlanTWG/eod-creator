// Auth callback for the PKCE flow used by Supabase password recovery,
// magic-link logins, and invite acceptances. Exchanges the `code` query
// param for a session, then redirects based on the flow type:
//   - recovery / invite → /auth/update-password (force a new password)
//   - everything else   → home (proxy will gate to /login if still unauth)

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const type = searchParams.get("type");          // "recovery" | "invite" | "magiclink" | etc.
  const next = searchParams.get("next");

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing-code", origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, origin),
    );
  }

  // First-time invite acceptance + password recovery both land here. In
  // either case the user needs to set their password before doing anything
  // else.
  if (type === "recovery" || type === "invite") {
    return NextResponse.redirect(new URL("/auth/update-password", origin));
  }

  return NextResponse.redirect(new URL(next || "/", origin));
}
