"use server";

// Server actions for editing/deleting activities. Uses the request's Supabase
// client (with session cookie) so RLS enforces the permission model defined
// in migration 0003.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/viewer";

const ALLOWED_EVENT_TYPES = ["eod_update", "quote_sent", "site_visit_booked", "email_sent", "job_won"] as const;
type EventType = (typeof ALLOWED_EVENT_TYPES)[number];

// DB enum → the sheet's "Event Type" label that the backend / logActivities expects.
const EVENT_TYPE_TO_SHEET: Record<EventType, string> = {
  eod_update:        "EOD Update",
  quote_sent:        "Quote Sent",
  site_visit_booked: "Site Visit Booked",
  email_sent:        "Email Sent",
  job_won:           "Job Won",
};

export type EditActivityInput = {
  id: string;
  occurred_on?: string | null;
  sales_person_id?: string | null;
  event_type?: EventType | null;
  outcome?: string | null;
  contact_name?: string | null;
  contact_address?: string | null;
  quote_job_value?: string | null;
  appointment_at?: string | null;
};

export type ActionResult = { ok: true } | { ok: false; error: string };

function sanitiseDate(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

function sanitiseTimestamp(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  // Accept ISO or "YYYY-MM-DDTHH:MM" (datetime-local input) — Postgres will parse.
  return v;
}

export async function editActivity(input: EditActivityInput): Promise<ActionResult> {
  if (!input.id) return { ok: false, error: "Missing id" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const update: Record<string, string | null> = {};
  if (input.occurred_on !== undefined) {
    const d = sanitiseDate(input.occurred_on);
    if (d === null && input.occurred_on !== "") return { ok: false, error: "occurred_on must be YYYY-MM-DD" };
    update.occurred_on = d ?? null;
  }
  if (input.sales_person_id !== undefined) {
    update.sales_person_id = input.sales_person_id || null;
    // Keep the denormalized sales_person_name in sync when reassigning to a
    // concrete exec — every surface (calendar, reports, tables) reads that
    // column, so a stale name would otherwise still show the wrong person.
    if (input.sales_person_id) {
      const { data: person } = await supabase
        .from("sales_people")
        .select("name")
        .eq("id", input.sales_person_id)
        .single();
      if (person?.name) update.sales_person_name = person.name;
    }
  }
  if (input.event_type !== undefined) {
    if (input.event_type && !ALLOWED_EVENT_TYPES.includes(input.event_type)) {
      return { ok: false, error: `event_type must be one of ${ALLOWED_EVENT_TYPES.join(", ")}` };
    }
    if (input.event_type) update.event_type = input.event_type;
  }
  if (input.outcome !== undefined) update.outcome = input.outcome || null;
  if (input.contact_name !== undefined) update.contact_name = input.contact_name || null;
  if (input.contact_address !== undefined) update.contact_address = input.contact_address || null;
  if (input.quote_job_value !== undefined) update.quote_job_value = input.quote_job_value || null;
  if (input.appointment_at !== undefined) update.appointment_at = sanitiseTimestamp(input.appointment_at) ?? null;

  if (Object.keys(update).length === 0) return { ok: false, error: "No fields to update" };

  const { error } = await supabase
    .from("activities")
    .update(update)
    .eq("id", input.id);

  if (error) return { ok: false, error: error.message };

  // Refresh both pages — table + live dashboard.
  revalidatePath("/activities");
  revalidatePath("/me");
  return { ok: true };
}

// ─── Manual activity creation ────────────────────────────────────────
// Unlike edit/delete (which hit Postgres directly via RLS), creating an
// activity must land in BOTH stores: the Google Sheet Activity Log (feeds the
// Slack/ClickUp reports) AND Postgres (feeds this dashboard). So we route
// through the Node service's /api/activities/manual endpoint, which calls the
// same logActivities() dual-write the webhooks use. Authorisation (which
// company + which exec) is enforced HERE, server-side, against the viewer's
// roster; the backend trusts this call via the shared WEBHOOK_SECRET.

export type NewActivityItem = {
  contact_name?: string;
  contact_address?: string;
  outcome?: string;
  ad_source?: string;
  quote_job_value?: string;
  appointment_at?: string; // "YYYY-MM-DDTHH:MM" from datetime-local
};

export type CreateManualActivitiesInput = {
  company_id: string;
  sales_person_id: string | null; // null = team (no exec attribution)
  occurred_on: string;            // YYYY-MM-DD
  event_type: EventType;
  items: NewActivityItem[];
};

// Strip $, commas and whitespace; keep pipe separators (alternative quote
// tiers). Mirrors the /webhook/quote cleaning in src/server.js.
function cleanValue(raw: string | null | undefined): string {
  return String(raw || "")
    .split("|")
    .map(v => v.replace(/[$,\s]/g, "").trim())
    .filter(Boolean)
    .join("|");
}

function isMeaningful(it: NewActivityItem): boolean {
  return Boolean(
    (it.contact_name && it.contact_name.trim()) ||
    (it.quote_job_value && it.quote_job_value.trim()) ||
    (it.contact_address && it.contact_address.trim()) ||
    (it.outcome && it.outcome.trim()) ||
    (it.appointment_at && it.appointment_at.trim()),
  );
}

export async function createManualActivities(
  input: CreateManualActivitiesInput,
): Promise<ActionResult & { count?: number }> {
  const supabase = await createClient();
  const viewer = await getViewer();

  // Validate event type + date.
  if (!ALLOWED_EVENT_TYPES.includes(input.event_type)) {
    return { ok: false, error: "Invalid event type" };
  }
  if (!input.occurred_on || sanitiseDate(input.occurred_on) !== input.occurred_on) {
    return { ok: false, error: "Date must be YYYY-MM-DD" };
  }

  // Authorise the company: admins can post to any; execs only to their own.
  const { data: company } = await supabase
    .from("companies")
    .select("id, name")
    .eq("id", input.company_id)
    .single();
  if (!company) return { ok: false, error: "Company not found" };
  if (!viewer.isAdmin && !viewer.companyIds.includes(company.id)) {
    return { ok: false, error: "You're not on this client's roster" };
  }

  // Resolve + authorise the sales person. null = team row.
  let salesPersonName = "Team";
  if (input.sales_person_id) {
    const { data: person } = await supabase
      .from("sales_people")
      .select("id, name, company_id, user_id")
      .eq("id", input.sales_person_id)
      .single();
    if (!person || person.company_id !== company.id) {
      return { ok: false, error: "Sales person isn't on this client" };
    }
    if (!viewer.isAdmin && person.user_id !== viewer.user.id) {
      return { ok: false, error: "You can only add activities under your own name" };
    }
    salesPersonName = person.name;
  }

  // Drop empty rows; require at least one real entry.
  const items = (input.items || []).filter(isMeaningful);
  if (items.length === 0) {
    return { ok: false, error: "Add at least one entry (a contact name or value)" };
  }

  const sheetType = EVENT_TYPE_TO_SHEET[input.event_type];
  const activities = items.map(it => ({
    date: input.occurred_on,
    salesPerson: salesPersonName,
    contactName: it.contact_name?.trim() || "",
    eventType: sheetType,
    outcome: it.outcome?.trim() || "",
    adSource: it.ad_source?.trim() || "",
    quoteJobValue:
      input.event_type === "quote_sent" || input.event_type === "job_won"
        ? cleanValue(it.quote_job_value)
        : "",
    contactAddress: it.contact_address?.trim() || "",
    contactId: "",
    appointmentDateTime: it.appointment_at?.trim() || "",
    appointmentDate: it.appointment_at ? it.appointment_at.slice(0, 10) : "",
  }));

  // INGEST_URL (the Supabase Edge Function base, e.g.
  // https://<ref>.supabase.co/functions/v1/ingest) takes precedence once set.
  // String-concat, not new URL(path, base): an absolute path would REPLACE
  // the /functions/v1/ingest prefix and 404 at the gateway. NODE_SERVICE_URL
  // stays as the Railway fallback until the cutover.
  const ingestBase = process.env.INGEST_URL;
  const base = process.env.NODE_SERVICE_URL;
  const secret = process.env.WEBHOOK_SECRET;
  if (!ingestBase && !base) return { ok: false, error: "INGEST_URL / NODE_SERVICE_URL not configured" };
  const endpoint = ingestBase
    ? `${ingestBase.replace(/\/+$/, "")}/api/activities/manual`
    : new URL("/api/activities/manual", base).toString();

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({ companyName: company.name, activities }),
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, error: `Couldn't reach the activity service: ${(e as Error).message}` };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = `Service error ${res.status}`;
    try { msg = JSON.parse(text).error || msg; } catch { /* keep default */ }
    return { ok: false, error: msg };
  }

  revalidatePath("/activities");
  revalidatePath("/me");
  return { ok: true, count: activities.length };
}

export async function deleteActivity(id: string): Promise<ActionResult> {
  if (!id) return { ok: false, error: "Missing id" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { error } = await supabase.from("activities").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/activities");
  revalidatePath("/me");
  return { ok: true };
}
