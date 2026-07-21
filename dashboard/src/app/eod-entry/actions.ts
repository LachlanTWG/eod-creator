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
};

export type EodEntryResult =
  | { ok: true; count: number; pipeline?: string } // pipeline: "updated" or a skip/fail reason
  | { ok: false; error: string };

export async function submitEodEntry(input: EodEntryInput): Promise<EodEntryResult> {
  const slug = verifyEodEntryToken(input.token || "");
  if (!slug) return { ok: false, error: "This entry link is no longer valid" };

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

  // Activity is logged; now move the contact's opportunity in the GHL EOD
  // pipeline directly (the EOD fields + "Contact Changed" workflows are
  // retired). Failure here never fails the submission — the reason is
  // surfaced as a note instead.
  let pipeline: string | undefined;
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
    pipeline = moved.ok ? (moved.moved || "updated") : moved.reason;
  }

  return { ...posted, pipeline };
}
