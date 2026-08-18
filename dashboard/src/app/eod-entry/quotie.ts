// Server-only helpers for pushing EOD outcomes into a client's Quotie
// instance via its REST API. NOT a client module — only imported by
// page.tsx (for the safe outcome->type projection passed to the form) and
// actions.ts (for the actual authenticated API calls). The api_key, api_url
// and user_map live in companies.quotie_config and must never reach the
// browser: safeQuotieActions() is the only projection the client ever sees.

export type QuotieActionType = "task" | "site_visit";

export type QuotieAction = {
  type: QuotieActionType;
  /** Task title template, {contact} is substituted server-side. */
  titleTemplate?: string;
  /** Quotie users.auth_id override for this specific action. */
  assign_to?: string;
};

export type QuotieConfig = {
  api_url?: string;
  api_key?: string;
  /** Roster name → Quotie users.auth_id. */
  user_map?: Record<string, string>;
  /** EOD 3 outcome → action, or null to disable the default. */
  actions?: Record<string, QuotieAction | null>;
};

/**
 * Sensible defaults so a client with an api_key but no explicit `actions`
 * map still gets useful behaviour. A per-client `actions` entry overrides
 * the default for that outcome; an explicit null disables it.
 */
export const DEFAULT_QUOTIE_ACTIONS: Record<string, QuotieAction> = {
  "Book Site Visit": { type: "site_visit" },
  "Requires Quoting": { type: "task", titleTemplate: "Prepare quote for {contact}" },
  "Waiting on Photos": { type: "task", titleTemplate: "Chase photos from {contact}" },
  "Not a Good Time to Talk": { type: "task", titleTemplate: "Call back {contact}" },
};

/**
 * Resolve the Quotie action for an EOD 3 outcome, merging the per-client
 * config over the defaults. Returns null when:
 *   - the client has no api_key (integration off), or
 *   - the outcome has no default and no config entry, or
 *   - the config explicitly maps the outcome to null (disabled).
 */
export function resolveQuotieAction(
  outcome: string,
  config: QuotieConfig | null | undefined,
): QuotieAction | null {
  if (!config?.api_key) return null;
  const key = (outcome || "").trim();
  if (!key) return null;

  const hasOverride =
    config.actions != null && Object.prototype.hasOwnProperty.call(config.actions, key);
  if (hasOverride) {
    const override = config.actions![key];
    // Explicit null disables the action entirely.
    if (override === null) return null;
    // Merge the override over the default (override wins field-by-field).
    const base = DEFAULT_QUOTIE_ACTIONS[key];
    return { ...(base ?? {}), ...override } as QuotieAction;
  }

  return DEFAULT_QUOTIE_ACTIONS[key] ?? null;
}

/**
 * The ONLY projection of quotie_config that may be sent to the client: a
 * plain { outcome -> "task" | "site_visit" } map so the form knows which
 * inline section to render. Never leaks api_key / api_url / user_map.
 * Empty object when the integration is off (no api_key).
 */
export function safeQuotieActions(
  config: QuotieConfig | null | undefined,
): Record<string, QuotieActionType> {
  const out: Record<string, QuotieActionType> = {};
  if (!config?.api_key) return out;

  // Start from defaults, then apply per-client overrides / disables.
  const outcomes = new Set<string>([
    ...Object.keys(DEFAULT_QUOTIE_ACTIONS),
    ...(config.actions ? Object.keys(config.actions) : []),
  ]);
  for (const outcome of outcomes) {
    const action = resolveQuotieAction(outcome, config);
    if (action) out[outcome] = action.type;
  }
  return out;
}

const QUOTIE_TIMEOUT_MS = 10_000;

export type QuotieCallResult = {
  ok: boolean;
  warnings?: string[];
  error?: string;
};

