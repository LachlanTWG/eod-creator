// Token-gated activity entry form, designed to be iframed inside GoHighLevel
// via a Custom Menu Link (one signed URL per client — generate with
// `node src/scripts/makeEodEntryLink.js <slug>` in the repo root). There is
// no login session here: the HMAC token in the URL pins the page to one
// company, and submissions run through the same /api/activities/manual
// dual-write funnel as the dashboard's Add Activity drawer, so entries land
// in the reports AND the dashboard. Listed in proxy.ts PUBLIC_PATHS and
// allowed to be framed via next.config.ts headers.

import type { Metadata } from "next";
import { verifyEodEntryToken } from "@/lib/eodEntryToken";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchContactHistory, fetchEodOptions } from "./data";
import { EodEntryForm } from "./EodEntryForm";

export const metadata: Metadata = {
  title: "EOD Entry",
  robots: { index: false, follow: false },
};

/** Today's calendar date in the company's timezone (en-CA → YYYY-MM-DD). */
function todayIn(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6">
      <p className="max-w-sm text-center text-sm text-zinc-400">{children}</p>
    </main>
  );
}

export default async function EodEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; location?: string; contact_name?: string; contact_id?: string }>;
}) {
  const { token, location, contact_name, contact_id } = await searchParams;
  const slug = token ? verifyEodEntryToken(token) : null;
  if (!token || !slug) {
    return <Notice>This entry link is missing or invalid. Ask Lachlan for a fresh link.</Notice>;
  }

  // "agency" is the browser extension's pseudo-slug: one token for the whole
  // team, with the client resolved per page view from the GHL location id in
  // the URL the exec is currently on.
  const supabase = createAdminClient();
  let query = supabase.from("companies").select("id, name, timezone, active");
  if (slug === "agency") {
    if (!location) return <Notice>Open this from the EOD Logger extension inside GHL.</Notice>;
    query = query.eq("ghl_location_id", location);
  } else {
    query = query.eq("slug", slug);
  }
  const { data: company } = await query.single();
  if (!company || !company.active) {
    return <Notice>This client is no longer active. Ask Lachlan for a fresh link.</Notice>;
  }

  const cName = contact_name?.trim() || "";
  const cId = contact_id?.trim() || "";
  const [{ data: people }, options, history] = await Promise.all([
    supabase
      .from("sales_people")
      .select("name")
      .eq("company_id", company.id)
      .eq("active", true)
      .order("name"),
    fetchEodOptions(company.id),
    fetchContactHistory(company.id, cId, cName),
  ]);

  return (
    <EodEntryForm
      token={token}
      ghlLocationId={location || ""}
      companyName={company.name}
      people={(people ?? []).map(p => p.name)}
      defaultDate={todayIn(company.timezone)}
      contactName={cName}
      contactId={cId}
      options={options}
      history={history}
    />
  );
}
