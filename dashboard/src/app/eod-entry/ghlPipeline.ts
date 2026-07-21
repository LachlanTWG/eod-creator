// After the popup logs an EOD call, move the contact's opportunity in the
// location's EOD pipeline directly via the Opportunities API. This replaces
// the retired custom-field nudge (EOD 1–5 fields + "Contact Changed"
// workflows are deleted from GHL) — the outcome→stage ladder that lived in
// each location's workflow now lives here.
//
// Requires the location's Private Integration token to have View/Edit
// Opportunities + pipelines.readonly (plus the existing contact scopes).

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

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

// ─── EOD pipeline + stage resolution (cached per server instance) ────

type Stage = { id: string; name: string; norm: string };
type Pipeline = { id: string; stages: Stage[] };

const pipelineCache = new Map<string, Pipeline>();

// The EOD pipeline is the one carrying the day ladder — every client's
// "Sales Engine" (HDK: "Sales Pipeline") has a literal "Day 1" stage, and
// no other pipeline does.
async function getEodPipeline(locationId: string, token: string): Promise<Pipeline | "unauthorized" | null> {
  const cached = pipelineCache.get(locationId);
  if (cached) return cached;

  const res = await fetch(`${GHL_BASE}/opportunities/pipelines?locationId=${locationId}`, {
    headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION },
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) return "unauthorized";
  if (!res.ok) return null;
  const body = await res.json();
  const pipelines: { id: string; stages?: { id: string; name: string }[] }[] = body?.pipelines ?? [];

  const eod = pipelines.find(p => (p.stages || []).some(s => normalise(s.name) === "day1"));
  if (!eod) return null;
  const pipeline: Pipeline = {
    id: eod.id,
    stages: (eod.stages || []).map(s => ({ id: s.id, name: s.name, norm: normalise(s.name) })),
  };
  pipelineCache.set(locationId, pipeline);
  return pipeline;
}

// First stage matching a candidate list. Candidates ending in "*" are
// prefix matches (e.g. Bolton's "Passed Onto Jed, Whats Doing?").
function findStage(stages: Stage[], candidates: string[]): Stage | null {
  for (const c of candidates) {
    const norm = normalise(c.endsWith("*") ? c.slice(0, -1) : c);
    const hit = c.endsWith("*")
      ? stages.find(s => s.norm.startsWith(norm))
      : stages.find(s => s.norm === norm);
    if (hit) return hit;
  }
  return null;
}

// ─── Outcome → stage ladder ─────────────────────────────────────────
//
// Stage names drift per client, so every target is a candidate list, most
// specific first. Pre/post "Not Ready Yet" variants cover Bolton ("Not
// Ready Yet" / "Not Ready Yet - Post Quote"), HDK ("Not Ready for Site
// Visit" / "Not Ready Yet - Follow Up List") and the canonical shape.
const NOT_READY_PRE = ["Not Ready Yet - Pre-Quote", "Not Ready Yet", "Not Ready for Site Visit", "Not Yet Ready"];
const NOT_READY_POST = ["Not Ready Yet - Post-Quote", "Not Ready Yet - Post Quote", "Not Ready Yet - Follow Up List", "Added to PQS Follow Up List"];
const DAY_LADDER = ["Inbound Lead", "Day 1", "Day 2", "Day 3", "Day 4", "Day 5"];

function targetStageFor(
  stages: Stage[],
  current: Stage | null,
  input: { stage: string; answered: string; stdOutcome: string },
): Stage | null {
  const out = normalise(input.stdOutcome);

  if (out && out !== "didntanswer" && out !== "answered") {
    if (out.startsWith("lost")) return findStage(stages, ["Lost"]);
    if (out.startsWith("abandoned")) return findStage(stages, ["Abandoned"]);
    if (out.startsWith("dq") || out.startsWith("disqualified")) return findStage(stages, ["Disqualified"]);
    if (out.startsWith("passedonto")) return findStage(stages, [input.stdOutcome + "*", "Passed Onto*"]);
    if (out.startsWith("notagoodtime")) return findStage(stages, ["Not a Good Time to Talk"]);
    if (out.startsWith("notready") || out.startsWith("notyetready")) {
      const postQuote = normalise(input.stage).includes("post");
      return findStage(stages, postQuote ? NOT_READY_POST : NOT_READY_PRE);
    }
    if (out === "requiresquoting") return findStage(stages, ["Requires Quoting"]);
    if (out === "quotesent") return findStage(stages, ["Quote Sent"]);
    if (out === "verbalconfirmation") return findStage(stages, ["Verbal Confirmation"]);
    if (out === "sitevisitbooked") return findStage(stages, ["Site Visit Booked", "Site Visit"]);
    if (out === "jobwon" || out === "dealclosed") return findStage(stages, ["Accepted", "Accepted - Needs Scheduling*", "Deposit Paid / Job Won", "Verbal Confirmation"]);
    // Client-specific outcome that names a stage directly (e.g. ECE's
    // "Waiting on Photos") — move only on an exact stage-name match.
    return findStage(stages, [input.stdOutcome]);
  }

  // No standard outcome: a ring-out advances the day ladder. Only from a
  // ladder stage — a no-answer on a post-quote follow-up must not reset the
  // opportunity back into the ladder. No opportunity yet → Day 1.
  if (out === "didntanswer" || normalise(input.answered) === "didntanswer") {
    if (!current) return findStage(stages, ["Day 1"]);
    const idx = DAY_LADDER.findIndex(n => normalise(n) === current.norm);
    if (idx === -1 || idx === DAY_LADDER.length - 1) return null; // not on the ladder, or parked at Day 5
    return findStage(stages, [DAY_LADDER[idx + 1]]);
  }

  return null;
}

