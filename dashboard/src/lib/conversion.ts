import type { SupabaseClient } from "@supabase/supabase-js";
import { listCompanies } from "./queries";

export const FUNNEL_EVENTS = [
  "lead_in",
  "vsl_view",
  "vsl_complete",
  "call",
  "quote_sent",
  "site_visit",
  "won",
] as const;

export const EVENT_LABEL: Record<string, string> = {
  lead_in: "Leads",
  vsl_view: "VSL views",
  vsl_complete: "VSL completes",
  call: "Calls",
  quote_sent: "Quotes",
  site_visit: "Site visits",
  won: "Won",
  lost: "Lost",
  email: "Emails",
};

export type ConversionEventRow = {
  id: string;
  company_id: string;
  contact_id: string | null;
  contact_name: string | null;
  event: string;
  source: string | null;
  campaign: string | null;
  occurred_on: string;
  occurred_at: string;
  sales_person_name: string | null;
  value: number | null;
};

export type ConversionSnapshot = {
  from: string;
  to: string;
  companyId: string;
  companyName: string;
  companySlug: string;
  funnel: { event: string; label: string; count: number }[];
  sources: { source: string; leads: number; quotes: number; wins: number; wonValue: number }[];
  recent: (ConversionEventRow & { companyName: string })[];
};

function snapshotFromRows(
  rows: ConversionEventRow[],
  meta: { from: string; to: string; companyId: string; companyName: string; companySlug: string },
): ConversionSnapshot {
  const funnelCounts = new Map<string, number>();
  const sourceMap = new Map<string, { leads: number; quotes: number; wins: number; wonValue: number }>();

  for (const r of rows) {
    funnelCounts.set(r.event, (funnelCounts.get(r.event) || 0) + 1);
    const src = (r.source || "").trim() || "Unattributed";
    const bucket = sourceMap.get(src) || { leads: 0, quotes: 0, wins: 0, wonValue: 0 };
    if (r.event === "lead_in") bucket.leads++;
    if (r.event === "quote_sent") bucket.quotes++;
    if (r.event === "won") {
      bucket.wins++;
      bucket.wonValue += Number(r.value) || 0;
    }
    sourceMap.set(src, bucket);
  }

  const sources = [...sourceMap.entries()]
    .map(([source, v]) => ({ source, ...v }))
    .sort((a, b) => b.leads + b.quotes + b.wins - (a.leads + a.quotes + a.wins));

  return {
    ...meta,
    funnel: FUNNEL_EVENTS.map(event => ({
      event,
      label: EVENT_LABEL[event],
      count: funnelCounts.get(event) || 0,
    })),
    sources,
    recent: rows.slice(0, 40).map(r => ({
      ...r,
      companyName: meta.companyName,
    })),
  };
}

export async function loadConversionSnapshot(
  supabase: SupabaseClient,
  opts: { from: string; to: string; companyId: string; companyName: string; companySlug: string },
): Promise<ConversionSnapshot> {
  const { data, error } = await supabase
    .from("conversion_events")
    .select("id, company_id, contact_id, contact_name, event, source, campaign, occurred_on, occurred_at, sales_person_name, value")
    .eq("company_id", opts.companyId)
    .gte("occurred_on", opts.from)
    .lte("occurred_on", opts.to)
    .order("occurred_at", { ascending: false })
    .limit(4000);
  if (error) throw error;
  return snapshotFromRows((data || []) as ConversionEventRow[], opts);
}

export async function loadConversionByCompany(
  supabase: SupabaseClient,
  opts: { from: string; to: string },
): Promise<ConversionSnapshot[]> {
  const companies = await listCompanies(supabase);
  const { data, error } = await supabase
    .from("conversion_events")
    .select("id, company_id, contact_id, contact_name, event, source, campaign, occurred_on, occurred_at, sales_person_name, value")
    .gte("occurred_on", opts.from)
    .lte("occurred_on", opts.to)
    .order("occurred_at", { ascending: false })
    .limit(8000);
  if (error) throw error;
  const rows = (data || []) as ConversionEventRow[];
  const byCompany = new Map<string, ConversionEventRow[]>();
  for (const r of rows) {
    const list = byCompany.get(r.company_id) || [];
    list.push(r);
    byCompany.set(r.company_id, list);
  }
  return companies.map(c =>
    snapshotFromRows(byCompany.get(c.id) || [], {
      from: opts.from,
      to: opts.to,
      companyId: c.id,
      companyName: c.name,
      companySlug: c.slug,
    }),
  );
}
