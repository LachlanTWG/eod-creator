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

import { redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "./supabase/server";

export type Viewer = {
  user: User;
  isAdmin: boolean;
  salesPersonName: string | null;
  companyIds: string[];
};

export async function getViewer(): Promise<Viewer> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  const { data: salesRows } = await supabase
    .from("sales_people")
    .select("name, company_id")
    .eq("user_id", user.id);

  const salesPersonName = salesRows && salesRows.length > 0 ? salesRows[0].name : null;
  const companyIds = (salesRows || []).map(r => r.company_id);

  return {
    user,
    isAdmin: !!profile?.is_admin,
    salesPersonName,
    companyIds,
  };
}

/**
 * Convenience: if the viewer is an exec (not admin), send them to /me.
 * Use at the top of admin-only pages.
 */
export function requireAdmin(viewer: Viewer): void {
  if (!viewer.isAdmin) redirect("/me");
}

/**
 * Allow admins and roster execs through (used for peer-visible surfaces
 * like the /execs leaderboard). Pure-admin users with no exec link still
 * pass via isAdmin.
 */
export function requireRosterOrAdmin(viewer: Viewer): void {
  if (viewer.isAdmin) return;
  if (viewer.salesPersonName) return;
  redirect("/me");
}

/**
 * For pages parameterised by a sales-person name. Admin can view any;
 * roster execs can view each other (peer visibility). Non-execs land
 * on /me.
 */
export function gateExecName(viewer: Viewer, _requestedName: string): void {
  if (viewer.isAdmin) return;
  if (viewer.salesPersonName) return;
  redirect("/me");
}

/**
 * For company drill-down pages. Admin can view any; execs can only view
 * companies they're on the roster of.
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
  if (viewer.isAdmin) return company;
  if (viewer.companyIds.includes(company.id)) return company;
  redirect("/me");
}
