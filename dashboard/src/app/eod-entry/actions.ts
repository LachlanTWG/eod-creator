"use server";

// Submission path for the GHL-embedded /eod-entry form. Mirrors
// createManualActivities (activities/actions.ts) but authorises via the
// signed company token instead of a Supabase session: the token pins the
// company, and the sales person is checked against that company's roster
// with the service-role client. The backend endpoint trusts this server via
// WEBHOOK_SECRET, so every field must be validated HERE.

import { verifyEodEntryToken } from "@/lib/eodEntryToken";
import { createAdminClient } from "@/lib/supabase/admin";
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
};

export type EodEntryResult = { ok: true; count: number } | { ok: false; error: string };

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
  return postManualActivities(company.name, activities);
}
