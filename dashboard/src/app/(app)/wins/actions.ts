"use server";

// Server actions for won_jobs CRUD + stage advance. RLS in migration 0004
// enforces the permission model (admin all, exec own only).

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type Stage = "verbal_confirmation" | "client_approved" | "invoiced" | "paid";
const STAGES: Stage[] = ["verbal_confirmation", "client_approved", "invoiced", "paid"];
const STAGE_TIMESTAMP_FIELD: Record<Stage, string> = {
  verbal_confirmation: "verbal_at",
  client_approved:     "approved_at",
  invoiced:            "invoiced_at",
  paid:                "paid_at",
};

const VALID_TYPES = ["comms", "retainer", "other"] as const;
type WonJobType = (typeof VALID_TYPES)[number];

export type EditWonJobInput = {
  id: string;
  company_id?: string;
  sales_person_id?: string | null;
  contact_name?: string | null;
  contact_address?: string | null;
  contact_id?: string | null;
  job_value?: number | null;
  commission_amount?: number | null;
  type?: WonJobType;
  stage?: Stage;
  verbal_at?: string | null;
  approved_at?: string | null;
  invoiced_at?: string | null;
  paid_at?: string | null;
  invoice_number?: string | null;
  notes?: string | null;
};

export type CreateWonJobInput = Omit<EditWonJobInput, "id"> & {
  company_id: string;
  stage: Stage;
};

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

function sanitiseStage(s: string | undefined): Stage | undefined {
  if (!s) return undefined;
  return (STAGES as string[]).includes(s) ? (s as Stage) : undefined;
}

function sanitiseTimestamp(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  return v;
}

function sanitiseAmount(v: number | null | undefined): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (!Number.isFinite(v)) return null;
  return v;
}

export async function createWonJob(input: CreateWonJobInput): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const stage = sanitiseStage(input.stage);
  if (!stage) return { ok: false, error: "Invalid stage" };

  const row: Record<string, unknown> = {
    company_id: input.company_id,
    sales_person_id: input.sales_person_id || null,
    contact_name: input.contact_name || null,
    contact_address: input.contact_address || null,
    contact_id: input.contact_id || null,
    job_value: sanitiseAmount(input.job_value) ?? null,
    commission_amount: sanitiseAmount(input.commission_amount) ?? null,
    type: input.type && (VALID_TYPES as readonly string[]).includes(input.type) ? input.type : "comms",
    stage,
    verbal_at:   sanitiseTimestamp(input.verbal_at)   ?? null,
    approved_at: sanitiseTimestamp(input.approved_at) ?? null,
    invoiced_at: sanitiseTimestamp(input.invoiced_at) ?? null,
    paid_at:     sanitiseTimestamp(input.paid_at)     ?? null,
    invoice_number: input.invoice_number || null,
    notes: input.notes || null,
  };

  const { data, error } = await supabase
    .from("won_jobs")
    .insert(row)
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  revalidatePath("/wins");
  return { ok: true, data: { id: data!.id as string } };
}

export async function updateWonJob(input: EditWonJobInput): Promise<ActionResult> {
  if (!input.id) return { ok: false, error: "Missing id" };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const update: Record<string, unknown> = {};
  if (input.company_id !== undefined) update.company_id = input.company_id;
  if (input.sales_person_id !== undefined) update.sales_person_id = input.sales_person_id || null;
  if (input.contact_name !== undefined) update.contact_name = input.contact_name || null;
  if (input.contact_address !== undefined) update.contact_address = input.contact_address || null;
  if (input.contact_id !== undefined) update.contact_id = input.contact_id || null;
  if (input.job_value !== undefined) update.job_value = sanitiseAmount(input.job_value) ?? null;
  if (input.commission_amount !== undefined) update.commission_amount = sanitiseAmount(input.commission_amount) ?? null;
  if (input.type !== undefined && (VALID_TYPES as readonly string[]).includes(input.type)) update.type = input.type;
  if (input.stage !== undefined) {
    const s = sanitiseStage(input.stage);
    if (!s) return { ok: false, error: "Invalid stage" };
    update.stage = s;
  }
  if (input.verbal_at   !== undefined) update.verbal_at   = sanitiseTimestamp(input.verbal_at)   ?? null;
  if (input.approved_at !== undefined) update.approved_at = sanitiseTimestamp(input.approved_at) ?? null;
  if (input.invoiced_at !== undefined) update.invoiced_at = sanitiseTimestamp(input.invoiced_at) ?? null;
  if (input.paid_at     !== undefined) update.paid_at     = sanitiseTimestamp(input.paid_at)     ?? null;
  if (input.invoice_number !== undefined) update.invoice_number = input.invoice_number || null;
  if (input.notes !== undefined) update.notes = input.notes || null;

  if (Object.keys(update).length === 0) return { ok: false, error: "No fields to update" };

  const { error } = await supabase.from("won_jobs").update(update).eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/wins");
  return { ok: true };
}

export async function deleteWonJob(id: string): Promise<ActionResult> {
  if (!id) return { ok: false, error: "Missing id" };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { error } = await supabase.from("won_jobs").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/wins");
  return { ok: true };
}

/**
 * Advance the job to its next pipeline stage and stamp the relevant timestamp.
 * Safe to call repeatedly — at 'paid' it's a no-op.
 */
export async function advanceStage(id: string): Promise<ActionResult> {
  if (!id) return { ok: false, error: "Missing id" };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: existing, error: readErr } = await supabase
    .from("won_jobs")
    .select("stage")
    .eq("id", id)
    .single();
  if (readErr) return { ok: false, error: readErr.message };

  const current = sanitiseStage(existing!.stage as string);
  if (!current) return { ok: false, error: "Row has invalid stage" };
  const idx = STAGES.indexOf(current);
  if (idx === -1 || idx === STAGES.length - 1) return { ok: true }; // already paid
  const next = STAGES[idx + 1];

  const update: Record<string, unknown> = { stage: next };
  update[STAGE_TIMESTAMP_FIELD[next]] = new Date().toISOString();

  const { error } = await supabase.from("won_jobs").update(update).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/wins");
  return { ok: true };
}
