"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer } from "@/lib/viewer";
import {
  isMailboxConnectConfigured,
  mailboxStartUrl,
  nodeServiceBase,
  signMailboxOAuthState,
  type MailboxProvider,
} from "@/lib/mailboxConnect";

export type CompanyOption = {
  id: string;
  name: string;
  slug: string;
  /** Preferred mailbox provider for this client (gmail | outlook). */
  mailboxProvider: MailboxProvider;
};

export type MailboxConnection = {
  id: string;
  companyId: string;
  companyName: string;
  companySlug: string;
  provider: MailboxProvider;
  email: string;
  status: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  salesPersonName: string;
};

export type EmailSettingsData = {
  connections: MailboxConnection[];
  /** Clients this user can bind a mailbox to (not already connected, or all for reconnect). */
  companies: CompanyOption[];
  /** Clients already connected — used to filter the "add" dropdown. */
  connectedCompanyIds: string[];
  salesPersonName: string | null;
  unmatchedLast7d: number;
};

export async function getEmailSettingsData(): Promise<EmailSettingsData> {
  const viewer = await getViewer();
  const admin = createAdminClient();

  // Companies the viewer may bind: roster companies for execs; all active for admin.
  let companiesQuery = admin
    .from("companies")
    .select("id, name, slug, mailbox_provider")
    .eq("active", true)
    .order("name");
  if (!viewer.isAdmin && viewer.companyIds.length > 0) {
    companiesQuery = companiesQuery.in("id", viewer.companyIds);
  } else if (!viewer.isAdmin) {
    // No roster — empty list
    return {
      connections: [],
      companies: [],
      connectedCompanyIds: [],
      salesPersonName: viewer.salesPersonName,
      unmatchedLast7d: 0,
    };
  }

  const { data: companyRows } = await companiesQuery;
  const companies: CompanyOption[] = (companyRows || []).map(c => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    mailboxProvider: (c.mailbox_provider === "outlook" ? "outlook" : "gmail") as MailboxProvider,
  }));

  const { data: rows } = await admin
    .from("mailbox_accounts")
    .select(
      "id, company_id, provider, email, status, last_synced_at, last_error, sales_person_name, companies(name, slug)",
    )
    .eq("user_id", viewer.user.id)
    .order("connected_at", { ascending: false });

  const connections: MailboxConnection[] = (rows || []).map((r: {
    id: string;
    company_id: string;
    provider: string;
    email: string;
    status: string;
    last_synced_at: string | null;
    last_error: string | null;
    sales_person_name: string;
    companies: { name: string; slug: string } | { name: string; slug: string }[] | null;
  }) => {
    const co = Array.isArray(r.companies) ? r.companies[0] : r.companies;
    return {
      id: r.id,
      companyId: r.company_id,
      companyName: co?.name || "Unknown client",
      companySlug: co?.slug || "",
      provider: (r.provider as MailboxProvider) || "gmail",
      email: r.email,
      status: r.status,
      lastSyncedAt: r.last_synced_at,
      lastError: r.last_error,
      salesPersonName: r.sales_person_name || viewer.salesPersonName || "",
    };
  });

  const connectedCompanyIds = connections.map(c => c.companyId);

  // Unmatched across all of this user's mailboxes (last 7d)
  let unmatchedLast7d = 0;
  if (connections.length > 0) {
    const since = new Date();
    since.setDate(since.getDate() - 7);
    const { count } = await admin
      .from("mailbox_unmatched")
      .select("id", { count: "exact", head: true })
      .in(
        "mailbox_account_id",
        connections.map(c => c.id),
      )
      .gte("created_at", since.toISOString());
    unmatchedLast7d = count || 0;
  }

  return {
    connections,
    companies,
    connectedCompanyIds,
    salesPersonName: viewer.salesPersonName,
    unmatchedLast7d,
  };
}

export type ConnectResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export async function startMailboxConnect(
  companyId: string,
  provider: MailboxProvider,
  returnUrl: string,
): Promise<ConnectResult> {
  const viewer = await getViewer();
  if (!viewer.salesPersonName) {
    return {
      ok: false,
      error: "Your login isn't linked to a sales exec roster name. Ask an admin to link sales_people.user_id.",
    };
  }
  if (!companyId) return { ok: false, error: "Pick a client first" };
  if (provider !== "gmail" && provider !== "outlook") {
    return { ok: false, error: "Choose Gmail or Outlook" };
  }
  if (!isMailboxConnectConfigured()) {
    return {
      ok: false,
      error: "Email connect isn't configured (need NODE_SERVICE_URL + WEBHOOK_SECRET on the dashboard).",
    };
  }

  // Must be on that client's roster (unless admin).
  if (!viewer.isAdmin && !viewer.companyIds.includes(companyId)) {
    return { ok: false, error: "You're not on that client's roster" };
  }

  // Prefer the roster short name for THIS company (in case of multi-name edge cases).
  const admin = createAdminClient();
  const { data: sp } = await admin
    .from("sales_people")
    .select("name")
    .eq("user_id", viewer.user.id)
    .eq("company_id", companyId)
    .eq("active", true)
    .maybeSingle();
  const salesPersonName = sp?.name || viewer.salesPersonName;

  try {
    const state = signMailboxOAuthState({
      userId: viewer.user.id,
      salesPersonName,
      provider,
      companyId,
      returnUrl,
    });
    return { ok: true, url: mailboxStartUrl(state) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function disconnectMailbox(
  companyId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const viewer = await getViewer();
  if (!companyId) return { ok: false, error: "companyId required" };
  const base = nodeServiceBase();
  const secret = process.env.WEBHOOK_SECRET;
  if (!base || !secret) {
    return { ok: false, error: "NODE_SERVICE_URL / WEBHOOK_SECRET not configured" };
  }
  try {
    const res = await fetch(`${base}/oauth/mailbox/disconnect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ userId: viewer.user.id, companyId }),
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: text || `Disconnect failed (${res.status})` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
