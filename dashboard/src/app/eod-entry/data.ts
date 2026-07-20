// Server-side data for the /eod-entry popup: per-company dropdown options and
// the contact's prior history. Options are SELF-LEARNING — the distinct
// values this company has actually logged (via the GHL webhook or this form),
// merged with a standard default list — so a new option added to a GHL custom
// field shows up here after its first webhook, no config. One-off typos are
// filtered by requiring 3+ uses for non-default values.

import { createAdminClient } from "@/lib/supabase/admin";

export type EodOptions = {
  stages: string[];
  outcomes: string[];
  sources: string[];
};

export type HistoryEntry = {
  date: string;   // YYYY-MM-DD
  label: string;  // "EOD update", "Quote sent", ...
  detail: string; // compact per-type summary
  person: string;
};

export type ContactHistory = {
  total: number;
  firstDate: string;
  lastDate: string;
  answered: number;
  didntAnswer: number;
  lastStage: string;
  quotes: number;
  quotedTotal: number; // sum of per-quote tier averages, dollars
  siteVisits: number;
  emails: number;
  jobsWon: number;
  topSource: string;
  recent: HistoryEntry[];
};

const DEFAULT_STAGES = ["New Leads", "Pre-Quote Follow Up", "Post Quote Follow Up"];
const DEFAULT_OUTCOMES = [
  "Requires Quoting",
  "Book Site Visit",
  "Verbal Confirmation",
  "Waiting on Photos",
  "Not a Good Time to Talk",
  "Not Ready Yet - Pre-Quote",
  "Not Ready Yet - Post Quote",
  "Lost - Price",
  "Lost - Time Related",
  "Lost - Priorities Changed",
  "DQ - Wrong Contact / Spam",
  "DQ - Out of Service Area",
  "DQ - Extent of Works",
  "DQ - Price",
  "DQ - Lead Looking for Work",
  "Abandoned - Not Responding",
  "Abandoned - Headache",
];
const DEFAULT_SOURCES = [
  "Facebook Ad Form",
  "Facebook Message",
  "Website Form",
  "Direct Phone Call",
  "Direct Email",
  "Direct Lead passed on from Client",
];

const EVENT_LABELS: Record<string, string> = {
  eod_update: "EOD update",
  quote_sent: "Quote sent",
  site_visit_booked: "Site visit",
  email_sent: "Email",
  job_won: "Job won",
};

type ActivityRow = {
  occurred_on: string;
  event_type: string;
  outcome: string | null;
  quote_job_value: string | null;
  sales_person_name: string | null;
  ad_source: string | null;
  appointment_at: string | null;
};

/** Mean of pipe-separated quote tiers (they're alternatives, never summed). */
function quoteGroupValue(raw: string | null): number {
  const parts = String(raw || "")
    .split("|")
    .map(v => parseFloat(v.replace(/[^0-9.]/g, "")))
    .filter(n => Number.isFinite(n) && n > 0);
  if (parts.length === 0) return 0;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

function mergeLearned(learned: Map<string, number>, defaults: string[]): string[] {
  const out = [...defaults];
  const known = new Set(defaults.map(d => d.toLowerCase()));
  const extras = [...learned.entries()]
    .filter(([v, n]) => n >= 3 && !known.has(v.toLowerCase()))
    .sort((a, b) => b[1] - a[1])
    .map(([v]) => v);
  return [...out, ...extras];
}

export async function fetchEodOptions(companyId: string): Promise<EodOptions> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("activities")
    .select("outcome")
    .eq("company_id", companyId)
    .eq("event_type", "eod_update")
    .order("occurred_on", { ascending: false })
    .limit(1000);

  const counts = [new Map<string, number>(), new Map<string, number>(), new Map<string, number>()];
  for (const row of data ?? []) {
    const parts = String(row.outcome || "").split("|").map(p => p.trim());
    // parts: 0=stage, 1=answered, 2=std outcome, 3=custom, 4=source
    for (const [slot, idx] of [[0, 0], [1, 2], [2, 4]] as const) {
      const v = parts[idx];
      if (v) counts[slot].set(v, (counts[slot].get(v) ?? 0) + 1);
    }
  }

  return {
    stages: mergeLearned(counts[0], DEFAULT_STAGES),
    outcomes: mergeLearned(counts[1], DEFAULT_OUTCOMES),
    sources: mergeLearned(counts[2], DEFAULT_SOURCES),
  };
}

export async function fetchContactHistory(
  companyId: string,
  contactId: string,
  contactName: string,
): Promise<ContactHistory | null> {
  if (!contactId && !contactName) return null;

  const supabase = createAdminClient();
  let query = supabase
    .from("activities")
    .select("occurred_on, event_type, outcome, quote_job_value, sales_person_name, ad_source, appointment_at")
    .eq("company_id", companyId)
    .order("occurred_on", { ascending: false })
    .limit(200);

  // Match by GHL contact id when we have it, plus case-insensitive exact name
  // (older rows predate contact ids). Quotes stripped from the name so it
  // can't break PostgREST's or() filter syntax.
  const safeName = contactName.replace(/["\\]/g, "").trim();
  if (contactId && safeName) {
    query = query.or(`contact_id.eq.${contactId},contact_name.ilike."${safeName}"`);
  } else if (contactId) {
    query = query.eq("contact_id", contactId);
  } else {
    query = query.ilike("contact_name", safeName);
  }

  const { data } = await query;
  const rows = (data ?? []) as ActivityRow[];
  if (rows.length === 0) return null;

  const h: ContactHistory = {
    total: rows.length,
    firstDate: rows[rows.length - 1].occurred_on,
    lastDate: rows[0].occurred_on,
    answered: 0,
    didntAnswer: 0,
    lastStage: "",
    quotes: 0,
    quotedTotal: 0,
    siteVisits: 0,
    emails: 0,
    jobsWon: 0,
    topSource: "",
    recent: [],
  };

  const sourceCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.ad_source) sourceCounts.set(row.ad_source, (sourceCounts.get(row.ad_source) ?? 0) + 1);
    switch (row.event_type) {
      case "eod_update": {
        const parts = String(row.outcome || "").split("|").map(p => p.trim());
        if (parts[1] === "Answered") h.answered++;
        else if (parts[1]) h.didntAnswer++;
        if (!h.lastStage && parts[0]) h.lastStage = parts[0]; // rows are newest-first
        break;
      }
      case "quote_sent":
        h.quotes++;
        h.quotedTotal += quoteGroupValue(row.quote_job_value);
        break;
      case "site_visit_booked":
        h.siteVisits++;
        break;
      case "email_sent":
        h.emails++;
        break;
      case "job_won":
        h.jobsWon++;
        break;
    }
  }
  h.topSource = [...sourceCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

  h.recent = rows.slice(0, 8).map(row => {
    let detail = "";
    if (row.event_type === "eod_update") {
      const parts = String(row.outcome || "").split("|").map(p => p.trim());
      detail = [parts[0], parts[1], parts[2]].filter(Boolean).join(" · ");
    } else if (row.event_type === "quote_sent" || row.event_type === "job_won") {
      const v = quoteGroupValue(row.quote_job_value);
      detail = v ? `$${Math.round(v).toLocaleString()}` : "";
    } else if (row.event_type === "site_visit_booked") {
      detail = row.appointment_at ? row.appointment_at.slice(0, 10) : "";
    } else {
      detail = String(row.outcome || "").slice(0, 60);
    }
    return {
      date: row.occurred_on,
      label: EVENT_LABELS[row.event_type] ?? row.event_type,
      detail,
      person: row.sales_person_name ?? "",
    };
  });

  return h;
}
