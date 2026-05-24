// Quotie admin API integration. The endpoint returns a hierarchical
// platform → companies → users breakdown with both lifetime and "this month"
// aggregates. There's no arbitrary-date-range slicing — we expose what the
// API gives us, surfaced alongside our period-scoped EOD data.
//
// The breakdown is cached for 5 minutes via Next.js's request cache so the
// dashboard doesn't hammer the Quotie API on every page load.

import { unstable_cache } from "next/cache";

export type QuotieCounts = {
  sent: number;
  sent_this_month: number;
  generated: number;
  failed: number;
};

export type QuotieGroups = {
  total_sent: number;
  sent_this_month: number;
  won: number;
  lost: number;
  expired: number;
  pending: number;
  pipeline_value: number;
  won_value: number;
};

export type QuotieUser = {
  id: string;
  full_name: string;
  app_role: string;
  quotes: QuotieCounts;
  groups: QuotieGroups;
};

export type QuotieCompany = {
  id: string;
  name: string;
  status: "active" | "archived" | string;
  user_count: number;
  created_at: string;
  quotes: QuotieCounts;
  groups: QuotieGroups;
  users: QuotieUser[];
};

export type QuotieBreakdown = {
  platform: {
    companies: { total: number; active: number; archived: number };
    users: { total: number; by_role: Record<string, number> };
    quotes: QuotieCounts;
    groups: QuotieGroups;
    api_usage: { requests_today: number; requests_this_month: number };
  };
  companies: QuotieCompany[];
};

// Explicit mapping: our DB client name → Quotie company name. Hardcoded
// because fuzzy matching is fragile (e.g. "Lachlan Williams" at Coastal
// Cleans is not our Lachlan).
const QUOTIE_COMPANY_BY_OURS: Record<string, string> = {
  "Bolton EC":            "Bolton EC - Solar",
  "HDK Long Run Roofing": "HDK Longrun Roofing",
  "Hughes Electrical":    "Hughes Electrical Group",
};

// Our sales roster → Quotie's full_name. Full-name match (not first name)
// so we don't accidentally pull in someone else with the same first name
// (e.g. Lachlan Williams at Coastal Cleans is not our Lachlan).
const QUOTIE_FULLNAME_BY_OURS: Record<string, string> = {
  "Lachlan": "Lachlan Boys",
  "Buzz":    "Buzz Brady",
  "Zac":     "Zac Russell",
};

const OUR_EXEC_BY_QUOTIE_FULLNAME = Object.fromEntries(
  Object.entries(QUOTIE_FULLNAME_BY_OURS).map(([ours, q]) => [q, ours]),
);

async function fetchBreakdown(): Promise<QuotieBreakdown> {
  const url = process.env.QUOTIE_API_URL;
  const key = process.env.QUOTIE_API_KEY;
  if (!url || !key) throw new Error("QUOTIE_API_URL / QUOTIE_API_KEY not set");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Quotie ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

export const loadQuotieBreakdown = unstable_cache(
  fetchBreakdown,
  ["quotie-admin-breakdown"],
  { revalidate: 300, tags: ["quotie"] },
);

/**
 * Resolve the Quotie company that maps to a given DB client name.
 * Returns undefined if no mapping exists or the Quotie company is archived.
 */
export function quotieCompanyFor(
  data: QuotieBreakdown,
  ourClientName: string,
): QuotieCompany | undefined {
  const target = QUOTIE_COMPANY_BY_OURS[ourClientName];
  if (!target) return undefined;
  return data.companies.find(c => c.name === target && c.status === "active");
}

export type QuotieExecAggregate = {
  ourName: string;            // e.g. "Lachlan"
  quotieFullName: string;     // e.g. "Lachlan Boys"
  // Roll-up of this exec across every active Quotie company they appear in
  quotes: QuotieCounts;
  groups: QuotieGroups;
  perCompany: Array<{
    quotieCompanyId: string;
    quotieCompanyName: string;
    ourClientName: string | null;     // null if Quotie has them at a company we don't track
    quotes: QuotieCounts;
    groups: QuotieGroups;
  }>;
};

function zeroCounts(): QuotieCounts {
  return { sent: 0, sent_this_month: 0, generated: 0, failed: 0 };
}

function zeroGroups(): QuotieGroups {
  return {
    total_sent: 0, sent_this_month: 0, won: 0, lost: 0, expired: 0, pending: 0,
    pipeline_value: 0, won_value: 0,
  };
}

function addCounts(a: QuotieCounts, b: QuotieCounts) {
  a.sent += b.sent;
  a.sent_this_month += b.sent_this_month;
  a.generated += b.generated;
  a.failed += b.failed;
}

function addGroups(a: QuotieGroups, b: QuotieGroups) {
  a.total_sent += b.total_sent;
  a.sent_this_month += b.sent_this_month;
  a.won += b.won;
  a.lost += b.lost;
  a.expired += b.expired;
  a.pending += b.pending;
  a.pipeline_value += b.pipeline_value;
  a.won_value += b.won_value;
}

/**
 * Per-exec roll-ups across all active Quotie companies. We sum each exec's
 * numbers from every company they appear in, ignoring archived companies and
 * Quotie users that don't match our sales roster.
 */
export function quotieByExec(
  data: QuotieBreakdown,
): Record<string, QuotieExecAggregate> {
  const ourClientByQuotieName = Object.fromEntries(
    Object.entries(QUOTIE_COMPANY_BY_OURS).map(([ours, q]) => [q, ours]),
  );

  const out: Record<string, QuotieExecAggregate> = {};
  for (const ourName of Object.keys(QUOTIE_FULLNAME_BY_OURS)) {
    out[ourName] = {
      ourName,
      quotieFullName: QUOTIE_FULLNAME_BY_OURS[ourName],
      quotes: zeroCounts(),
      groups: zeroGroups(),
      perCompany: [],
    };
  }

  for (const company of data.companies) {
    if (company.status !== "active") continue;
    for (const user of company.users) {
      const ourName = OUR_EXEC_BY_QUOTIE_FULLNAME[user.full_name];
      if (!ourName) continue;
      const slot = out[ourName];
      addCounts(slot.quotes, user.quotes);
      addGroups(slot.groups, user.groups);
      slot.perCompany.push({
        quotieCompanyId: company.id,
        quotieCompanyName: company.name,
        ourClientName: ourClientByQuotieName[company.name] || null,
        quotes: user.quotes,
        groups: user.groups,
      });
    }
  }
  return out;
}

/**
 * Per-client Quotie rollup keyed by our DB client name (only clients we
 * actually map to a Quotie company are included).
 */
export function quotieByClient(
  data: QuotieBreakdown,
): Record<string, QuotieCompany> {
  const out: Record<string, QuotieCompany> = {};
  for (const ours of Object.keys(QUOTIE_COMPANY_BY_OURS)) {
    const co = quotieCompanyFor(data, ours);
    if (co) out[ours] = co;
  }
  return out;
}

/**
 * Platform-level rollup limited to our roster execs + mapped clients.
 * (The raw platform.* totals include Coastal Cleans, archived companies,
 * other staff — we want just our slice.)
 */
export function quotieOurSlice(data: QuotieBreakdown): {
  quotes: QuotieCounts;
  groups: QuotieGroups;
} {
  const totals = { quotes: zeroCounts(), groups: zeroGroups() };
  const byClient = quotieByClient(data);
  for (const company of Object.values(byClient)) {
    addCounts(totals.quotes, company.quotes);
    addGroups(totals.groups, company.groups);
  }
  return totals;
}
