"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/viewer";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppRole, CompanyAccess } from "@/lib/viewer";

export type AccountRow = {
  id: string;
  email: string;
  fullName: string | null;
  role: AppRole;
  memberships: { companyId: string; companyName: string; access: CompanyAccess }[];
  roster: { companyId: string; companyName: string }[];
};

export type AccountsPageData = {
  people: AccountRow[];
  companies: { id: string; name: string; slug: string }[];
};

const ROLES: AppRole[] = ["owner", "twg", "conversion", "team", "client"];
const ACCESS: CompanyAccess[] = ["leader", "conversion", "member", "client", "twg"];

function asRole(v: string): AppRole {
  return (ROLES as string[]).includes(v) ? (v as AppRole) : "team";
}
function asAccess(v: string): CompanyAccess {
  return (ACCESS as string[]).includes(v) ? (v as CompanyAccess) : "member";
}

export async function loadAccountsPage(): Promise<AccountsPageData> {
  const viewer = await getViewer();
  if (!viewer.canManageUsers) throw new Error("Not allowed");

  const admin = createAdminClient();
  const [{ data: profiles, error: pErr }, { data: companies, error: cErr }, { data: memberships }, { data: roster }] =
    await Promise.all([
      admin.from("profiles").select("id, email, full_name, role").order("email"),
      admin.from("companies").select("id, name, slug").eq("active", true).order("name"),
      admin.from("company_memberships").select("user_id, company_id, access"),
      admin.from("sales_people").select("user_id, company_id, active, companies(name)").eq("active", true).not("user_id", "is", null),
    ]);
  if (pErr) throw pErr;
  if (cErr) throw cErr;

  const companyById = new Map((companies || []).map(c => [c.id, c.name]));
  const memByUser = new Map<string, AccountRow["memberships"]>();
  for (const m of memberships || []) {
    const list = memByUser.get(m.user_id) || [];
    list.push({
      companyId: m.company_id,
      companyName: companyById.get(m.company_id) || "—",
      access: m.access as CompanyAccess,
    });
    memByUser.set(m.user_id, list);
  }
  const rosterByUser = new Map<string, AccountRow["roster"]>();
  for (const r of roster || []) {
    if (!r.user_id) continue;
    const list = rosterByUser.get(r.user_id) || [];
    const rel = r.companies as { name: string } | { name: string }[] | null;
    const name = Array.isArray(rel) ? rel[0]?.name : rel?.name;
    list.push({
      companyId: r.company_id,
      companyName: name || companyById.get(r.company_id) || "—",
    });
    rosterByUser.set(r.user_id, list);
  }

  return {
    companies: companies || [],
    people: (profiles || []).map(p => ({
      id: p.id,
      email: p.email,
      fullName: p.full_name,
      role: asRole(p.role),
      memberships: memByUser.get(p.id) || [],
      roster: rosterByUser.get(p.id) || [],
    })),
  };
}

export async function setUserRole(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const viewer = await getViewer();
  if (!viewer.canManageUsers) return { ok: false, error: "Not allowed" };
  const userId = String(formData.get("userId") || "");
  const role = asRole(String(formData.get("role") || "team"));
  if (!userId) return { ok: false, error: "Missing user" };
  if (userId === viewer.user.id && role !== "owner") {
    return { ok: false, error: "Don't remove your own owner role" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/accounts");
  return { ok: true };
}

export async function grantCompanyAccess(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const viewer = await getViewer();
  if (!viewer.canManageUsers) return { ok: false, error: "Not allowed" };
  const userId = String(formData.get("userId") || "");
  const companyId = String(formData.get("companyId") || "");
  const access = asAccess(String(formData.get("access") || "member"));
  if (!userId || !companyId) return { ok: false, error: "Pick a person and a client" };

  const supabase = await createClient();
  const { error } = await supabase.from("company_memberships").upsert(
    { user_id: userId, company_id: companyId, access },
    { onConflict: "user_id,company_id" },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/accounts");
  return { ok: true };
}

export async function revokeCompanyAccess(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const viewer = await getViewer();
  if (!viewer.canManageUsers) return { ok: false, error: "Not allowed" };
  const userId = String(formData.get("userId") || "");
  const companyId = String(formData.get("companyId") || "");
  if (!userId || !companyId) return { ok: false, error: "Missing grant" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("company_memberships")
    .delete()
    .eq("user_id", userId)
    .eq("company_id", companyId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/accounts");
  return { ok: true };
}

export async function inviteUser(formData: FormData): Promise<
  { ok: true; tempPassword?: string } | { ok: false; error: string }
> {
  const viewer = await getViewer();
  if (!viewer.canManageUsers) return { ok: false, error: "Not allowed" };

  const email = String(formData.get("email") || "").trim().toLowerCase();
  const role = asRole(String(formData.get("role") || "team"));
  const companyId = String(formData.get("companyId") || "");
  const access = asAccess(String(formData.get("access") || (role === "client" ? "client" : role === "conversion" ? "conversion" : "member")));
  if (!email || !email.includes("@")) return { ok: false, error: "Need a valid email" };

  const admin = createAdminClient();
  const { data: existing } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();

  let userId = existing?.id || null;
  let tempPassword: string | undefined;

  if (!userId) {
    const invited = await admin.auth.admin.inviteUserByEmail(email, {
      data: { role },
    });
    if (invited.data.user?.id) {
      userId = invited.data.user.id;
    } else {
      tempPassword = randomBytes(9).toString("base64url");
      const created = await admin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { role },
      });
      if (created.error || !created.data.user) {
        return { ok: false, error: invited.error?.message || created.error?.message || "Could not create user" };
      }
      userId = created.data.user.id;
    }
  }

  const { error: roleErr } = await admin.from("profiles").update({ role }).eq("id", userId);
  if (roleErr) return { ok: false, error: roleErr.message };

  if (companyId) {
    const { error: memErr } = await admin.from("company_memberships").upsert(
      { user_id: userId, company_id: companyId, access },
      { onConflict: "user_id,company_id" },
    );
    if (memErr) return { ok: false, error: memErr.message };
  }

  revalidatePath("/settings/accounts");
  return tempPassword ? { ok: true, tempPassword } : { ok: true };
}
