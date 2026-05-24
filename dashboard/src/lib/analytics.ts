// Heavier analytic queries used by /execs, /backlog, and the enhanced
// company drill-down. All RLS-scoped via the passed-in client. Every query
// is scoped to active companies — inactive clients are excluded from all
// dashboard views.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sumQuoteValues } from "./format";
import { mondayOf } from "./dates";

// Fetch the set of active company IDs. Cheap (one query, returns ~5 UUIDs).
// Every analytic that aggregates across companies must filter by this.
async function activeCompanyIds(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from("companies")
    .select("id")
    .eq("active", true);
  if (error) throw error;
  return (data || []).map(c => c.id);
}

// Supabase's default db-max-rows is 1000 — analytics windows blow past that
// once the dataset grows, so we page through. Each page is one round-trip;
// for our scale (~few-thousand rows per analytic window) this is 2-5 trips.
const PAGE_SIZE = 1000;
async function pageAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

export type ExecSummary = {
  name: string;
  companies: { id: string; name: string; slug: string; timezone: string }[];
  totals: {
    eod_update: number;
    quote_sent: number;
    job_won: number;
    site_visit_booked: number;
    email_sent: number;
    job_won_value: number;
  };
  lastActivityAt: string | null;
};

export type FunnelStages = {
  contacts: number;
  eod: number;
  visit: number;
  quote: number;
  won: number;
};

export type WeeklyBucket = { week_start: string; activity_count: number; won_value: number };

export type OutcomeRow = { outcome: string; n: number };

export type BacklogItem = {
  contact_id: string | null;
  contact_name: string | null;
  company_id: string;
  company_name: string;
  sales_person_name: string;
  last_event_type: string;
  last_event_at: string;
  last_event_value: number;
  days_open: number;
};

/* ─── Exec leaderboard ─────────────────────────────────────────────── */

export async function loadExecSummaries(
  supabase: SupabaseClient,
  options: { sinceDays?: number } = {},
): Promise<ExecSummary[]> {
  const sinceDays = options.sinceDays ?? 30;
  const since = new Date(Date.now() - sinceDays * 86400_000).toISOString().slice(0, 10);

  const activeIds = await activeCompanyIds(supabase);
  if (activeIds.length === 0) return [];

  // Pull all relevant activities once (paged), group in JS.
  const rows = await pageAll<{
    sales_person_name: string;
    sales_person_id: string;
    company_id: string;
    event_type: string;
    quote_job_value: string | null;
    created_at: string;
    occurred_on: string;
  }>((from, to) =>
    supabase
      .from("activities")
      .select("sales_person_name, sales_person_id, company_id, event_type, quote_job_value, created_at, occurred_on")
      .gte("occurred_on", since)
      .not("sales_person_id", "is", null)
      .in("company_id", activeIds)
      .range(from, to)
  );

  const { data: companiesData } = await supabase
    .from("companies")
    .select("id, name, slug, timezone")
    .eq("active", true);
  const companies = new Map((companiesData || []).map(c => [c.id, c]));

  const summaries = new Map<string, ExecSummary>();
  for (const r of rows) {
    const key = r.sales_person_name;
    let s = summaries.get(key);
    if (!s) {
      s = {
        name: key,
        companies: [],
        totals: { eod_update: 0, quote_sent: 0, job_won: 0, site_visit_booked: 0, email_sent: 0, job_won_value: 0 },
        lastActivityAt: null,
      };
      summaries.set(key, s);
    }
    const co = companies.get(r.company_id);
    if (co && !s.companies.find(c => c.id === co.id)) s.companies.push(co);

    if (r.event_type === "eod_update") s.totals.eod_update++;
    else if (r.event_type === "quote_sent") s.totals.quote_sent++;
    else if (r.event_type === "site_visit_booked") s.totals.site_visit_booked++;
    else if (r.event_type === "email_sent") s.totals.email_sent++;
    else if (r.event_type === "job_won") {
      s.totals.job_won++;
      s.totals.job_won_value += sumQuoteValues(r.quote_job_value);
    }

    if (!s.lastActivityAt || r.created_at > s.lastActivityAt) s.lastActivityAt = r.created_at;
  }

  return Array.from(summaries.values()).sort((a, b) => b.totals.job_won_value - a.totals.job_won_value);
}

/* ─── Per-exec deep dive ───────────────────────────────────────────── */