type QuotieTaskInput = {
  title: string;
  notes?: string;
  due_date?: string;
  /** Roster name — mapped to a Quotie users.auth_id via config.user_map. */
  salesPersonName?: string;
  /** Explicit assignee (auth_id) — wins over the user_map lookup. */
  assign_to?: string;
  ghl_contact_id?: string;
};

type QuotieSiteVisitInput = {
  date: string;
  time?: string;
  contact_name: string;
  contact_phone?: string;
  contact_email?: string;
  ghl_contact_id?: string;
  address?: string;
  salesPersonName?: string;
  assign_to?: string;
  create_ghl_appointment: boolean;
};

/** POST to a Quotie REST endpoint with the client's api_key + a 10s guard. */
async function postQuotie(
  config: QuotieConfig,
  path: string,
  body: Record<string, unknown>,
): Promise<QuotieCallResult> {
  const apiUrl = (config.api_url || "").trim().replace(/\/+$/, "");
  const apiKey = (config.api_key || "").trim();
  if (!apiUrl || !apiKey) {
    return { ok: false, error: "Quotie is not configured for this client" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUOTIE_TIMEOUT_MS);
  try {
    const res = await fetch(`${apiUrl}/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON response — keep raw text for the error path */
    }
    if (!res.ok) {
      const detail =
        (parsed && typeof parsed === "object" && "error" in parsed
          ? String((parsed as { error?: unknown }).error)
          : "") ||
        text.slice(0, 200) ||
        `HTTP ${res.status}`;
      return { ok: false, error: detail };
    }
    const warnings =
      parsed && typeof parsed === "object" && Array.isArray((parsed as { warnings?: unknown }).warnings)
        ? ((parsed as { warnings?: string[] }).warnings as string[])
        : undefined;
    return { ok: true, warnings };
  } catch (e) {
    const msg = (e as Error).name === "AbortError" ? "Quotie timed out" : (e as Error).message;
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve the assignee auth_id: explicit override first, then user_map. */
function resolveAssignee(
  config: QuotieConfig,
  salesPersonName?: string,
  assignOverride?: string,
): string | undefined {
  if (assignOverride?.trim()) return assignOverride.trim();
  const name = (salesPersonName || "").trim();
  if (!name) return undefined;
  return config.user_map?.[name] || undefined;
}

/** Create a Quotie task. Never throws — always returns a QuotieCallResult. */
export async function createQuotieTask(
  config: QuotieConfig,
  input: QuotieTaskInput,
): Promise<QuotieCallResult> {
  const assigned_to = resolveAssignee(config, input.salesPersonName, input.assign_to);
  const body: Record<string, unknown> = { title: input.title };
  if (input.notes?.trim()) body.notes = input.notes.trim();
  if (input.due_date?.trim()) body.due_date = input.due_date.trim();
  if (assigned_to) body.assigned_to = assigned_to;
  if (input.ghl_contact_id?.trim()) body.ghl_contact_id = input.ghl_contact_id.trim();
  return postQuotie(config, "api-tasks", body);
}

/** Create a Quotie site visit. Never throws — always returns a QuotieCallResult. */
export async function createQuotieSiteVisit(
  config: QuotieConfig,
  input: QuotieSiteVisitInput,
): Promise<QuotieCallResult> {
  const assigned_to = resolveAssignee(config, input.salesPersonName, input.assign_to);
  const body: Record<string, unknown> = {
    date: input.date,
    contact_name: input.contact_name,
    create_ghl_appointment: input.create_ghl_appointment,
  };
  if (input.time?.trim()) body.time = input.time.trim();
  if (input.contact_phone?.trim()) body.contact_phone = input.contact_phone.trim();
  if (input.contact_email?.trim()) body.contact_email = input.contact_email.trim();
  if (input.ghl_contact_id?.trim()) body.ghl_contact_id = input.ghl_contact_id.trim();
  if (input.address?.trim()) body.address = input.address.trim();
  if (assigned_to) body.assigned_to = assigned_to;
  return postQuotie(config, "api-site-visits", body);
}
