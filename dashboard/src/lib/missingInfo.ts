// Missing-information detection. Pure functions (no DB / no React) so the
// rules are easy to reason about and tweak in isolation — mirrors the shape of
// @/lib/duplicates.
//
// A "gap" is a field that SHOULD be filled for a given record but is blank.
// The rules are deliberately contextual so the page surfaces real omissions
// rather than every technically-nullable column:
//
//   Activities (only quote_sent / job_won / site_visit_booked are scanned —
//   eod_update & email_sent are aggregate rows with no per-contact detail):
//     • quote_sent / job_won → contact name + value (+ unattributed rep)
//     • site_visit_booked    → contact name + address + appointment time
//
//   Won jobs (the 'lost' stage is skipped — a dead deal isn't worth chasing):
//     • always → contact name (unless retainer) + job value
//     • comms  → commission amount
//     • invoiced / paid → invoice number
//     • paid   → paid date

// ── Activity scanning ────────────────────────────────────────────────────

// Event types worth scanning for gaps. Matches the columns we fetch on the page.
export const SCANNED_EVENT_TYPES = ["quote_sent", "job_won", "site_visit_booked"] as const;

export type ScanActivity = {
  id: string;
  company_id: string;
  sales_person_id: string | null;
  sales_person_name: string;
  occurred_on: string;
  event_type: string;
  contact_name: string | null;
  contact_address: string | null;
  outcome: string | null;
  quote_job_value: string | null;
  appointment_at: string | null;
};

export type ScanWonJob = {
  id: string;
  company_id: string;
  sales_person_id: string | null;
  contact_name: string | null;
  contact_address: string | null;
  contact_id: string | null;
  job_value: number | null;
  commission_amount: number | null;
  type: string;
  stage: string;
  verbal_at: string | null;
  approved_at: string | null;
  invoiced_at: string | null;
  paid_at: string | null;
  invoice_number: string | null;
  notes: string | null;
};

// A single missing field: `field` is the machine key, `label` is what the badge
// shows and what the edit drawer's input is labelled.
export type Gap = { field: string; label: string };

export type ActivityGaps = { row: ScanActivity; gaps: Gap[] };
export type WonJobGaps = { row: ScanWonJob; gaps: Gap[] };

// Blank = null, undefined, or whitespace-only.
function isBlank(v: string | null | undefined): boolean {
  return v == null || String(v).trim() === "";
}

export function activityGaps(a: ScanActivity): Gap[] {
  const gaps: Gap[] = [];
  const type = a.event_type;
  const wantsContact =
    type === "quote_sent" || type === "job_won" || type === "site_visit_booked";

  if (wantsContact && isBlank(a.contact_name)) {
    gaps.push({ field: "contact_name", label: "contact name" });
  }
  if ((type === "quote_sent" || type === "job_won") && isBlank(a.quote_job_value)) {
    gaps.push({ field: "quote_job_value", label: "value" });
  }
  if (type === "site_visit_booked") {
    if (isBlank(a.contact_address)) gaps.push({ field: "contact_address", label: "address" });
    if (isBlank(a.appointment_at)) gaps.push({ field: "appointment_at", label: "appointment time" });
  }
  // sales_person_name is NOT NULL and defaults to 'Unknown' when ingest can't
  // attribute the row — that's the real gap. A blank sales_person_id with a
  // real name is legitimate (owners / client-side staff stay unlinked), so we
  // do NOT flag that.
  if (wantsContact && (isBlank(a.sales_person_name) || a.sales_person_name === "Unknown")) {
    gaps.push({ field: "sales_person", label: "rep" });
  }

  return gaps;
}

export function wonJobGaps(w: ScanWonJob): Gap[] {
  if (w.stage === "lost") return [];

  const gaps: Gap[] = [];
  const invoicedOrLater = w.stage === "invoiced" || w.stage === "paid";

  if (w.type !== "retainer" && isBlank(w.contact_name)) {
    gaps.push({ field: "contact_name", label: "contact name" });
  }
  if (w.job_value == null) {
    gaps.push({ field: "job_value", label: "job $" });
  }
  if (w.type === "comms" && w.commission_amount == null) {
    gaps.push({ field: "commission_amount", label: "commission $" });
  }
  if (invoicedOrLater && isBlank(w.invoice_number)) {
    gaps.push({ field: "invoice_number", label: "invoice #" });
  }
  if (w.stage === "paid" && isBlank(w.paid_at)) {
    gaps.push({ field: "paid_at", label: "paid date" });
  }

  return gaps;
}

// Keep only records that actually have a gap.
export function scanActivities(rows: ScanActivity[]): ActivityGaps[] {
  return rows
    .map(row => ({ row, gaps: activityGaps(row) }))
    .filter(x => x.gaps.length > 0);
}

export function scanWonJobs(rows: ScanWonJob[]): WonJobGaps[] {
  return rows
    .map(row => ({ row, gaps: wonJobGaps(row) }))
    .filter(x => x.gaps.length > 0);
}
