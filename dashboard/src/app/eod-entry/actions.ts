"use server";

// Submission path for the GHL-embedded /eod-entry form. Mirrors
// createManualActivities (activities/actions.ts) but authorises via the
// signed company token instead of a Supabase session: the token pins the
// company, and the sales person is checked against that company's roster
// with the service-role client. The backend endpoint trusts this server via
// WEBHOOK_SECRET, so every field must be validated HERE.

import { verifyEodEntryToken } from "@/lib/eodEntryToken";
import { createAdminClient } from "@/lib/supabase/admin";
import { moveEodOpportunity } from "./ghlPipeline";
import {
  ALLOWED_EVENT_TYPES,
  buildSheetActivities,
  isIsoDate,
  isMeaningful,
  postManualActivities,
  type EventType,
  type NewActivityItem,
} from "@/lib/manualActivities";

export type EodEntryInput = {
  token: string;
  ghl_location_id?: string; // required with the "agency" token (browser extension)
  sales_person: string; // roster name, or "" = team (no exec attribution)
  occurred_on: string;  // YYYY-MM-DD
  event_type: EventType;
  items: NewActivityItem[];
  // EOD call-log values, discrete — used to mirror onto the GHL contact's
  // custom fields so the location's pipeline workflow fires.
  eod_fields?: { stage: string; answered: string; std_outcome: string };
  /** When logging a site visit that came from a GHL calendar pending row. */
  pending_site_visit_id?: string;
};

export type EodEntryResult =
  | { ok: true; count: number; pipeline?: string; pipelineOk?: boolean } // pipeline: what happened ("moved to X") or a skip/fail reason
  | { ok: false; error: string };

/** Postgres-safe appointment timestamp from local/ISO-ish strings. */
function toMachineAppointmentAt(
  appointmentAt?: string,
  appointmentDisplay?: string,
): string {
  const candidates = [appointmentAt, appointmentDisplay].map(s => String(s || "").trim()).filter(Boolean);
  for (const s of candidates) {
    // Already ISO / datetime-local: 2026-07-31T15:30 or 2026-07-31 15:30:00
    const m = s.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})(?::(\d{2}))?/);
    if (m) return `${m[1]}T${m[2]}:${m[3] || "00"}`;
    // Skip human AU strings like 31/07/2026 3:30 PM
    if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) continue;
    if (/\b(am|pm)\b/i.test(s) && !/^\d{4}-\d{2}-\d{2}/.test(s)) continue;
  }
  return "";
}

export type CompleteSiteVisitInput = {
  token: string;
  ghl_location_id?: string;
  pending_id: string;
  sales_person: string;
  occurred_on: string; // booking-set date YYYY-MM-DD
  contact_name: string;
  contact_id?: string;
  contact_phone?: string;
  contact_email?: string;
  contact_address?: string;
  appointment_display?: string;
  appointment_at?: string; // datetime-local if any
  booked_on?: string;
  vertical: "roofing" | "solar";
  rough_job_value?: string;
  ideal_start_date?: string;
  details_comment?: string;
  previous_quotes?: { date: string; value: string; person: string }[];
};

