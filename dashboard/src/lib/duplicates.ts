// Duplicate detection for activity rows. Pure functions (no DB / no React) so
// the rules are easy to reason about and test in isolation.
//
// Rules (chosen with Lachlan — see the Duplicates page):
//   • job_won / quote_sent → same company + same customer + same value.
//        Date and salesperson are ignored. "$5,000" == "5000"; pipe-delimited
//        quote tiers are compared as a SET so "1200|3500" == "3500|1200".
//   • site_visit_booked   → same company + same person + same calendar day.
//        A visit re-booked on a LATER day is a genuine second visit, not a dup.
//
// A "cluster" is any group of 2+ rows sharing a key. The oldest row is the
// suggested keep; the rest are candidate deletions.

export const SCANNED_EVENT_TYPES = ["job_won", "quote_sent", "site_visit_booked"] as const;
export type ScannedEventType = (typeof SCANNED_EVENT_TYPES)[number];

export type DupActivity = {
  id: string;
  company_id: string;
  sales_person_id: string | null;
  sales_person_name: string;
  occurred_on: string;            // YYYY-MM-DD
  event_type: string;
  contact_name: string | null;
  contact_address: string | null;
  quote_job_value: string | null;
  appointment_at: string | null;
  source: string;
  created_at: string;             // ISO timestamp
};

export type DupCluster = {
  key: string;
  company_id: string;
  event_type: string;
  // What the rows have in common, for the card header:
  contact_name: string;           // display name from the first row
  value: string | null;           // raw quote_job_value (jobs/quotes only)
  occurred_on: string | null;     // the shared day (site visits only)
  rows: DupActivity[];            // sorted oldest-first; rows[0] is the keep suggestion
};

// Normalize a contact name for matching: lowercase, drop punctuation, collapse
// whitespace. "J. Smith" and "J Smith" both become "j smith".
export function normName(raw: string | null | undefined): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Canonical form of a (possibly pipe-delimited) quote value. Strips currency
// symbols/commas, drops empty/zero parts, then SORTS the tiers so order doesn't
// matter. "$3,500 | $1,200" → "1200|3500". Empty if no positive number found.
export function normValue(raw: string | null | undefined): string {
  if (!raw) return "";
  const parts = String(raw)
    .split("|")
    .map(v => Number(v.replace(/[^\d.]/g, "")))
    .filter(n => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b)
    .map(n => String(n));
  return parts.join("|");
}

// Build the grouping key for a row, or null if the row lacks the fields needed
// to match confidently (so we never cluster on blanks).
function clusterKey(row: DupActivity): string | null {
  const name = normName(row.contact_name);
  if (!name) return null;

  if (row.event_type === "job_won" || row.event_type === "quote_sent") {
    const value = normValue(row.quote_job_value);
    if (!value) return null; // "same value" is meaningless without a value
    return `${row.company_id}|${row.event_type}|${name}|${value}`;
  }

  if (row.event_type === "site_visit_booked") {
    if (!row.occurred_on) return null;
    return `${row.company_id}|site_visit_booked|${name}|${row.occurred_on}`;
  }

  return null;
}

// Oldest first: occurred_on, then created_at as the tie-breaker.
function byOldest(a: DupActivity, b: DupActivity): number {
  if (a.occurred_on !== b.occurred_on) return a.occurred_on < b.occurred_on ? -1 : 1;
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}

export function findDuplicateClusters(rows: DupActivity[]): DupCluster[] {
  const groups = new Map<string, DupActivity[]>();
  for (const row of rows) {
    const key = clusterKey(row);
    if (!key) continue;
    const arr = groups.get(key);
    if (arr) arr.push(row);
    else groups.set(key, [row]);
  }

  const clusters: DupCluster[] = [];
  for (const [key, groupRows] of groups) {
    if (groupRows.length < 2) continue;
    groupRows.sort(byOldest);
    const first = groupRows[0];
    clusters.push({
      key,
      company_id: first.company_id,
      event_type: first.event_type,
      contact_name: first.contact_name || "—",
      value: first.event_type === "site_visit_booked" ? null : first.quote_job_value,
      occurred_on: first.event_type === "site_visit_booked" ? first.occurred_on : null,
      rows: groupRows,
    });
  }

  // Biggest / most-redundant clusters first, then newest activity first so the
  // freshest dupes (the ones polluting this week's report) float to the top.
  clusters.sort((a, b) => {
    if (b.rows.length !== a.rows.length) return b.rows.length - a.rows.length;
    const aLast = a.rows[a.rows.length - 1].occurred_on;
    const bLast = b.rows[b.rows.length - 1].occurred_on;
    return aLast < bLast ? 1 : aLast > bLast ? -1 : 0;
  });

  return clusters;
}