export async function loadExecDetail(
  supabase: SupabaseClient,
  name: string,
): Promise<{
  totals: ExecSummary["totals"];
  perCompany: { company: { id: string; name: string; slug: string }; totals: ExecSummary["totals"] }[];
  weekly: WeeklyBucket[];
  outcomes: OutcomeRow[];
  recent: { id: string; event_type: string; company_id: string; company_name: string; contact_name: string | null; outcome: string | null; quote_job_value: string | null; created_at: string }[];
}> {
  const { data: companiesData } = await supabase
    .from("companies")
    .select("id, name, slug");
  const companies = new Map((companiesData || []).map(c => [c.id, c]));

  // Last 12 weeks of this exec's activity — active companies only.
  const since = new Date(Date.now() - 84 * 86400_000).toISOString().slice(0, 10);
  const activeIds = await activeCompanyIds(supabase);
  const rows = await pageAll<{
    id: string;
    company_id: string;
    event_type: string;
    outcome: string | null;
    quote_job_value: string | null;
    occurred_on: string;
    contact_name: string | null;
    created_at: string;
  }>((from, to) =>
    supabase
      .from("activities")
      .select("id, company_id, event_type, outcome, quote_job_value, occurred_on, contact_name, created_at")
      .eq("sales_person_name", name)
      .gte("occurred_on", since)
      .in("company_id", activeIds)
      .order("created_at", { ascending: false })
      .range(from, to)
  );

  const totals: ExecSummary["totals"] = { eod_update: 0, quote_sent: 0, job_won: 0, site_visit_booked: 0, email_sent: 0, job_won_value: 0 };
  const perCompanyMap = new Map<string, ExecSummary["totals"]>();
  const weeklyMap = new Map<string, { activity_count: number; won_value: number }>();
  const outcomeMap = new Map<string, number>();

  for (const r of rows) {
    const t = totals;
    if (r.event_type === "eod_update") t.eod_update++;
    else if (r.event_type === "quote_sent") t.quote_sent++;
    else if (r.event_type === "site_visit_booked") t.site_visit_booked++;
    else if (r.event_type === "email_sent") t.email_sent++;
    else if (r.event_type === "job_won") {
      t.job_won++;
      t.job_won_value += sumQuoteValues(r.quote_job_value);
    }

    const co = perCompanyMap.get(r.company_id) || { eod_update: 0, quote_sent: 0, job_won: 0, site_visit_booked: 0, email_sent: 0, job_won_value: 0 };
    if (r.event_type === "eod_update") co.eod_update++;
    else if (r.event_type === "quote_sent") co.quote_sent++;
    else if (r.event_type === "site_visit_booked") co.site_visit_booked++;
    else if (r.event_type === "email_sent") co.email_sent++;
    else if (r.event_type === "job_won") { co.job_won++; co.job_won_value += sumQuoteValues(r.quote_job_value); }
    perCompanyMap.set(r.company_id, co);

    // Week bucket — Monday-based, computed in UTC.
    const wk = mondayOf(r.occurred_on);
    const w = weeklyMap.get(wk) || { activity_count: 0, won_value: 0 };
    w.activity_count++;
    if (r.event_type === "job_won") w.won_value += sumQuoteValues(r.quote_job_value);
    weeklyMap.set(wk, w);

    if (r.event_type === "eod_update" && r.outcome) {
      const head = r.outcome.split("|")[0].trim();
      if (head) outcomeMap.set(head, (outcomeMap.get(head) || 0) + 1);
    }
  }

  const perCompany = Array.from(perCompanyMap.entries())
    .map(([id, totals]) => ({ company: companies.get(id)!, totals }))
    .filter(x => x.company)
    .sort((a, b) => b.totals.job_won_value - a.totals.job_won_value);

  const weekly: WeeklyBucket[] = Array.from(weeklyMap.entries())
    .map(([week_start, v]) => ({ week_start, ...v }))
    .sort((a, b) => a.week_start.localeCompare(b.week_start));

  const outcomes: OutcomeRow[] = Array.from(outcomeMap.entries())
    .map(([outcome, n]) => ({ outcome, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 10);

  const recent = rows.slice(0, 30).map(r => ({
    ...r,
    company_name: companies.get(r.company_id)?.name || "?",
  }));

  return { totals, perCompany, weekly, outcomes, recent };
}

/* ─── Company funnel + outcomes ────────────────────────────────────── */

export async function loadCompanyAnalytics(
  supabase: SupabaseClient,
  companyId: string,
  sinceDays = 90,
): Promise<{
  funnel: FunnelStages;
  outcomes: OutcomeRow[];
  weekly: WeeklyBucket[];
  sources: OutcomeRow[];
}> {
  const since = new Date(Date.now() - sinceDays * 86400_000).toISOString().slice(0, 10);

  const rows = await pageAll<{
    event_type: string;
    outcome: string | null;
    ad_source: string | null;
    contact_id: string | null;
    quote_job_value: string | null;
    occurred_on: string;
  }>((from, to) =>
    supabase
      .from("activities")
      .select("event_type, outcome, ad_source, contact_id, quote_job_value, occurred_on")
      .eq("company_id", companyId)
      .gte("occurred_on", since)
      .range(from, to)
  );

  // Funnel: contacts (distinct contact_id) × stages they touched
  const byContact = new Map<string, { eod: boolean; visit: boolean; quote: boolean; won: boolean }>();
  const outcomeMap = new Map<string, number>();
  const sourceMap = new Map<string, number>();
  const weeklyMap = new Map<string, { activity_count: number; won_value: number }>();

  for (const r of rows) {
    // Funnel
    if (r.contact_id) {
      const c = byContact.get(r.contact_id) || { eod: false, visit: false, quote: false, won: false };
      if (r.event_type === "eod_update") c.eod = true;
      if (r.event_type === "site_visit_booked") c.visit = true;
      if (r.event_type === "quote_sent") c.quote = true;
      if (r.event_type === "job_won") c.won = true;
      byContact.set(r.contact_id, c);
    }
    // Outcomes (from EOD updates)
    if (r.event_type === "eod_update" && r.outcome) {
      const head = r.outcome.split("|")[0].trim();
      if (head) outcomeMap.set(head, (outcomeMap.get(head) || 0) + 1);
    }
    // Sources — skip empty/junk values
    if (r.ad_source) {
      const src = r.ad_source.trim();
      if (src && src !== "0" && !/^\d+(\.\d+)?$/.test(src)) {
        sourceMap.set(src, (sourceMap.get(src) || 0) + 1);
      }
    }
    // Weekly buckets — Monday-based, computed in UTC.
    const wk = mondayOf(r.occurred_on);
    const w = weeklyMap.get(wk) || { activity_count: 0, won_value: 0 };
    w.activity_count++;
    if (r.event_type === "job_won") w.won_value += sumQuoteValues(r.quote_job_value);
    weeklyMap.set(wk, w);
  }

  let eod = 0, visit = 0, quote = 0, won = 0;
  for (const c of byContact.values()) {
    if (c.eod) eod++;
    if (c.visit) visit++;
    if (c.quote) quote++;
    if (c.won) won++;
  }

  const funnel: FunnelStages = { contacts: byContact.size, eod, visit, quote, won };
  const outcomes: OutcomeRow[] = Array.from(outcomeMap.entries())
    .map(([outcome, n]) => ({ outcome, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);
  const sources: OutcomeRow[] = Array.from(sourceMap.entries())
    .map(([outcome, n]) => ({ outcome, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);
  const weekly: WeeklyBucket[] = Array.from(weeklyMap.entries())
    .map(([week_start, v]) => ({ week_start, ...v }))
    .sort((a, b) => a.week_start.localeCompare(b.week_start));

  return { funnel, outcomes, weekly, sources };
}

/* ─── Backlog: open quotes + scheduled visits ──────────────────────── */

export async function loadBacklog(supabase: SupabaseClient): Promise<{
  openQuotes: BacklogItem[];
  pendingVisits: BacklogItem[];
}> {
  // Active companies only — inactive clients don't appear in the backlog.
  const { data: companies } = await supabase
    .from("companies")
    .select("id, name")
    .eq("active", true);
  const companyName = new Map((companies || []).map(c => [c.id, c.name]));
  const activeIds = Array.from(companyName.keys());

  // Pull last 180 days of contact-bearing activity and process in JS.
  const since = new Date(Date.now() - 180 * 86400_000).toISOString().slice(0, 10);
  type BacklogRow = {
    contact_id: string | null;
    contact_name: string | null;
    company_id: string;
    sales_person_name: string;
    event_type: string;
    quote_job_value: string | null;
    created_at: string;
    occurred_on: string;
  };
  const rows = activeIds.length === 0 ? [] : await pageAll<BacklogRow>((from, to) =>
    supabase
      .from("activities")
      .select("contact_id, contact_name, company_id, sales_person_name, event_type, quote_job_value, created_at, occurred_on")
      .gte("occurred_on", since)
      .not("contact_id", "is", null)
      .in("company_id", activeIds)
      .order("created_at", { ascending: false })
      .range(from, to)
  );

  // Latest event per contact
  const latest = new Map<string, BacklogRow>();
  const byContact = new Map<string, BacklogRow[]>();
  for (const r of rows) {
    const key = `${r.company_id}|${r.contact_id}`;
    if (!latest.has(key)) latest.set(key, r);
    const arr = byContact.get(key) || [];
    arr.push(r);
    byContact.set(key, arr);
  }

  const openQuotes: BacklogItem[] = [];
  const pendingVisits: BacklogItem[] = [];
  const now = Date.now();

  for (const [key, last] of latest.entries()) {
    if (!last) continue;
    const days = Math.floor((now - new Date(last.created_at).getTime()) / 86400_000);
    const all = byContact.get(key)!;
    const hasWin = all.some(r => r.event_type === "job_won");
    if (hasWin) continue;     // closed → not in backlog

    const item: BacklogItem = {
      contact_id: last.contact_id,
      contact_name: last.contact_name,
      company_id: last.company_id,
      company_name: companyName.get(last.company_id) || "?",
      sales_person_name: last.sales_person_name,
      last_event_type: last.event_type,
      last_event_at: last.created_at,
      last_event_value: sumQuoteValues(last.quote_job_value),
      days_open: days,
    };

    if (last.event_type === "quote_sent") openQuotes.push(item);
    else if (last.event_type === "site_visit_booked") pendingVisits.push(item);
  }

  openQuotes.sort((a, b) => b.last_event_value - a.last_event_value || b.days_open - a.days_open);
  pendingVisits.sort((a, b) => a.days_open - b.days_open);

  return { openQuotes, pendingVisits };
}
