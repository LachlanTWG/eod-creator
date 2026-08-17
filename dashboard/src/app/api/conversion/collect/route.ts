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
  const { error } = await admin.from("conversion_events").insert({
    company_id: company.id,
    event,
    contact_id: emptyToNull(body.contact_id),
    contact_name: emptyToNull(body.contact_name),
    visitor_id: emptyToNull(body.visitor_id),
    source: emptyToNull(body.source),
    campaign: emptyToNull(body.campaign),
    page_key: emptyToNull(body.page_key),
    occurred_on: occurredOn,
    value: typeof body.value === "number" ? body.value : null,
    payload: { via: "collect" },
  });

  if (error && error.code !== "23505") {
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  }
  return NextResponse.json({ ok: true }, { headers: CORS });
}

function emptyToNull(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s || null;
}
