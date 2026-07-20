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
  /** The contact's name as recorded in our DB — more reliable than the
   *  extension's DOM scrape, which can pick up page headings ("Contacts"). */
  canonicalName: string;
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
  contact_id: string | null;
  contact_name: string | null;
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

// ─── GHL contact lookup ──────────────────────────────────────────────
// The authoritative name source. GHL_LOCATION_TOKENS is a JSON map of
// { "<ghl location id>": "<private integration token>" } — each sub-account
// issues its own token (Settings → Private Integrations, View Contacts
// scope). DOM scraping in the extension is the fallback when a location has
// no token; it's fragile (GHL headings, i18n keys), hence this.

export async function fetchGhlContactName(
  ghlLocationId: string,
  contactId: string,
): Promise<string> {
  if (!ghlLocationId || !contactId) return "";
  let tokens: Record<string, string>;
  try {
    tokens = JSON.parse(process.env.GHL_LOCATION_TOKENS || "{}");
  } catch {
    return "";
  }
  const token = tokens[ghlLocationId];
  if (!token) return "";

  try {
    const res = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
      headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28" },
      cache: "no-store",
    });
    if (!res.ok) return "";
    const body = await res.json();
    const c = body?.contact ?? {};
    const name =
      [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
      String(c.contactName || "").trim();
    return name;
  } catch {
    return "";
  }
}

// Obvious non-names from GHL page furniture: section headings and raw i18n
// keys (dot-separated tokens like "snapshots.loadSnapshotsTemplate.x").
const JUNK_NAMES = new Set([
  "contacts", "contact", "conversations", "opportunities", "activity",
  "notes", "tasks", "appointments", "associations", "documents",
]);

export function cleanScrapedName(raw: string): string {
  const text = (raw || "").trim();
  if (!text || text.length > 80) return "";
  if (JUNK_NAMES.has(text.toLowerCase())) return "";
  if (/^[\w-]+(\.[\w-]+)+$/.test(text)) return ""; // i18n key, not a name
  return text;
}

// ─── Today / Me tabs ─────────────────────────────────────────────────

export type DayTally = {
  eodUpdates: number;
  answered: number;
  didntAnswer: number;
  quotes: number;
  quotedTotal: number;
  siteVisits: number;
  emails: number;
  jobsWon: number;
};

export type CompanyToday = {
  tally: DayTally;
  perPerson: { name: string; tally: DayTally }[];
};

export type MyToday = {
  total: DayTally;
  perCompany: { company: string; date: string; tally: DayTally }[];
};

const emptyTally = (): DayTally => ({
  eodUpdates: 0, answered: 0, didntAnswer: 0,
  quotes: 0, quotedTotal: 0, siteVisits: 0, emails: 0, jobsWon: 0,
});

type TallyRow = { event_type: string; outcome: string | null; quote_job_value: string | null };

function addToTally(t: DayTally, row: TallyRow) {
  switch (row.event_type) {
    case "eod_update": {
      t.eodUpdates++;
      const answered = String(row.outcome || "").split("|")[1]?.trim();
      if (answered === "Answered") t.answered++;
      else if (answered) t.didntAnswer++;
      break;
    }
    case "quote_sent":
      t.quotes++;
      t.quotedTotal += quoteGroupValue(row.quote_job_value);
      break;
    case "site_visit_booked": t.siteVisits++; break;
    case "email_sent": t.emails++; break;
    case "job_won": t.jobsWon++; break;
  }
}

/** Today's activity for one company, with a per-exec breakdown. */
export async function fetchCompanyToday(companyId: string, date: string): Promise<CompanyToday> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("activities")
    .select("event_type, outcome, quote_job_value, sales_person_name")
    .eq("company_id", companyId)
    .eq("occurred_on", date)
    .limit(2000);

  const tally = emptyTally();
  const byPerson = new Map<string, DayTally>();
  for (const row of data ?? []) {
    addToTally(tally, row);
    const name = row.sales_person_name || "Team";
    if (!byPerson.has(name)) byPerson.set(name, emptyTally());
    addToTally(byPerson.get(name)!, row);
  }

  const perPerson = [...byPerson.entries()]
    .map(([name, t]) => ({ name, tally: t }))
    .sort((a, b) => (b.tally.eodUpdates + b.tally.quotes) - (a.tally.eodUpdates + a.tally.quotes));
  return { tally, perPerson };
}

/**
 * One exec's day across every active client. "Today" is evaluated in each
 * company's own timezone, matching how occurred_on is written.
 */
export async function fetchMyToday(
  execName: string,
  todayFor: (timezone: string) => string,
): Promise<MyToday> {
  const supabase = createAdminClient();
  const { data: companies } = await supabase
    .from("companies")
    .select("id, name, timezone")
    .eq("active", true)
    .order("name");

  const total = emptyTally();
  const perCompany: MyToday["perCompany"] = [];

  await Promise.all(
    (companies ?? []).map(async c => {
      const date = todayFor(c.timezone);
      const { data } = await supabase
        .from("activities")
        .select("event_type, outcome, quote_job_value")
        .eq("company_id", c.id)
        .eq("occurred_on", date)
        .eq("sales_person_name", execName)
        .limit(2000);
      if (!data || data.length === 0) return;
      const tally = emptyTally();
      for (const row of data) addToTally(tally, row);
      perCompany.push({ company: c.name, date, tally });
    }),
  );

  perCompany.sort((a, b) => (b.tally.eodUpdates + b.tally.quotes) - (a.tally.eodUpdates + a.tally.quotes));
  for (const c of perCompany) {
    total.eodUpdates += c.tally.eodUpdates;
    total.answered += c.tally.answered;
    total.didntAnswer += c.tally.didntAnswer;
    total.quotes += c.tally.quotes;
    total.quotedTotal += c.tally.quotedTotal;
    total.siteVisits += c.tally.siteVisits;
    total.emails += c.tally.emails;
    total.jobsWon += c.tally.jobsWon;
  }
  return { total, perCompany };
}

/** All active exec names across all active clients (deduped, sorted). */
export async function fetchAllExecNames(): Promise<string[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("sales_people")
    .select("name, companies!inner(active)")
    .eq("active", true)
    .eq("companies.active", true);
  return [...new Set((data ?? []).map(p => p.name))].sort();
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
    .select("occurred_on, event_type, outcome, quote_job_value, sales_person_name, ad_source, appointment_at, contact_id, contact_name")
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

  // Newest row with the exact contact id wins; any named row is the fallback.
  const canonicalName =
    (contactId && rows.find(r => r.contact_id === contactId && r.contact_name?.trim())?.contact_name) ||
    rows.find(r => r.contact_name?.trim())?.contact_name ||
    "";

  const h: ContactHistory = {
    canonicalName: canonicalName.trim(),
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