/** Log a pending calendar booking: dual-write activity + Slack summary. */
export async function completePendingSiteVisit(
  input: CompleteSiteVisitInput,
): Promise<EodEntryResult> {
  const slug = verifyEodEntryToken(input.token || "");
  if (!slug) return { ok: false, error: "This entry link is no longer valid" };
  if (!input.pending_id?.trim()) return { ok: false, error: "Missing pending visit" };
  if (!isIsoDate(input.occurred_on)) return { ok: false, error: "Date must be YYYY-MM-DD" };

  const supabase = createAdminClient();
  let query = supabase.from("companies").select("id, name, slug, active");
  if (slug === "agency") {
    if (!input.ghl_location_id) return { ok: false, error: "Missing GHL location" };
    query = query.eq("ghl_location_id", input.ghl_location_id);
  } else {
    query = query.eq("slug", slug);
  }
  const { data: company } = await query.single();
  if (!company || !company.active) return { ok: false, error: "Client not found" };

  let salesPersonName = "Team";
  if (input.sales_person) {
    const { data: person } = await supabase
      .from("sales_people")
      .select("name")
      .eq("company_id", company.id)
      .eq("name", input.sales_person)
      .eq("active", true)
      .maybeSingle();
    if (!person) return { ok: false, error: "That sales person isn't on this client's roster" };
    salesPersonName = person.name;
  }

  // Compact outcome for the activity log / EOD reports (Slack gets the full summary).
  const outcomeBits =
    input.vertical === "roofing"
      ? [
          input.rough_job_value ? `Rough $${String(input.rough_job_value).replace(/[$,\s]/g, "")}` : "",
          input.ideal_start_date ? `Start ${input.ideal_start_date}` : "",
          input.details_comment?.trim() || "",
        ]
      : [input.details_comment?.trim() || ""];
  const outcome = outcomeBits.filter(Boolean).join(" · ");

  const items: NewActivityItem[] = [
    {
      contact_name: input.contact_name,
      contact_id: input.contact_id,
      contact_address: input.contact_address,
      appointment_at: input.appointment_at || "",
      outcome,
      ad_source: "",
    },
  ];
  if (!isMeaningful(items[0])) {
    return { ok: false, error: "Contact name is required" };
  }

  const activities = buildSheetActivities(
    input.occurred_on,
    "site_visit_booked",
    salesPersonName,
    items,
  );
  // DB/sheet need a parseable timestamp — NEVER the AU display string
  // (e.g. "31/07/2026 3:30 PM" blows up Postgres). Prefer ISO-ish
  // appointment_at; fall back to raw display only if it looks machine-safe.
  const machineAppt = toMachineAppointmentAt(
    input.appointment_at,
    input.appointment_display,
  );
  if (machineAppt) {
    activities[0].appointmentDateTime = machineAppt;
  }
  const posted = await postManualActivities(company.name, activities);
  if (!posted.ok) return posted;

  // Slack booking summary on the client's EOD channel.
  let slackOk = false;
  const base = process.env.NODE_SERVICE_URL;
  const secret = process.env.WEBHOOK_SECRET;
  if (base) {
    try {
      const res = await fetch(new URL("/api/site-visit-summary", base).toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
        },
        body: JSON.stringify({
          companyName: company.name,
          salesPerson: salesPersonName,
          contactName: input.contact_name,
          contactPhone: input.contact_phone || "",
          contactEmail: input.contact_email || "",
          contactAddress: input.contact_address || "",
          appointmentDisplay: input.appointment_display || input.appointment_at || "",
          appointmentAt: input.appointment_at || "",
          bookedOn: input.booked_on || input.occurred_on,
          vertical: input.vertical,
          roughJobValue: input.rough_job_value || "",
          idealStartDate: input.ideal_start_date || "",
          detailsComment: input.details_comment || "",
          previousQuotes: input.previous_quotes || [],
        }),
        cache: "no-store",
      });
      slackOk = res.ok;
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        console.error("[completePendingSiteVisit] slack", res.status, t.slice(0, 200));
      }
    } catch (e) {
      console.error("[completePendingSiteVisit] slack", (e as Error).message);
    }
  }

  const { error: resolveErr } = await supabase
    .from("pending_site_visits")
    .update({
      resolved_at: new Date().toISOString(),
      rough_job_value: input.rough_job_value || null,
      ideal_start_date: input.ideal_start_date || null,
      details_comment: input.details_comment || null,
      vertical: input.vertical,
      summary_sent_at: slackOk ? new Date().toISOString() : null,
    })
    .eq("id", input.pending_id.trim())
    .eq("company_id", company.id)
    .is("resolved_at", null);
  if (resolveErr) {
    console.error("[completePendingSiteVisit] resolve:", resolveErr.message);
  }

  return {
    ...posted,
    pipeline: slackOk ? "Slack summary sent" : "Logged (Slack summary not sent)",
    pipelineOk: slackOk,
  };
}

