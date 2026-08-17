import type { SupabaseClient } from "@supabase/supabase-js";
import { listCompanies } from "./queries";
import { createAdminClient } from "./supabase/admin";

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

export type PaidCampaignRow = {
  key: string;
  label: string;
  spend: number;
  leads: number;
  quotes: number;
  wins: number;
  wonValue: number;
  cpl: number | null;
  cpa: number | null;
  roas: number | null;
};

export type PaidAttribution = {
  spend: number;
  leads: number;
  quotes: number;
  wins: number;
  wonValue: number;
  cpl: number | null;
  cpa: number | null;
  roas: number | null;
  campaigns: PaidCampaignRow[];
  connected: boolean;
  pixelId: string | null;
  adAccountId: string | null;
};

type TouchRow = {
  contact_id: string | null;
  contact_name: string | null;
  event: string;
  source: string | null;
  campaign: string | null;
  utm_campaign: string | null;
  campaign_id: string | null;
  occurred_at: string;
  value: number | null;
};

function contactKey(r: { contact_id: string | null; contact_name: string | null }) {
  if (r.contact_id) return `id:${r.contact_id}`;
  const name = (r.contact_name || "").trim().toLowerCase();
  return name ? `name:${name}` : "";
}

function campaignLabel(r: {
  utm_campaign?: string | null;
  campaign?: string | null;
  source?: string | null;
  campaign_id?: string | null;
}) {
  return (r.utm_campaign || r.campaign || r.source || "").trim() || "Unattributed";
}

export async function loadPaidAttribution(
  supabase: SupabaseClient,
  opts: { companyId: string; from: string; to: string },
): Promise<PaidAttribution> {
  const admin = createAdminClient();
  const [{ data: events, error: eErr }, { data: spendRows, error: sErr }, { data: acct }] = await Promise.all([
    supabase
      .from("conversion_events")
      .select("contact_id, contact_name, event, source, campaign, utm_campaign, campaign_id, occurred_at, value")
      .eq("company_id", opts.companyId)
      .order("occurred_at", { ascending: true })
      .limit(8000),
    supabase
      .from("ad_spend")
      .select("campaign_id, campaign_name, spend")
      .eq("company_id", opts.companyId)
      .gte("spend_on", opts.from)
      .lte("spend_on", opts.to),
    admin
      .from("company_ad_accounts")
      .select("pixel_id, meta_ad_account_id, meta_access_token")
      .eq("company_id", opts.companyId)
      .maybeSingle(),
  ]);
  if (eErr) throw eErr;
  if (sErr) throw sErr;

  const rows = (events || []) as TouchRow[];
  const firstTouch = new Map<string, { label: string; campaignId: string | null }>();
  for (const r of rows) {
    const key = contactKey(r);
    if (!key || firstTouch.has(key)) continue;
    firstTouch.set(key, { label: campaignLabel(r), campaignId: r.campaign_id });
  }

  const buckets = new Map<string, PaidCampaignRow>();
  const bump = (label: string, campaignId: string | null) => {
    const key = (campaignId || label).toLowerCase();
    const row = buckets.get(key) || {
      key, label, spend: 0, leads: 0, quotes: 0, wins: 0, wonValue: 0, cpl: null, cpa: null, roas: null,
    };
    buckets.set(key, row);
    return row;
  };

  for (const r of rows) {
    if (r.occurred_at.slice(0, 10) < opts.from || r.occurred_at.slice(0, 10) > opts.to) continue;
    const key = contactKey(r);
    const touch = (key && firstTouch.get(key)) || { label: campaignLabel(r), campaignId: r.campaign_id };
    const row = bump(touch.label, touch.campaignId);
    if (r.event === "lead_in") row.leads++;
    if (r.event === "quote_sent") row.quotes++;
    if (r.event === "won") {
      row.wins++;
      row.wonValue += Number(r.value) || 0;
    }
  }

  let spendTotal = 0;
  for (const s of spendRows || []) {
    const spend = Number(s.spend) || 0;
    spendTotal += spend;
    const label = (s.campaign_name || s.campaign_id || "Unattributed").trim();
    const id = s.campaign_id || null;
    const match =
      (id && [...buckets.values()].find(b => b.key === id.toLowerCase())) ||
      [...buckets.values()].find(b => b.label.toLowerCase() === label.toLowerCase()) ||
      bump(label, id);
    match.spend += spend;
    if (id && match.label === "Unattributed") match.label = label;
  }

  const campaigns = [...buckets.values()]
    .map(r => ({
      ...r,
      cpl: r.leads > 0 ? r.spend / r.leads : null,
      cpa: r.wins > 0 ? r.spend / r.wins : null,
      roas: r.spend > 0 ? r.wonValue / r.spend : null,
    }))
    .sort((a, b) => b.spend - a.spend || b.wonValue - a.wonValue || b.leads - a.leads);

  const leads = campaigns.reduce((s, r) => s + r.leads, 0);
  const quotes = campaigns.reduce((s, r) => s + r.quotes, 0);
  const wins = campaigns.reduce((s, r) => s + r.wins, 0);
  const wonValue = campaigns.reduce((s, r) => s + r.wonValue, 0);

  return {
    spend: spendTotal,
    leads,
    quotes,
    wins,
    wonValue,
    cpl: leads > 0 ? spendTotal / leads : null,
    cpa: wins > 0 ? spendTotal / wins : null,
    roas: spendTotal > 0 ? wonValue / spendTotal : null,
    campaigns,
    connected: !!(acct?.meta_access_token && acct?.meta_ad_account_id),
    pixelId: acct?.pixel_id || null,
    adAccountId: acct?.meta_ad_account_id || null,
  };
}
