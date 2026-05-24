"use server";

// Server actions for editing/deleting activities. Uses the request's Supabase
// client (with session cookie) so RLS enforces the permission model defined
// in migration 0003.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_EVENT_TYPES = ["eod_update", "quote_sent", "site_visit_booked", "email_sent", "job_won"] as const;
type EventType = (typeof ALLOWED_EVENT_TYPES)[number];

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
  if (input.sales_person_id !== undefined) update.sales_person_id = input.sales_person_id || null;
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