export async function submitEodEntry(input: EodEntryInput): Promise<EodEntryResult> {
  const slug = verifyEodEntryToken(input.token || "");
  if (!slug) return { ok: false, error: "This entry link is no longer valid" };

  // Popup is human-only. Quote/email automation uses other ingest paths;
  // dashboard Activities drawer still accepts full ALLOWED_EVENT_TYPES.
  const POPUP_EVENT_TYPES: EventType[] = [
    "eod_update",
    "job_won",
    "site_visit_booked",
  ];
  if (!POPUP_EVENT_TYPES.includes(input.event_type)) {
    return { ok: false, error: "Invalid event type for this form" };
  }
  if (!ALLOWED_EVENT_TYPES.includes(input.event_type)) {
    return { ok: false, error: "Invalid event type" };
  }
  if (!isIsoDate(input.occurred_on)) {
    return { ok: false, error: "Date must be YYYY-MM-DD" };
  }

  const supabase = createAdminClient();
  let query = supabase.from("companies").select("id, name, active");
  if (slug === "agency") {
    if (!input.ghl_location_id) return { ok: false, error: "Missing GHL location" };
    query = query.eq("ghl_location_id", input.ghl_location_id);
  } else {
    query = query.eq("slug", slug);
  }
  const { data: company } = await query.single();
  if (!company || !company.active) return { ok: false, error: "Client not found" };

  let salesPersonName = "Team";
  if (input.sales_person) {
    const { data: person } = await supabase
      .from("sales_people")
      .select("name")
      .eq("company_id", company.id)
      .eq("name", input.sales_person)
      .eq("active", true)
      .maybeSingle();
    if (!person) return { ok: false, error: "That sales person isn't on this client's roster" };
    salesPersonName = person.name;
  }

  const items = (input.items || []).filter(isMeaningful);
  if (items.length === 0) {
    return { ok: false, error: "Add at least one entry (a contact name or value)" };
  }

  const activities = buildSheetActivities(input.occurred_on, input.event_type, salesPersonName, items);
  const posted = await postManualActivities(company.name, activities);
  if (!posted.ok) return posted;

  // Clear the calendar "to-log" card once the exec has submitted details.
  if (input.event_type === "site_visit_booked" && input.pending_site_visit_id) {
    const pendingId = input.pending_site_visit_id.trim();
    if (pendingId) {
      const { error: resolveErr } = await supabase
        .from("pending_site_visits")
        .update({ resolved_at: new Date().toISOString() })
        .eq("id", pendingId)
        .eq("company_id", company.id)
        .is("resolved_at", null);
      if (resolveErr) {
        console.error("[eod-entry] resolve pending site visit:", resolveErr.message);
      }
    }
  }

  // Activity is logged; now move the contact's opportunity in the GHL EOD
  // pipeline directly (the EOD fields + "Contact Changed" workflows are
  // retired). Failure here never fails the submission — the reason is
  // surfaced as a note instead.
  let pipeline: string | undefined;
  let pipelineOk: boolean | undefined;
  if (input.event_type === "eod_update" && input.eod_fields) {
    const withContact = items.find(it => it.contact_id?.trim());
    const moved = await moveEodOpportunity({
      locationId: input.ghl_location_id || "",
      contactId: withContact?.contact_id?.trim() || "",
      contactName: withContact?.contact_name?.trim() || items[0]?.contact_name?.trim() || "",
      stage: input.eod_fields.stage,
      answered: input.eod_fields.answered,
      stdOutcome: input.eod_fields.std_outcome,
    });
    pipelineOk = moved.ok;
    pipeline = moved.ok ? (moved.moved || "updated") : moved.reason;
  }

  return { ...posted, pipeline, pipelineOk };
}
