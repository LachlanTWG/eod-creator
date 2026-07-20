// After the popup logs an EOD call, mirror the EOD 1/2/3 values onto the GHL
// contact's custom fields via the API. That field change fires each
// location's existing "Contact Changed" workflow (find opportunity in the EOD
// pipeline → move to the right stage → clear the fields), so the popup drives
// the exact same automation the manual custom-field entry did — per-location
// pipeline/stage ids stay inside each location's own workflow, never here.
//
// Requires the location's Private Integration token to have the
// "Edit Contacts" and "View Custom Fields" scopes.

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

// Field IDs differ per location; resolve them by display name and cache for
// the life of the server instance.
const FIELD_NAMES: Record<string, string> = {
  stage: "EOD 1 - Stage",
  answered: "EOD 2 - Answered?",
  outcome: "EOD 3 - Standard Outcome",
};

const fieldIdCache = new Map<string, Record<string, string>>();

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function locationToken(locationId: string): string | null {
  try {
    const tokens = JSON.parse(process.env.GHL_LOCATION_TOKENS || "{}");
    return tokens[locationId] || null;
  } catch {
    return null;
  }
}

async function getFieldIds(locationId: string, token: string): Promise<Record<string, string> | "unauthorized" | null> {
  const cached = fieldIdCache.get(locationId);
  if (cached) return cached;

  const res = await fetch(`${GHL_BASE}/locations/${locationId}/customFields`, {
    headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION },
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) return "unauthorized";
  if (!res.ok) return null;
  const body = await res.json();
  const fields: { id: string; name?: string }[] = body?.customFields ?? [];

  const wanted = Object.fromEntries(
    Object.entries(FIELD_NAMES).map(([k, name]) => [normalise(name), k]),
  );
  const ids: Record<string, string> = {};
  for (const f of fields) {
    const key = wanted[normalise(f.name || "")];
    if (key) ids[key] = f.id;
  }
  if (Object.keys(ids).length === 0) return null; // location has no EOD fields (not onboarded to the pipeline flow)
  fieldIdCache.set(locationId, ids);
  return ids;
}

export type PipelinePushResult = { ok: true } | { ok: false; reason: string };

export async function pushEodFieldsToGhl(input: {
  locationId: string;
  contactId: string;
  stage: string;
  answered: string;
  stdOutcome: string;
}): Promise<PipelinePushResult> {
  const { locationId, contactId, stage, answered, stdOutcome } = input;
  if (!locationId || !contactId) return { ok: false, reason: "no linked GHL contact" };
  const token = locationToken(locationId);
  if (!token) return { ok: false, reason: "no API token for this location" };

  let ids: Record<string, string> | "unauthorized" | null;
  try {
    ids = await getFieldIds(locationId, token);
  } catch {
    return { ok: false, reason: "couldn't read the location's fields" };
  }
  if (ids === "unauthorized") {
    return { ok: false, reason: "token missing the View Custom Fields / Edit Contacts scopes" };
  }
  if (!ids) return { ok: false, reason: "no EOD fields exist in this location" };

  // The workflow's "Didn't Answer" ladder branches on EOD 3 == "Didn't
  // Answer", so mirror a no-answer into EOD 3 when no explicit outcome given.
  const eod3 = stdOutcome || (answered === "Didn't Answer" ? "Didn't Answer" : "");
  const customFields = [
    ids.stage && stage ? { id: ids.stage, field_value: stage } : null,
    ids.answered && answered ? { id: ids.answered, field_value: answered } : null,
    ids.outcome && eod3 ? { id: ids.outcome, field_value: eod3 } : null,
  ].filter(Boolean);
  if (customFields.length === 0) return { ok: false, reason: "nothing to write" };

  let res: Response;
  try {
    res = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: GHL_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ customFields }),
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, reason: `GHL unreachable: ${(e as Error).message}` };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, reason: `GHL ${res.status}: ${text.slice(0, 120)}` };
  }
  return { ok: true };
}
