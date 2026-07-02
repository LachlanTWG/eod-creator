"use client";

// One won job with missing information. Inline inputs per blank field + Save
// (via the shared updateWonJob action) + Delete. Mirrors MissingActivityCard.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/format";
import { updateWonJob, deleteWonJob, type EditWonJobInput } from "../wins/actions";
import type { Gap, ScanWonJob } from "@/lib/missingInfo";

const STAGE_BADGE: Record<string, string> = {
  verbal_confirmation: "bg-zinc-700/40 text-zinc-300",
  client_approved:     "bg-amber-500/15 text-amber-300",
  invoiced:            "bg-sky-500/15 text-sky-300",
  paid:                "bg-emerald-500/15 text-emerald-300",
};
const STAGE_LABEL: Record<string, string> = {
  verbal_confirmation: "Verbal",
  client_approved:     "Approved",
  invoiced:            "Invoiced",
  paid:                "Paid",
};

type FieldMeta = { kind: "text" | "money" | "datetime"; placeholder?: string };
const FIELD_META: Record<string, FieldMeta> = {
  contact_name:      { kind: "text", placeholder: "Contact name" },
  job_value:         { kind: "money", placeholder: "0.00" },
  commission_amount: { kind: "money", placeholder: "0.00" },
  invoice_number:    { kind: "text", placeholder: "Invoice #" },
  paid_at:           { kind: "datetime" },
};

export function MissingWonJobCard({
  row,
  gaps,
}: {
  row: ScanWonJob;
  gaps: Gap[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});

  const badgeClass = STAGE_BADGE[row.stage] || "bg-zinc-800 text-zinc-300";
  const hasInput = gaps.some(g => (values[g.field] || "").trim() !== "");

  function setV(field: string, v: string) {
    setValues(prev => ({ ...prev, [field]: v }));
  }

  function handleSave() {
    setError(null);
    const input: EditWonJobInput = { id: row.id };
    for (const g of gaps) {
      const v = (values[g.field] || "").trim();
      if (!v) continue;
      if (g.field === "job_value" || g.field === "commission_amount") {
        const n = parseFloat(v.replace(/[$,]/g, ""));
        if (!Number.isFinite(n)) { setError(`${g.label} must be a number`); return; }
        input[g.field] = n;
      } else if (g.field === "paid_at") {
        input.paid_at = v;
      } else if (g.field === "contact_name") {
        input.contact_name = v;
      } else if (g.field === "invoice_number") {
        input.invoice_number = v;
      }
    }
    if (Object.keys(input).length <= 1) { setError("Enter a value first"); return; }
    startTransition(async () => {
      const res = await updateWonJob(input);
      if (!res.ok) { setError(res.error); return; }
      router.refresh();
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteWonJob(row.id);
      if (!res.ok) { setError(res.error); setConfirmingDelete(false); return; }
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-800 bg-zinc-900/40 px-4 py-2.5">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${badgeClass}`}>
          {STAGE_LABEL[row.stage] || row.stage}
        </span>
        <span className="text-sm font-medium text-zinc-100">
          {row.contact_name || (
            <span className="italic text-zinc-600">{row.type === "retainer" ? "(retainer)" : "no contact name"}</span>
          )}
        </span>
        {row.job_value !== null && (
          <span className="text-xs tabular-nums text-zinc-500">{formatCurrency(Number(row.job_value))}</span>
        )}
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
                <input
                  type={meta.kind === "datetime" ? "datetime-local" : "text"}
                  inputMode={meta.kind === "money" ? "decimal" : undefined}
                  value={values[g.field] || ""}
                  onChange={e => setV(g.field, e.target.value)}
                  placeholder={meta.placeholder}
                  disabled={pending}
                  className={inputClass}
                />
              </div>
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
