import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayInTz, SYDNEY_TZ } from "@/lib/format";

export const dynamic = "force-dynamic";

const EVENTS = new Set([
  "lead_in", "vsl_view", "vsl_complete", "call",
  "quote_sent", "site_visit", "won", "lost", "email",
]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400, headers: CORS });
  }

  const event = String(body.event || "");
  const slug = String(body.company || body.slug || "").trim();
  if (!EVENTS.has(event) || !slug) {
    return NextResponse.json({ error: "need company + event" }, { status: 400, headers: CORS });
  }

  const admin = createAdminClient();
  const { data: company } = await admin
    .from("companies")
    .select("id, timezone")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();
  if (!company) {
    return NextResponse.json({ error: "unknown company" }, { status: 404, headers: CORS });
  }

  const occurredOn = todayInTz(company.timezone || SYDNEY_TZ);
  const args = {
    p_company_id: company.id,
    p_event: event,
    p_occurred_on: occurredOn,
    p_contact_id: emptyToNull(body.contact_id),
    p_contact_name: emptyToNull(body.contact_name),
    p_visitor_id: emptyToNull(body.visitor_id),
    p_source: emptyToNull(body.source) || emptyToNull(body.utm_source),
    p_campaign: emptyToNull(body.campaign) || emptyToNull(body.utm_campaign),
    p_utm_source: emptyToNull(body.utm_source),
    p_utm_medium: emptyToNull(body.utm_medium),
    p_utm_campaign: emptyToNull(body.utm_campaign),
    p_utm_content: emptyToNull(body.utm_content),
    p_fbclid: emptyToNull(body.fbclid),
    p_gclid: emptyToNull(body.gclid),
    p_campaign_id: emptyToNull(body.campaign_id),
    p_adset_id: emptyToNull(body.adset_id),
    p_ad_id: emptyToNull(body.ad_id),
    p_page_key: emptyToNull(body.page_key),
    p_value: typeof body.value === "number" ? body.value : null,
    p_payload: { via: "collect" },
  };

  // Prefer the ON CONFLICT DO NOTHING rpc so a remount / refresh does not
  // surface conversion_events_pixel_uidx as an error. Fall back to insert
  // (and treat 23505 as success) until the migration is applied.
  const { error: rpcError } = await admin.rpc("record_pixel_conversion", args);
  if (rpcError && !isMissingRpc(rpcError)) {
    return NextResponse.json({ error: rpcError.message }, { status: 500, headers: CORS });
  }
  if (rpcError && isMissingRpc(rpcError)) {
    const { error } = await admin.from("conversion_events").insert({
      company_id: args.p_company_id,
      event: args.p_event,
      occurred_on: args.p_occurred_on,
      contact_id: args.p_contact_id,
      contact_name: args.p_contact_name,
      visitor_id: args.p_visitor_id,
      source: args.p_source,
      campaign: args.p_campaign,
      utm_source: args.p_utm_source,
      utm_medium: args.p_utm_medium,
      utm_campaign: args.p_utm_campaign,
      utm_content: args.p_utm_content,
      fbclid: args.p_fbclid,
      gclid: args.p_gclid,
      campaign_id: args.p_campaign_id,
      adset_id: args.p_adset_id,
      ad_id: args.p_ad_id,
      page_key: args.p_page_key,
      value: args.p_value,
      payload: args.p_payload,
    });
    if (error && error.code !== "23505") {
      return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
    }
  }
  return NextResponse.json({ ok: true }, { headers: CORS });
}

function isMissingRpc(err: { code?: string; message?: string }): boolean {
  return err.code === "PGRST202" || err.code === "42883"
    || /record_pixel_conversion/i.test(err.message || "");
}

function emptyToNull(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s || null;
}
