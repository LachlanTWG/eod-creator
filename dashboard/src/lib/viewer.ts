// Resolves the current viewer's identity + roles. Used by every protected
// page to gate access and scope queries.
//
// Returns:
//   - user (auth.users)
//   - isAdmin (from profiles.is_admin)
//   - salesPersonName (from sales_people.user_id link, if any) — canonical
//     name like "Lachlan" / "Buzz" / "Zac". Admins might also be execs.
//   - companyIds — companies this user belongs to as an exec (empty for
//     admin-only users)

import { cache } from "react";
import { redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "./supabase/server";

export type Viewer = {
  user: User;
  isAdmin: boolean;
  // Read-only "viewer" role: sees ALL data across every client but can edit
  // nothing and is not an exec. Mutually exclusive with isAdmin in practice.
  isViewer: boolean;
  salesPersonName: string | null;
  companyIds: string[];
  // Read visibility is org-wide for every role: admins, viewers, and roster
  // execs all see every client + exec + report (migration 0009). Writes stay
  // scoped — this flag gates read surfaces and "all" labels only.
  seesAll: boolean;
};

// Wrapped in React.cache so the 3 auth round-trips (getUser + profiles +
// sales_people) run at most ONCE per request, even though getViewer() is
// called in both the (app) layout and each page. Request-scoped: never
// shared across requests/users, so no auth leakage.
export const getViewer = cache(async function getViewer(): Promise<Viewer> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_viewer")
    .eq("id", user.id)
    .single();

  const { data: salesRows } = await supabase
    .from("sales_people")
    .select("name, company_id, active")
    .eq("user_id", user.id);

  const salesPersonName = salesRows && salesRows.length > 0 ? salesRows[0].name : null;
  // Active rosters only: an exec taken off a client shouldn't see its
  // drill-down or be able to log activities against it.
  const companyIds = (salesRows || []).filter(r => r.active).map(r => r.company_id);

  return {
    user,
    isAdmin: !!profile?.is_admin,
    isViewer: !!profile?.is_viewer,
    salesPersonName,
    companyIds,
    seesAll: !!profile?.is_admin || !!profile?.is_viewer || !!salesPersonName,
  };
});

/**
 * Strictly admin-only. Use for pages that mutate data (duplicates) or expose
 * ops internals (health). Read-only viewers are NOT admitted here. Everyone
 * else lands on /me.
 */
export function requireAdmin(viewer: Viewer): void {
  if (!viewer.isAdmin) redirect("/me");
}

/**
 * Allow anyone with org-wide read visibility (admins, read-only viewers, and
 * roster execs) through. Use for all-clients read-only surfaces (the
 * overview). Only accounts with no role at all are turned away.
 */
export function requireAdminOrViewer(viewer: Viewer): void {
  if (viewer.seesAll) return;
  redirect("/me");
}

/**
 * Allow admins, read-only viewers, and roster execs through (used for
 * peer-visible surfaces like the /execs leaderboard and site visits).
 * Pure-admin users with no exec link still pass via isAdmin.
 */
export function requireRosterOrAdmin(viewer: Viewer): void {
  if (viewer.isAdmin) return;
  if (viewer.isViewer) return;
  if (viewer.salesPersonName) return;
  redirect("/me");
}

/**
 * For pages parameterised by a sales-person name. Admins and viewers can view
 * any; roster execs can view each other (peer visibility). Non-execs land
 * on /me.
 */
export function gateExecName(viewer: Viewer, _requestedName: string): void {
  if (viewer.isAdmin) return;
  if (viewer.isViewer) return;
  if (viewer.salesPersonName) return;
  redirect("/me");
}

/**
 * For company drill-down pages. Every role (admin, viewer, roster exec) can
 * view any client; only role-less accounts are turned away.
 */
export async function gateCompanySlug(
  viewer: Viewer,
  supabase: SupabaseClient,
  slug: string,
): Promise<{ id: string; name: string; slug: string; timezone: string; owner_name: string | null } | null> {
  const { data: company } = await supabase
    .from("companies")
    .select("id, name, slug, timezone, owner_name")
    .eq("slug", slug)
    .single();
  if (!company) return null;
  if (viewer.seesAll) return company;
  redirect("/me");
}