// ─── Opportunity lookup / move ──────────────────────────────────────

async function findOpportunity(
  locationId: string,
  token: string,
  contactId: string,
  pipelineId: string,
): Promise<{ id: string; pipelineStageId: string } | null> {
  const res = await fetch(
    `${GHL_BASE}/opportunities/search?location_id=${locationId}&contact_id=${encodeURIComponent(contactId)}&limit=20`,
    { headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION }, cache: "no-store" },
  );
  if (!res.ok) return null;
  const body = await res.json();
  const opps: { id: string; pipelineId: string; pipelineStageId: string; status?: string; createdAt?: string }[] =
    body?.opportunities ?? [];
  const inPipeline = opps.filter(o => o.pipelineId === pipelineId);
  const open = inPipeline.filter(o => (o.status || "open") === "open");
  const pick = (open.length > 0 ? open : inPipeline)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))[0];
  return pick ? { id: pick.id, pipelineStageId: pick.pipelineStageId } : null;
}

export type PipelinePushResult = { ok: true; moved?: string } | { ok: false; reason: string };

export async function moveEodOpportunity(input: {
  locationId: string;
  contactId: string;
  contactName?: string;
  stage: string;      // EOD 1 — lead type (New Lead / Pre- / Post-Quote Follow Up)
  answered: string;   // EOD 2
  stdOutcome: string; // EOD 3
}): Promise<PipelinePushResult> {
  const { locationId, contactId } = input;
  if (!locationId || !contactId) return { ok: false, reason: "no linked GHL contact" };
  const token = locationToken(locationId);
  if (!token) return { ok: false, reason: "no API token for this location" };

  let pipeline: Pipeline | "unauthorized" | null;
  try {
    pipeline = await getEodPipeline(locationId, token);
  } catch {
    return { ok: false, reason: "couldn't read the location's pipelines" };
  }
  if (pipeline === "unauthorized") return { ok: false, reason: "token missing the opportunity/pipeline scopes" };
  if (!pipeline) return { ok: false, reason: "no EOD pipeline (with a Day 1 stage) in this location" };

  let opp: { id: string; pipelineStageId: string } | null;
  try {
    opp = await findOpportunity(locationId, token, contactId, pipeline.id);
  } catch {
    return { ok: false, reason: "couldn't search opportunities" };
  }

  const current = opp ? pipeline.stages.find(s => s.id === opp!.pipelineStageId) || null : null;
  const target = targetStageFor(pipeline.stages, current, input);
  if (!target) return { ok: true, moved: "no stage change for this outcome" };
  if (current && current.id === target.id) return { ok: true, moved: `already at ${target.name}` };

  try {
    const res = opp
      ? await fetch(`${GHL_BASE}/opportunities/${opp.id}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION, "Content-Type": "application/json" },
          body: JSON.stringify({ pipelineId: pipeline.id, pipelineStageId: target.id }),
          cache: "no-store",
        })
      : await fetch(`${GHL_BASE}/opportunities/`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION, "Content-Type": "application/json" },
          body: JSON.stringify({
            locationId,
            contactId,
            pipelineId: pipeline.id,
            pipelineStageId: target.id,
            name: input.contactName || "EOD Lead",
            status: "open",
          }),
          cache: "no-store",
        });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, reason: `GHL ${res.status}: ${text.slice(0, 120)}` };
    }
  } catch (e) {
    return { ok: false, reason: `GHL unreachable: ${(e as Error).message}` };
  }

  return { ok: true, moved: opp ? `moved to ${target.name}` : `created at ${target.name}` };
}
