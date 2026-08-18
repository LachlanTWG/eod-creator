// Resolves the current viewer's identity + roles. Used by every protected
// page to gate access and scope queries.

import { cache } from "react";
import { redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "./supabase/server";
import { betaCompany, betaViewer, isBeta } from "./beta";

export type AppRole = "owner" | "twg" | "conversion" | "team" | "client";
export type CompanyAccess = "leader" | "conversion" | "member" | "client" | "twg";

export type Membership = {
  companyId: string;
  access: CompanyAccess;
};

export type Viewer = {
  user: User;
  role: AppRole;
  isAdmin: boolean;
  isViewer: boolean;
  isTwg: boolean;
  isConversion: boolean;
  isClient: boolean;
  isLeader: boolean;
  salesPersonName: string | null;
  companyIds: string[];
  memberships: Membership[];
  // Org-wide read (owner, TWG-all, legacy viewer). Team/leader/conversion
  // are company-scoped even when they sit on several books.
  seesAll: boolean;
  canManageUsers: boolean;
  canSeeHealth: boolean;
  canSeeExecs: boolean;
  canWriteSales: boolean;
};

function asRole(raw: string | null | undefined): AppRole {
  if (raw === "owner" || raw === "twg" || raw === "conversion" || raw === "team" || raw === "client") {
    return raw;
  }
  return "team";
}

export const getViewer = cache(async function getViewer(): Promise<Viewer> {
  if (isBeta()) return betaViewer();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_viewer, role, twg_see_all_clients")
    .eq("id", user.id)
    .single();

  const { data: salesRows } = await supabase
    .from("sales_people")
    .select("name, company_id, active")
    .eq("user_id", user.id);

  const { data: memberRows } = await supabase
    .from("company_memberships")
    .select("company_id, access")
    .eq("user_id", user.id);

  const role = asRole(profile?.role);
  const isAdmin = !!profile?.is_admin || role === "owner";
  const isTwg = role === "twg";
  const isConversion = role === "conversion";
  const isClient = role === "client";
  const isViewer = !!profile?.is_viewer || isTwg;

  const salesPersonName = salesRows && salesRows.length > 0 ? salesRows[0].name : null;
  const rosterIds = (salesRows || []).filter(r => r.active).map(r => r.company_id);
  const memberships: Membership[] = (memberRows || []).map(r => ({
    companyId: r.company_id,
    access: r.access as CompanyAccess,
  }));
  const memberIds = memberships.map(m => m.companyId);
  const companyIds = Array.from(new Set([...rosterIds, ...memberIds]));
  const isLeader = memberships.some(m => m.access === "leader");

  const seesAll = isAdmin || (isTwg && profile?.twg_see_all_clients !== false) || (!!profile?.is_viewer && role !== "conversion" && !isClient);

  return {
    user,
    role,
    isAdmin,
    isViewer,
    isTwg,
    isConversion,
    isClient,
    isLeader,
    salesPersonName,
    companyIds,
    memberships,
    seesAll,
    canManageUsers: isAdmin,
    canSeeHealth: isAdmin,
    canSeeExecs: !isClient,
    canWriteSales: isAdmin || (!!salesPersonName && !isClient && !isTwg),
  };
});

/** First page after login. Conversion lead home wins even if they are also on a roster. */
export function homeHref(viewer: Viewer): string {
  if (viewer.isConversion) return "/conversion";
  if (viewer.salesPersonName) return `/execs/${encodeURIComponent(viewer.salesPersonName)}`;
  return "/";
}

export function requireAdmin(viewer: Viewer): void {
  if (!viewer.isAdmin) redirect("/me");
}

export function requireAppAccess(viewer: Viewer): void {
  if (viewer.isAdmin || viewer.isTwg || viewer.isConversion || viewer.isClient || viewer.salesPersonName || viewer.companyIds.length > 0) {
    return;
  }
  redirect("/me");
}

/** @deprecated use requireAppAccess — kept so existing pages compile during the cutover */
export function requireAdminOrViewer(viewer: Viewer): void {
  requireAppAccess(viewer);
}

export function requireRosterOrAdmin(viewer: Viewer): void {
  if (viewer.isClient) redirect("/me");
  if (viewer.isAdmin || viewer.isTwg || viewer.isConversion || viewer.isLeader || viewer.salesPersonName) return;
  redirect("/me");
}

export function gateExecName(viewer: Viewer, _requestedName: string): void {
  if (viewer.isClient) redirect("/me");
  if (viewer.isAdmin || viewer.isTwg || viewer.isConversion || viewer.isLeader || viewer.salesPersonName) return;
  redirect("/me");
}

export async function gateCompanySlug(
  viewer: Viewer,
  supabase: SupabaseClient,
  slug: string,
): Promise<{ id: string; name: string; slug: string; timezone: string; owner_name: string | null } | null> {
  if (isBeta()) return betaCompany(slug);

  const { data: company } = await supabase
    .from("companies")
    .select("id, name, slug, timezone, owner_name")
    .eq("slug", slug)
    .single();
  if (!company) return null;
  if (viewer.seesAll) return company;
  if (viewer.companyIds.includes(company.id)) return company;
  redirect("/me");
}
