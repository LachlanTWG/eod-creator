"use client";

// One activity with missing information. Each blank field is rendered as an
// inline input, ready to type/paste into — no drawer. Save writes only the
// fields you filled (via the shared editActivity action); once every gap is
// filled the record drops off the list on refresh. Delete removes the row.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EVENT_LABELS } from "@/lib/format";
import { editActivity, deleteActivity, type EditActivityInput } from "../activities/actions";
import type { Gap, ScanActivity } from "@/lib/missingInfo";

export type SalesPersonOption = { id: string; name: string; company_id: string };

const EVENT_BADGE: Record<string, string> = {
  quote_sent:        "bg-amber-500/15 text-amber-300",
  site_visit_booked: "bg-sky-500/15 text-sky-300",
  job_won:           "bg-emerald-500/15 text-emerald-300",
};

type FieldMeta = { kind: "text" | "datetime" | "select"; placeholder?: string; hint?: string };
const FIELD_META: Record<string, FieldMeta> = {
  contact_name:    { kind: "text", placeholder: "Contact name" },
  quote_job_value: { kind: "text", placeholder: "1200|3500", hint: "Pipe-separated tiers, no symbols" },
  contact_address: { kind: "text", placeholder: "Address" },
  appointment_at:  { kind: "datetime" },
  sales_person:    { kind: "select" },
};

// Strip $, commas and whitespace per pipe-tier (mirrors ingest cleaning).
function cleanValue(raw: string): string {
  return raw.split("|").map(v => v.replace(/[$,\s]/g, "")).filter(Boolean).join("|");
}

export function MissingActivityCard({
  row,
  gaps,
  salesPeople,
}: {
  row: ScanActivity;
  gaps: Gap[];
  salesPeople: SalesPersonOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});

  const badgeClass = EVENT_BADGE[row.event_type] || "bg-zinc-800 text-zinc-300";
  const companyPeople = salesPeople.filter(p => p.company_id === row.company_id);
  const hasInput = gaps.some(g => (values[g.field] || "").trim() !== "");

  function setV(field: string, v: string) {
    setValues(prev => ({ ...prev, [field]: v }));
  }

  function handleSave() {
    setError(null);
    const input: EditActivityInput = { id: row.id };
    for (const g of gaps) {
      const v = (values[g.field] || "").trim();
      if (!v) continue;
      switch (g.field) {
        case "sales_person":    input.sales_person_id = v; break;
        case "quote_job_value": input.quote_job_value = cleanValue(v); break;
        case "appointment_at":  input.appointment_at = v; break;
        case "contact_name":    input.contact_name = v; break;
        case "contact_address": input.contact_address = v; break;
      }
    }
    if (Object.keys(input).length <= 1) { setError("Enter a value first"); return; }
    startTransition(async () => {
      const res = await editActivity(input);
      if (!res.ok) { setError(res.error); return; }
      router.refresh();
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteActivity(row.id);
      if (!res.ok) { setError(res.error); setConfirmingDelete(false); return; }
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-800 bg-zinc-900/40 px-4 py-2.5">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${badgeClass}`}>
          {EVENT_LABELS[row.event_type] || row.event_type}
        </span>
        <span className="text-sm font-medium text-zinc-100">
          {row.contact_name || <span className="italic text-zinc-600">no contact name</span>}
        </span>
        <span className="text-xs tabular-nums text-zinc-500">{row.occurred_on}</span>
        {confirmingDelete ? (
          <span className="ml-auto flex items-center gap-2">
            <span className="text-xs text-zinc-400">Delete this record?</span>
            <button type="button" onClick={handleDelete} disabled={pending}
              className="rounded border border-red-900/50 bg-red-950/20 px-2.5 py-1 text-[11px] text-red-300 hover:border-red-800 hover:bg-red-900/30 disabled:opacity-50">
              {pending ? "Deleting…" : "Confirm"}
            </button>
            <button type="button" onClick={() => setConfirmingDelete(false)} disabled={pending}
              className="rounded border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-50">
              No
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmingDelete(true)} disabled={pending}
            className="ml-auto rounded border border-red-900/40 px-2.5 py-1 text-[11px] text-red-300/80 hover:border-red-800 hover:text-red-300 disabled:opacity-50">
            Delete
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3 px-4 py-3">
        {gaps.map(g => {
          const meta = FIELD_META[g.field] || { kind: "text" as const };
          return (
            <label key={g.field} className="block">
              <span className="block text-[10px] font-medium uppercase tracking-wider text-red-400/80">{g.label}</span>
              <div className="mt-1">
                {meta.kind === "select" ? (
                  <select
                    value={values[g.field] || ""}
                    onChange={e => setV(g.field, e.target.value)}
                    disabled={pending}
                    className={inputClass}
                  >
                    <option value="">— pick rep —</option>
                    {companyPeople.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                ) : (
                  <input
                    type={meta.kind === "datetime" ? "datetime-local" : "text"}
                    value={values[g.field] || ""}
                    onChange={e => setV(g.field, e.target.value)}
                    placeholder={meta.placeholder}
                    disabled={pending}
                    className={inputClass}
                  />
                )}
              </div>
              {meta.hint && <p className="mt-1 text-[10px] text-zinc-600">{meta.hint}</p>}
            </label>
          );
        })}
        <button
          type="button"
          onClick={handleSave}
          disabled={pending || !hasInput}
          className="rounded bg-emerald-600/90 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>

      {error && (
        <div className="border-t border-red-900/40 bg-red-950/20 px-4 py-2 text-xs text-red-300">{error}</div>
      )}
    </div>
  );
}

const inputClass =
  "rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600";
