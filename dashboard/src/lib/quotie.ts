// Quotie admin API integration. The endpoint returns a hierarchical
// platform → companies → users breakdown with both lifetime and "this month"
// aggregates. There's no arbitrary-date-range slicing — we expose what the
// API gives us, surfaced alongside our period-scoped EOD data.
//
// The breakdown is cached for 5 minutes via Next.js's request cache so the
// dashboard doesn't hammer the Quotie API on every page load.
//
// Attribution model (2026-05-24): each company now exposes
// `groups_by_lead_owner[]` which attributes wins/pipeline to whoever owns
// the lead (site-visit booker → GHL assigned → follow-up assignee → quote
// sender), not just whoever clicked Send. We prefer that over the old
// `users[].groups` (by quote sender) — see quotieByExec().

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

// Lead-owner attribution per company. Each row is the rollup for one user
// across every quote where they own the lead (priority: site-visit booker →
// GHL assigned → follow-up assignee → quote sender). Same group metrics as
// QuotieGroups, flattened alongside the user identity.
export type QuotieLeadOwner = {
  user_id: string;
  full_name: string;
  total_sent: number;
  sent_this_month: number;
  won: number;
  lost: number;
  expired: number;
  pending: number;
  pipeline_value: number;
  won_value: number;
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
  groups_by_lead_owner?: QuotieLeadOwner[];   // present if Quotie has wired it for this company
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

  // Bound the cold-path request (cache misses every 5 min) so a slow-but-not-
  // failing Quotie API can't stall the page indefinitely. The caller already
  // treats a throw as "no Quotie data" and renders without it.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Quotie ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
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
 * Per-exec roll-ups across all active Quotie companies. Prefers Quotie's
 * `groups_by_lead_owner` (lead-owner attribution) over `users[].groups`
 * (quote-sender attribution) so a quote sent by Jesse on behalf of a lead
 * Lachlan owns is credited to Lachlan, not Jesse.
 *
 * Falls back to `users[].groups` per-company if Quotie hasn't wired lead-
 * owner attribution for that company yet.
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

    const ownerRows = company.groups_by_lead_owner;
    if (ownerRows && ownerRows.length > 0) {
      // Lead-owner attribution (preferred). The lead-owner shape flattens
      // counts + groups; map back to our split QuotieCounts / QuotieGroups
      // shape so the UI layer doesn't need to know which path was used.
      for (const owner of ownerRows) {
        const ourName = OUR_EXEC_BY_QUOTIE_FULLNAME[owner.full_name];
        if (!ourName) continue;
        const slot = out[ourName];
        const quotes: QuotieCounts = {
          sent: owner.total_sent,
          sent_this_month: owner.sent_this_month,
          generated: 0,
          failed: 0,
        };
        const groups: QuotieGroups = {
          total_sent: owner.total_sent,
          sent_this_month: owner.sent_this_month,
          won: owner.won,
          lost: owner.lost,
          expired: owner.expired,
          pending: owner.pending,
          pipeline_value: owner.pipeline_value,
          won_value: owner.won_value,
        };
        addCounts(slot.quotes, quotes);
        addGroups(slot.groups, groups);
        slot.perCompany.push({
          quotieCompanyId: company.id,
          quotieCompanyName: company.name,
          ourClientName: ourClientByQuotieName[company.name] || null,
          quotes,
          groups,
        });
      }
    } else {
      // Fallback: quote-sender attribution.
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
 *
 * NOTE: this sums the WHOLE company in Quotie, which includes job-management
 * entries the client added themselves (recurring work, walk-ins) that no
 * sales exec touched. Prefer `quotieOurExecSlice` for surfaces that should
 * only reflect sales-exec-driven activity.
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

/**
 * Sales-exec-attributed Quotie totals — sums per-exec rollups (which use
 * lead-owner attribution), so client-added job-management entries that no
 * sales exec was involved in are excluded.
 */
export function quotieOurExecSlice(data: QuotieBreakdown): {
  quotes: QuotieCounts;
  groups: QuotieGroups;
} {
  const totals = { quotes: zeroCounts(), groups: zeroGroups() };
  const byExec = quotieByExec(data);
  for (const exec of Object.values(byExec)) {
    addCounts(totals.quotes, exec.quotes);
    addGroups(totals.groups, exec.groups);
  }
  return totals;
}

/**
 * Per-client rollup filtered to sales-exec-attributed activity only — built
 * from the `perCompany` slices of each exec aggregate. Keyed by our DB
 * client name.
 */
export function quotieByClientExecOnly(
  data: QuotieBreakdown,
): Record<string, { quotes: QuotieCounts; groups: QuotieGroups }> {
  const out: Record<string, { quotes: QuotieCounts; groups: QuotieGroups }> = {};
  const byExec = quotieByExec(data);
  for (const exec of Object.values(byExec)) {
    for (const slice of exec.perCompany) {
      if (!slice.ourClientName) continue;
      const slot = out[slice.ourClientName] ||= {
        quotes: zeroCounts(), groups: zeroGroups(),
      };
      addCounts(slot.quotes, slice.quotes);
      addGroups(slot.groups, slice.groups);
    }
  }
  return out;
}
